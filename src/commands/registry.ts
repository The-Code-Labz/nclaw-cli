import { spawn } from 'child_process';
import type { Command } from './types';
import { runUpdate } from '../updater';

// ── Clipboard helpers ────────────────────────────────────────────────────────
function copyToClipboard(text: string): Promise<boolean> {
  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'pbcopy',  args: [] },
    { cmd: 'wl-copy', args: [] },
    { cmd: 'xclip',   args: ['-selection', 'clipboard'] },
    { cmd: 'xsel',    args: ['--clipboard', '--input'] },
  ];
  return new Promise((resolve) => {
    const tryNext = (i: number) => {
      if (i >= candidates.length) { resolve(false); return; }
      const { cmd, args } = candidates[i]!;
      let proc;
      try { proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] }); }
      catch { tryNext(i + 1); return; }
      proc.on('error', () => tryNext(i + 1));
      proc.on('exit', (code) => {
        if (code === 0) resolve(true);
        else tryNext(i + 1);
      });
      try { proc.stdin.write(text); proc.stdin.end(); }
      catch { tryNext(i + 1); }
    };
    tryNext(0);
  });
}

// ── Commands ─────────────────────────────────────────────────────────────────

export const commands: Command[] = [
  {
    name: 'help',
    slash: '/help',
    description: 'Show available commands',
    category: 'help',
    run: (ctx) => { ctx.emitSystem('__internal_help__'); },
  },
  {
    name: 'clear',
    slash: '/clear',
    aliases: ['/cls'],
    description: 'Clear the screen',
    category: 'session',
    run: (ctx) => ctx.clearScreen(),
  },
  {
    name: 'new',
    slash: '/new',
    description: 'Start a new session',
    category: 'session',
    run: (ctx) => ctx.newSession(),
  },
  {
    name: 'agent',
    slash: '/agent',
    description: 'Switch agent',
    category: 'agent',
    run: (ctx) => ctx.openAgentPick(),
  },
  {
    name: 'retry',
    slash: '/retry',
    description: 'Re-send the last user message',
    category: 'session',
    run: (ctx) => ctx.retryLast(),
  },
  {
    name: 'exit',
    slash: '/exit',
    aliases: ['/quit'],
    description: 'Exit nclaw',
    category: 'system',
    run: (ctx) => ctx.exit(),
  },
  {
    name: 'cwd',
    slash: '/cwd',
    description: 'Print current working directory',
    category: 'system',
    run: (ctx) => {
      ctx.emitSystem(process.cwd());
      ctx.setCwdDisplay(process.cwd());
    },
  },
  {
    name: 'copy',
    slash: '/copy',
    description: 'Copy last assistant message to clipboard',
    category: 'session',
    run: async (ctx) => {
      const last = ctx.getLastAgentMessage();
      if (!last) { ctx.emitSystem('No assistant message to copy.'); return; }
      const ok = await copyToClipboard(last);
      ctx.emitSystem(ok
        ? 'Copied to clipboard.'
        : 'No clipboard tool found (tried pbcopy, wl-copy, xclip, xsel).',
      );
    },
  },
  {
    name: 'sessions',
    slash: '/sessions',
    description: 'List sessions (not yet implemented)',
    category: 'session',
    run: (ctx) => ctx.emitSystem('/sessions: not yet implemented'),
  },
  {
    name: 'permissions',
    slash: '/permissions',
    description: 'Show tool allowlist',
    category: 'system',
    run: (ctx) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const perms = require('../permissions');
        const data  = perms.loadPermissions();
        const lines: string[] = ['Tool allowlist:'];
        for (const tool of Object.keys(data)) {
          const conf = data[tool] as { alwaysAllow: boolean; patterns: string[] };
          if (conf.alwaysAllow)          lines.push(`  ${tool}: ALL`);
          else if (conf.patterns.length) lines.push(`  ${tool}: ${conf.patterns.join(', ')}`);
        }
        if (lines.length === 1) lines.push('  (empty)');
        ctx.emitSystem(lines.join('\n'));
      } catch {
        ctx.emitSystem('/permissions: not yet implemented');
      }
    },
  },
  {
    name: 'update',
    slash: '/update',
    description: 'Pull latest nclaw from GitHub and rebuild',
    category: 'system',
    run: async (ctx) => {
      ctx.emitSystem('Starting update…');
      try {
        const gen = runUpdate();
        let result = await gen.next();
        while (!result.done) {
          const line = result.value;
          const prefix =
            line.stream === 'info'   ? '  → ' :
            line.stream === 'error'  ? '  ✗ ' :
            line.stream === 'stderr' ? '  ! ' :
                                       '    ';
          ctx.emitSystem(prefix + line.text);
          result = await gen.next();
        }
        const code = result.value;
        if (code === 0) {
          ctx.emitSystem('  ✓ Update complete. Restart nclaw to run the new version.');
        } else {
          ctx.emitSystem(`  ✗ Update failed (exit ${code}).`);
        }
      } catch (e) {
        ctx.emitSystem(`  ✗ Update error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },
];

/** Resolve an input string to a Command by exact slash or alias match. */
export function findCommand(input: string): Command | null {
  const head = input.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  for (const cmd of commands) {
    if (cmd.slash === head) return cmd;
    if (cmd.aliases?.includes(head)) return cmd;
  }
  return null;
}

export type { Command, CommandContext } from './types';
