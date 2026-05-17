import fs from 'fs/promises';
import path from 'path';
import { execFile, spawn } from 'child_process';
import type { ConfirmResult } from './confirm';
import { isAllowed, allowAlways, isYoloMode } from './permissions';

const CWD = process.cwd();

const BASH_TIMEOUT_MS = 120_000;

function safePath(p: string): string {
  const resolved = path.resolve(CWD, p);
  if (!resolved.startsWith(CWD + path.sep) && resolved !== CWD) {
    throw new Error(`Path escape blocked: ${p}`);
  }
  return resolved;
}

export async function executeToolCall(
  tool:      string,
  args:      Record<string, unknown>,
  onConfirm: (command: string) => Promise<ConfirmResult>,
): Promise<string> {
  switch (tool) {
    case 'fs_read': {
      const p = safePath(args['path'] as string);
      return await fs.readFile(p, 'utf8');
    }

    case 'fs_write': {
      const p = safePath(args['path'] as string);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, args['content'] as string, 'utf8');
      return 'ok';
    }

    case 'fs_list': {
      const p = safePath((args['path'] as string | undefined) ?? '.');
      const entries = await fs.readdir(p, { withFileTypes: true });
      return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
    }

    case 'bash_run': {
      const cmd          = args['command'] as string;
      const isBackground = /&\s*$/.test(cmd);
      // YOLO mode skips confirmation entirely.
      // Otherwise, check the persistent allowlist by command head (first
      // whitespace-separated token, e.g. "git" for "git status -s"). If
      // the head is already allowed, skip the prompt; if user picks
      // "always" we persist the head so future invocations are auto-OK.
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

      // Foreground bash with explicit hard-kill on timeout (SIGKILL after SIGTERM grace).
      return new Promise<string>((resolve) => {
        let resolved = false;
        const proc = execFile(
          'bash',
          ['-c', cmd],
          { cwd: CWD, timeout: BASH_TIMEOUT_MS, killSignal: 'SIGTERM', maxBuffer: 10 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (resolved) return;
            resolved = true;
            const exitCode = err && (err as NodeJS.ErrnoException).code !== undefined
              ? (err as NodeJS.ErrnoException).code
              : err ? 1 : 0;
            const killed = err && (err as { killed?: boolean }).killed;
            resolve(JSON.stringify({
              stdout: stdout ?? '',
              stderr: stderr ?? '',
              exit_code: exitCode,
              ...(killed ? { timed_out: true } : {}),
            }));
          },
        );
        // Belt-and-suspenders: if execFile's own timeout fails to kill the
        // process (rare but observed with stubborn children), force SIGKILL.
        const hardKill = setTimeout(() => {
          if (resolved) return;
          try { proc.kill('SIGKILL'); } catch { /* ignore */ }
          if (!resolved) {
            resolved = true;
            resolve(JSON.stringify({
              stdout: '',
              stderr: `bash_run hard-killed after ${BASH_TIMEOUT_MS + 5_000}ms`,
              exit_code: 137,
              timed_out: true,
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
