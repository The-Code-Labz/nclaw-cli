import fs from 'fs/promises';
import path from 'path';
import { execFile, spawn } from 'child_process';
import fg from 'fast-glob';
import type { ConfirmResult } from './confirm';
import { isAllowed, allowAlways, isYoloMode } from './permissions';

const CWD = process.cwd();

// ── Limits (mirroring nightcode's safety caps) ────────────────────────────
const MAX_FILE_SIZE = 10_000;
const MAX_RESULTS   = 200;
const MAX_MATCHES   = 50;
const MAX_OUTPUT    = 20_000;
const DEFAULT_TIMEOUT = 30_000;
const BASH_TIMEOUT_MS = 120_000;

function truncate(value: string, limit: number): string {
  return value.length > limit
    ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
    : value;
}

function resolveInsideCwd(p: string): { cwd: string; resolved: string } {
  const resolved = path.resolve(CWD, p);
  const rel = path.relative(CWD, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path is outside the project directory: ${p}`);
  }
  return { cwd: CWD, resolved };
}

function safePath(p: string): string {
  const { resolved } = resolveInsideCwd(p);
  return resolved;
}

export async function executeToolCall(
  tool:      string,
  args:      Record<string, unknown>,
  onConfirm: (command: string) => Promise<ConfirmResult>,
): Promise<string> {
  switch (tool) {
    case 'fs_read':
    case 'readFile': {
      const p = safePath(args['path'] as string);
      const content = await fs.readFile(p, 'utf8');
      return content.length > MAX_FILE_SIZE
        ? JSON.stringify({ content: content.slice(0, MAX_FILE_SIZE), truncated: true, totalLength: content.length })
        : content;
    }

    case 'fs_write':
    case 'writeFile': {
      const p = safePath(args['path'] as string);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, args['content'] as string, 'utf8');
      return JSON.stringify({
        success: true,
        path: path.relative(CWD, p),
        bytesWritten: Buffer.byteLength(args['content'] as string, 'utf8'),
      });
    }

    case 'fs_edit':
    case 'editFile': {
      const p = safePath(args['path'] as string);
      const oldString = args['oldString'] as string;
      const newString = args['newString'] as string;
      const content = await fs.readFile(p, 'utf8');
      const occurrences = content.split(oldString).length - 1;
      if (occurrences === 0) throw new Error('oldString not found in file');
      if (occurrences > 1) throw new Error(`oldString is ambiguous; found ${occurrences} matches`);
      await fs.writeFile(p, content.replace(oldString, newString), 'utf8');
      return JSON.stringify({ success: true, path: path.relative(CWD, p) });
    }

    case 'fs_list':
    case 'listDirectory': {
      const p = safePath((args['path'] as string | undefined) ?? '.');
      const entries = await fs.readdir(p, { withFileTypes: true });
      const results: { name: string; type: 'file' | 'directory' }[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        results.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' });
      }
      results.sort((a, b) =>
        a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name),
      );
      return JSON.stringify({ path: path.relative(CWD, p) || '.', entries: results });
    }

    case 'glob': {
      const pattern = (args['pattern'] as string) ?? '**/*';
      const basePath = safePath((args['path'] as string | undefined) ?? '.');
      const files = await fg(pattern, {
        cwd: basePath,
        dot: false,
        onlyFiles: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        absolute: false,
      });
      const rel = files.map(f => path.relative(CWD, path.resolve(basePath, f))).sort();
      const truncated = rel.length > MAX_RESULTS;
      return JSON.stringify({
        files: rel.slice(0, MAX_RESULTS),
        ...(truncated ? { truncated: true, totalFiles: rel.length } : {}),
      });
    }

    case 'fs_search':
    case 'grep': {
      const pattern = args['pattern'] as string;
      const basePath = safePath((args['path'] as string | undefined) ?? '.');
      const include = args['include'] as string | undefined;
      const grepArgs = [
        '-rn',
        '--color=never',
        '--exclude-dir=node_modules',
        '--exclude-dir=.git',
        '-E',
      ];
      if (include) grepArgs.push(`--include=${include}`);
      grepArgs.push(pattern, basePath);

      return new Promise<string>((resolve, reject) => {
        execFile('grep', grepArgs, { cwd: CWD, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          const exitCode = err && (err as NodeJS.ErrnoException).code !== undefined
            ? (err as NodeJS.ErrnoException).code
            : err ? 1 : 0;
          if (exitCode !== 0 && exitCode !== 1) {
            reject(new Error(`grep failed: ${stderr.trim()}`));
            return;
          }
          if (!stdout.trim()) {
            resolve(JSON.stringify({ matches: [], message: 'No matches found' }));
            return;
          }
          const lines = stdout.trim().split('\n');
          const matches: { file: string; line: number; content: string }[] = [];
          let truncated = false;
          for (const line of lines) {
            if (matches.length >= MAX_MATCHES) { truncated = true; break; }
            const match = line.match(/^(.+?):(\d+):(.*)$/);
            if (match) {
              matches.push({
                file: path.relative(CWD, match[1]!),
                line: Number(match[2]),
                content: match[3]!,
              });
            }
          }
          resolve(JSON.stringify({
            matches,
            ...(truncated ? { truncated: true, totalMatches: lines.length } : {}),
          }));
        });
      });
    }

    case 'bash_run':
    case 'bash': {
      const cmd          = args['command'] as string;
      const timeoutArg   = args['timeout'] as number | undefined;
      const timeoutMs    = timeoutArg ?? DEFAULT_TIMEOUT;
      const isBackground = /&\s*$/.test(cmd);

      if (!isYoloMode() && !isAllowed('bash_run', cmd)) {
        const answer = await onConfirm(cmd);
        if (answer === 'always')   allowAlways('bash_run', cmd);
        else if (answer === 'no')  return JSON.stringify({ error: 'user denied' });
      }

      if (isBackground) {
        const child = spawn('bash', ['-c', cmd], { cwd: CWD, stdio: 'ignore', detached: true });
        child.unref();
        return JSON.stringify({ stdout: '[started in background]', stderr: '', exit_code: 0 });
      }

      // Foreground bash with explicit hard-kill on timeout.
      return new Promise<string>((resolve) => {
        let resolved = false;
        const effectiveTimeout = Math.min(timeoutMs, BASH_TIMEOUT_MS);
        const proc = execFile(
          'bash',
          ['-c', cmd],
          { cwd: CWD, timeout: effectiveTimeout, killSignal: 'SIGTERM', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, TERM: 'dumb' } },
          (err, stdout, stderr) => {
            if (resolved) return;
            resolved = true;
            const exitCode = err && (err as NodeJS.ErrnoException).code !== undefined
              ? (err as NodeJS.ErrnoException).code
              : err ? 1 : 0;
            const killed = err && (err as { killed?: boolean }).killed;
            resolve(JSON.stringify({
              stdout: truncate(stdout ?? '', MAX_OUTPUT),
              stderr: truncate(stderr ?? '', MAX_OUTPUT),
              exit_code: exitCode,
              ...(killed ? { timed_out: true } : {}),
            }));
          },
        );
        const hardKill = setTimeout(() => {
          if (resolved) return;
          try { proc.kill('SIGKILL'); } catch { /* ignore */ }
          if (!resolved) {
            resolved = true;
            resolve(JSON.stringify({
              stdout: '',
              stderr: `bash_run hard-killed after ${effectiveTimeout + 5_000}ms`,
              exit_code: 137,
              timed_out: true,
            }));
          }
        }, effectiveTimeout + 5_000);
        proc.on('exit', () => clearTimeout(hardKill));
      });
    }

    default:
      return JSON.stringify({ error: `unknown relay tool: ${tool}` });
  }
}
