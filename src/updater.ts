/**
 * Self-updater for nclaw.
 *
 * Determines the install root by resolving __dirname/../ (dist → project root).
 * Runs: git pull → npm install → npm run build
 * Streams output line-by-line via an async generator so the caller can
 * display progress in real time without blocking the event loop.
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/** Resolve the nclaw project root from the running binary's __dirname. */
export function getInstallRoot(): string {
  // At runtime: __dirname = <root>/dist
  // So parent = <root>
  const root = path.resolve(__dirname, '..');
  // Sanity check — must have package.json with name "nclaw"
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'nclaw') throw new Error('wrong package');
  } catch {
    throw new Error(`Could not locate nclaw install root (tried ${root})`);
  }
  return root;
}

export interface UpdateLine {
  stream: 'stdout' | 'stderr' | 'info' | 'error';
  text:   string;
}

/**
 * Run the update sequence and yield output lines.
 * Resolves with the final exit code.
 */
export async function* runUpdate(): AsyncGenerator<UpdateLine, number, unknown> {
  const root = getInstallRoot();
  yield { stream: 'info', text: `Install root: ${root}` };

  // Detect whether git is available
  try {
    await runCmd('git', ['--version'], root);
  } catch {
    yield { stream: 'error', text: 'git not found — cannot self-update.' };
    return 1;
  }

  const steps: Array<{ label: string; cmd: string; args: string[] }> = [
    { label: 'Pulling latest…',           cmd: 'git',  args: ['pull', '--ff-only', 'origin', 'main'] },
    { label: 'Installing dependencies…',  cmd: 'npm',  args: ['install', '--silent'] },
    { label: 'Building…',                 cmd: 'npm',  args: ['run', 'build'] },
  ];

  for (const step of steps) {
    yield { stream: 'info', text: step.label };
    const code = yield* spawnLines(step.cmd, step.args, root);
    if (code !== 0) {
      yield { stream: 'error', text: `Step failed with exit code ${code}. Update aborted.` };
      return code;
    }
  }

  // Read new version from package.json
  try {
    const pkg  = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const ver  = pkg.version ?? '?';
    yield { stream: 'info', text: `Done — nclaw v${ver} ready. Restart to apply.` };
  } catch {
    yield { stream: 'info', text: 'Done. Restart nclaw to apply the update.' };
  }

  return 0;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function runCmd(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', resolve);
  });
}

async function* spawnLines(
  cmd:  string,
  args: string[],
  cwd:  string,
): AsyncGenerator<UpdateLine, number, unknown> {
  const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

  // Buffer + emit lines from stdout
  let outBuf = '';
  proc.stdout!.setEncoding('utf8');
  proc.stdout!.on('data', (d: string) => { outBuf += d; });

  let errBuf = '';
  proc.stderr!.setEncoding('utf8');
  proc.stderr!.on('data', (d: string) => { errBuf += d; });

  const exitCode = await new Promise<number>((resolve) => {
    proc.on('close', (code) => resolve(code ?? 0));
    proc.on('error', () => resolve(1));
  });

  // Yield buffered lines after process finishes
  for (const line of outBuf.split('\n').filter(Boolean)) {
    yield { stream: 'stdout', text: line };
  }
  for (const line of errBuf.split('\n').filter(Boolean)) {
    yield { stream: 'stderr', text: line };
  }

  return exitCode;
}
