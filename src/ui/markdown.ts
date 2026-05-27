// Terminal markdown rendering for assistant text.
// Uses `marked` + `marked-terminal` with a custom renderer wired into our theme.
//
// IMPORTANT: this function is called mid-stream with possibly-malformed input
// (unclosed code fences, dangling backticks, etc). On any parse error it
// returns the original input untouched.

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

// Theme color mapping. We mirror src/ui/theme.ts but use chalk's color functions
// directly because marked-terminal does not understand Ink's named theme tokens.
const accent     = chalk.yellow;
const info       = chalk.blueBright;
const primary    = chalk.magenta;
const textMuted  = chalk.gray;

// Configure marked-terminal once at module load. Reflow / emoji are disabled
// because terminal width is unpredictable and emoji breaks alignment.
let configured = false;
function configure(): void {
  if (configured) return;
  configured = true;

  marked.use(
    markedTerminal(
      {
        // Headers
        firstHeading: info.bold,           // h1
        heading:      primary.bold,        // h2+ (overridden below for granularity)

        // Emphasis
        strong: chalk.bold,
        em:     chalk.italic,
        del:    chalk.strikethrough,

        // Code
        code:        (text: string) => text, // block code: no syntax highlighting; preserve as-is
        codespan:    accent,                  // inline code

        // Lists
        listitem: (text: string) => text,
        list:     (text: string) => text,

        // Links / images render as: text (url) in muted color
        link: (href: string, _title: string | undefined, text: string) => {
          const label = text || href;
          if (!href || href === label) return textMuted(label);
          return `${label} ${textMuted('(' + href + ')')}`;
        },
        href: (href: string) => textMuted(href),

        // Blockquote
        blockquote: textMuted.italic,

        // Horizontal rule
        hr: () => textMuted('─'.repeat(40)),

        // Tables — just dim, nothing fancy
        table: (text: string) => text,

        // Misc
        paragraph: (text: string) => text,
        text:      (text: string) => text,

        // Knobs
        reflowText:  false,         // do NOT reflow — terminal width is unpredictable
        tab:         2,
        showSectionPrefix: false,
        unescape:    true,
        emoji:       false,         // do NOT auto-replace :emoji: shortcuts
        width:       0,             // 0 disables width-based wrapping
      },
      // Pass our highlight options (no syntax highlighter — keep deps lean)
      {},
    ),
  );
}

/**
 * Render markdown to ANSI-colored terminal output.
 * Safe to call on partial/mid-stream text — falls back to the raw input
 * if parsing fails (e.g. unclosed code fence).
 */
export function renderMarkdown(input: string): string {
  if (!input) return input;
  try {
    configure();
    // marked.parse may return a Promise in newer versions if async extensions
    // are used; with our config it returns a string synchronously.
    const out = marked.parse(input, { async: false }) as string;
    // marked-terminal appends a trailing newline; strip it so we don't get
    // an extra blank row in the bubble.
    return typeof out === 'string' ? out.replace(/\n$/, '') : input;
  } catch {
    return input;
  }
}
