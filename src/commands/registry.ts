import { spawn } from 'child_process';
import type { Command } from './types';

// ── Clipboard helpers ───────────────────────────────────────────────────────
// Try clipboard tools in order: pbcopy (mac), wl-copy (wayland), xclip,
// xsel. Each is attempted via spawn; on ENOENT we fall through to the next.
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
      try {
        proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      } catch {
        tryNext(i + 1);
        return;
      }
      proc.on('error', () => tryNext(i + 1));
      proc.on('exit', (code) => {
        if (code === 0) resolve(true);
        else tryNext(i + 1);
      });
      try {
        proc.stdin.write(text);
        proc.stdin.end();
      } catch {
        tryNext(i + 1);
      }
    };
    tryNext(0);
  });
}

// ── Commands ───────────────────────────────────────────────────────────────

export const commands: Command[] = [
  {
    name: 'help',
    slash: '/help',
    description: 'Show available commands',
    category: 'help',
    run: (ctx) => {
      // App.tsx watches for the sentinel and renders inline help.
      ctx.emitSystem('__internal_help__');
    },
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
      ctx.emitSystem(ok ? 'Copied last assistant message to clipboard.' : 'No clipboard tool found (tried pbcopy, wl-copy, xclip, xsel).');
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
      // Lazy require so this works whether or not permissions module exists.
      // Task 6 implements src/permissions.ts; until then we just stub.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const perms = require('../permissions');
        const data = perms.loadPermissions();
        const lines: string[] = ['Tool allowlist:'];
        for (const tool of Object.keys(data)) {
          const conf = data[tool] as { alwaysAllow: boolean; patterns: string[] };
          if (conf.alwaysAllow) lines.push(`  ${tool}: ALL`);
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
    name: 'theme',
    slash: '/theme',
    description: 'Cycle to the next color theme',
    category: 'system',
    run: (ctx) => {
      ctx.cycleTheme?.();
      ctx.showToast?.('Theme changed', 'success', 2000);
    },
  },
  {
    name: 'yolo',
    slash: '/yolo',
    description: 'Toggle yolo mode (skip bash confirmation prompts)',
    category: 'system',
    run: (ctx) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const perms = require('../permissions');
        const was = perms.isYoloMode?.() ?? false;
        perms.setYoloMode?.(!was);
        const now = !was;
        ctx.showToast?.(now ? '🔥 Yolo mode ON — bash commands auto-approved' : 'Yolo mode OFF', now ? 'error' : 'info', 3000);
        ctx.emitSystem(now ? '🔥 Yolo mode enabled — bash commands will not prompt for confirmation.' : 'Yolo mode disabled.');
      } catch {
        ctx.emitSystem('/yolo: permissions module not available');
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

// Re-export so consumers can import everything from ./commands/registry.
export type { Command, CommandContext } from './types';
