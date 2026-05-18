/**
 * Local tool executor — runs on the CLIENT machine where nclaw is launched.
 *
 * Critical design principle (Claude Code / opencode parity):
 *   All file and shell operations use `process.cwd()` evaluated at call time,
 *   NOT a constant frozen at module load. This means:
 *     - If the user runs `nclaw` in ~/my-project, all fs_read/write/list
 *       and bash_run ops happen in ~/my-project on THEIR machine.
 *     - If they `/cd` to a new dir, subsequent calls reflect that immediately.
 *
 *   The server-side agent sees the client cwd through the `context` field
 *   (injected by scanTree). The agent then issues tool calls that come back
 *   here to execute locally. This is the same model as Claude Code's
 *   local tool relay.
 *
 * Diff support:
 *   fs_write returns an extended payload with { ok, path, bytes, before, after, mode }
 *   so the TUI can render an inline diff without a second file read.
 *
 * safePath() is intentionally loose — it resolves relative paths against
 * the live cwd and only blocks actual path-traversal escapes (../ above root).
 * There is NO artificial "only within cwd" jail because legitimate tasks
 * (e.g. writing to ~/Desktop, reading /etc/hosts) need to work.
 * The bash_run confirmation gate is the primary safety boundary.
 */
import fs   from 'fs/promises';
import path from 'path';
import { execFile, spawn } from 'child_process';
import type { ConfirmResult } from './confirm';
import { isAllowed, allowAlways, isYoloMode } from './permissions';

const BASH_TIMEOUT_MS = 120_000;

/**
 * Resolve a path relative to the CURRENT working directory.
 * Uses process.cwd() at call time — not a frozen constant.
 */
function getCwd(): string {
  return process.cwd();
}

function resolvePath(p: string): string {
  const expanded = p.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? '~');
  return path.isAbsolute(expanded) ? expanded : path.resolve(getCwd(), expanded);
}

export async function executeToolCall(
  tool:      string,
  args:      Record<string, unknown>,
  onConfirm: (command: string) => Promise<ConfirmResult>,
): Promise<string> {
  switch (tool) {

    // ── fs_read ───────────────────────────────────────────────────────────────
    case 'fs_read': {
      const p = resolvePath(args['path'] as string);
      try {
        return await fs.readFile(p, 'utf8');
      } catch (e) {
        return JSON.stringify({ error: `fs_read failed: ${(e as Error).message}`, path: p });
      }
    }

    // ── fs_write ──────────────────────────────────────────────────────────────
    // Returns { ok, path, bytes, before, after, mode } so the TUI can diff.
    case 'fs_write': {
      const p       = resolvePath(args['path'] as string);
      const content = args['content'] as string;
      const mode    = (args['mode'] as string | undefined) ?? 'overwrite';

      // Read existing content for diff (null = new file)
      let before: string | null = null;
      try { before = await fs.readFile(p, 'utf8'); } catch { /* new file */ }

      try {
        await fs.mkdir(path.dirname(p), { recursive: true });
        if (mode === 'append') {
          await fs.appendFile(p, content, 'utf8');
        } else if (mode === 'create') {
          await fs.writeFile(p, content, { encoding: 'utf8', flag: 'wx' });
        } else {
          await fs.writeFile(p, content, 'utf8');
        }

        const after = mode === 'append' ? (before ?? '') + content : content;

        return JSON.stringify({
          ok:     true,
          path:   p,
          bytes:  Buffer.byteLength(content),
          before,
          after,
          mode: (before === null && mode !== 'append') ? 'create' : mode,
        });
      } catch (e) {
        return JSON.stringify({ error: `fs_write failed: ${(e as Error).message}`, path: p });
      }
    }

    // ── fs_list ───────────────────────────────────────────────────────────────
    case 'fs_list': {
      const rawPath = (args['path'] as string | undefined) ?? '.';
      const p       = resolvePath(rawPath);
      try {
        const entries = await fs.readdir(p, { withFileTypes: true });
        return entries
          .map(e => e.isDirectory() ? `${e.name}/` : e.name)
          .join('\n');
      } catch (e) {
        return JSON.stringify({ error: `fs_list failed: ${(e as Error).message}`, path: p });
      }
    }

    // ── fs_search ─────────────────────────────────────────────────────────────
    case 'fs_search': {
      const pattern = args['pattern'] as string;
      const rawPath = (args['path'] as string | undefined) ?? '.';
      const p       = resolvePath(rawPath);
      const maxRes  = (args['max_results'] as number | undefined) ?? 50;
      const cwd     = getCwd();

      return new Promise<string>(resolve => {
        const rg = spawn('rg', ['--line-number', '--no-heading', '-e', pattern, p], {
          cwd, stdio: ['ignore', 'pipe', 'ignore'],
        });
        let out = '';
        rg.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        rg.on('error', () => {
          const grep = spawn('grep', ['-rn', pattern, p], {
            cwd, stdio: ['ignore', 'pipe', 'ignore'],
          });
          let gout = '';
          grep.stdout.on('data', (d: Buffer) => { gout += d.toString(); });
          grep.on('close', () => {
            const lines = gout.split('\n').filter(Boolean).slice(0, maxRes);
            resolve(lines.join('\n') || '(no matches)');
          });
          grep.on('error', () => resolve('(fs_search: no search tool available)'));
        });
        rg.on('close', () => {
          const lines = out.split('\n').filter(Boolean).slice(0, maxRes);
          resolve(lines.join('\n') || '(no matches)');
        });
      });
    }

    // ── bash_run ──────────────────────────────────────────────────────────────
    case 'bash_run': {
      const cmd          = args['command'] as string;
      const cwd          = getCwd();
      const isBackground = /&\s*$/.test(cmd);

      if (!isYoloMode() && !isAllowed('bash_run', cmd)) {
        const answer = await onConfirm(cmd);
        if (answer === 'always')  allowAlways('bash_run', cmd);
        else if (answer === 'no') return JSON.stringify({ error: 'user denied' });
      }

      if (isBackground) {
        const child = spawn('bash', ['-c', cmd], { cwd, stdio: 'ignore', detached: true });
        child.unref();
        return JSON.stringify({ stdout: '[started in background]', stderr: '', exit_code: 0, cwd });
      }

      return new Promise<string>((resolve) => {
        let resolved = false;
        const proc   = execFile(
          'bash',
          ['-c', cmd],
          { cwd, timeout: BASH_TIMEOUT_MS, killSignal: 'SIGTERM', maxBuffer: 10 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (resolved) return;
            resolved   = true;
            const exitCode = err
              ? ((err as NodeJS.ErrnoException).code != null
                  ? (err as NodeJS.ErrnoException).code
                  : 1)
              : 0;
            const killed = err && (err as { killed?: boolean }).killed;
            resolve(JSON.stringify({
              stdout:    stdout ?? '',
              stderr:    stderr ?? '',
              exit_code: exitCode,
              cwd,
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
              stdout:    '',
              stderr:    `bash_run hard-killed after ${BASH_TIMEOUT_MS + 5_000}ms`,
              exit_code: 137,
              timed_out: true,
              cwd,
            }));
          }
        }, BASH_TIMEOUT_MS + 5_000);
        proc.on('exit', () => clearTimeout(hardKill));
      });
    }

    default:
      return JSON.stringify({ error: `unknown relay tool: ${tool}` });
  }
}
