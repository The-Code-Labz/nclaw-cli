/**
 * Terminal markdown renderer — safe for mid-stream partial input.
 *
 * Uses marked + marked-terminal with a custom palette matching our theme.
 * Falls back to raw text on any parse failure.
 *
 * Improvements over original:
 * - Syntax highlighting via cli-highlight (optional, graceful fallback)
 * - Better code fence handling on partial streams (strips unclosed fences)
 * - Heading levels h1-h3 styled distinctly
 * - Consistent table rendering
 */

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

// ── Palette (mirrors theme.ts but uses chalk directly) ───────────────────────
const clrPrimary  = chalk.hex('#A855F7');
const clrAccent   = chalk.hex('#FBBF24');
const clrInfo     = chalk.hex('#60A5FA');
const clrSuccess  = chalk.hex('#22C55E');
const clrMuted    = chalk.hex('#6B7280');
const clrWarn     = chalk.hex('#F59E0B');

// ── cli-highlight (optional) ─────────────────────────────────────────────────
// If the package isn't installed we silently skip syntax coloring.
let highlight: ((code: string, opts: { language: string }) => string) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ch = require('cli-highlight');
  highlight = ch.highlight;
} catch { /* not installed — graceful degradation */ }

// ── configured flag ───────────────────────────────────────────────────────────
let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;

  marked.use(
    markedTerminal(
      {
        // Headings
        firstHeading: clrInfo.bold.underline,     // h1
        heading:      clrPrimary.bold,             // h2+

        // Emphasis
        strong: chalk.bold,
        em:     chalk.italic,
        del:    chalk.strikethrough,

        // Code
        code: (text: string, lang?: string): string => {
          if (highlight && lang) {
            try {
              const colored = highlight(text, { language: lang });
              const border  = clrMuted('─'.repeat(Math.min(60, process.stdout.columns ?? 80)));
              return `\n${border}\n${colored}\n${border}`;
            } catch { /* unsupported language */ }
          }
          // Fallback: dim the block with a simple border
          const border = clrMuted('─'.repeat(Math.min(60, process.stdout.columns ?? 80)));
          return `\n${border}\n${clrMuted(text)}\n${border}`;
        },
        codespan: clrAccent,                       // `inline code`

        // Lists
        listitem: (text: string) => text,
        list:     (text: string) => text,

        // Links
        link: (href: string, _title: string | undefined, text: string) => {
          const label = text || href;
          if (!href || href === label) return clrInfo(label);
          return `${chalk.underline(label)} ${clrMuted('(' + href + ')')}`;
        },
        href: (href: string) => clrInfo.underline(href),

        // Blockquote
        blockquote: clrMuted.italic,

        // HR
        hr: () => clrMuted('─'.repeat(Math.min(60, process.stdout.columns ?? 80))),

        // Tables
        table: (text: string) => text,

        // Paragraph / text pass-through
        paragraph: (text: string) => text,
        text:      (text: string) => text,

        // Layout
        reflowText:        false,
        tab:               2,
        showSectionPrefix: false,
        unescape:          true,
        emoji:             false,
        width:             0,
      },
      {},
    ),
  );
}

/**
 * Sanitise partial mid-stream markdown so marked doesn't crash on unclosed
 * constructs. We:
 * 1. Close any unclosed triple-backtick fences.
 * 2. Do NOT close bold/italic spans — they're cheap to leave open.
 */
function sanitizePartial(input: string): string {
  // Count backtick fences
  const fenceRe = /^```/gm;
  const matches = input.match(fenceRe);
  if (matches && matches.length % 2 !== 0) {
    // Odd number of fences → add a closing fence.
    return input + '\n```';
  }
  return input;
}

/**
 * Render markdown to ANSI-colored terminal output.
 * Safe to call on partial / mid-stream text. Falls back to raw input on error.
 */
export function renderMarkdown(input: string): string {
  if (!input) return input;
  try {
    configure();
    const safe = sanitizePartial(input);
    const out  = marked.parse(safe, { async: false }) as string;
    // Strip trailing newline that marked-terminal appends.
    return typeof out === 'string' ? out.replace(/\n$/, '') : input;
  } catch {
    return input;
  }
}
