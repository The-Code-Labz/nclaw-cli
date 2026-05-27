// Inspired by OpenCode's theme palette — works with Ink's default chalk palette.
// Ink's `color` prop accepts named colors and hex strings.

export const theme = {
  // Text
  text:        'white',           // primary content
  textMuted:   'gray',            // secondary/dim content
  textInverse: 'black',
  textFaint:   'gray',            // very dim / decorative text (dividers, context lines)

  // Brand / accents
  primary:     'magenta',         // assistant name + spinner highlight
  secondary:   'cyanBright',      // user name + prompt cursor
  accent:      'yellow',          // tool icons / spinner
  brand:       'magenta',         // logo / branding color (alias for primary)

  // Status
  success:     'green',
  warning:     'yellow',
  error:       'red',
  info:        'blueBright',

  // Borders
  border:      'gray',
  borderActive:'cyan',
  borderWarn:  'yellow',
  borderError: 'red',
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];

// Per-tool visual identity, ported from OpenCode (InlineTool icon + pending).
export interface ToolStyle {
  icon:    string;
  color:   string;
  pending: string;
}

const DEFAULT_TOOL: ToolStyle = { icon: '⚙', color: theme.accent, pending: 'Working...' };

const TOOLS: Record<string, ToolStyle> = {
  // File ops
  fs_read:   { icon: '→', color: theme.info,    pending: 'Reading...'         },
  read:      { icon: '→', color: theme.info,    pending: 'Reading...'         },
  fs_write:  { icon: '←', color: theme.success, pending: 'Preparing write...' },
  write:     { icon: '←', color: theme.success, pending: 'Preparing write...' },
  fs_edit:   { icon: '←', color: theme.success, pending: 'Preparing edit...'  },
  edit:      { icon: '←', color: theme.success, pending: 'Preparing edit...'  },
  fs_list:   { icon: '⋮', color: theme.info,    pending: 'Listing...'         },
  glob:      { icon: '✱', color: theme.accent,  pending: 'Finding files...'   },
  grep:      { icon: '✱', color: theme.accent,  pending: 'Searching content...' },

  // Shell
  bash_run:  { icon: '$', color: theme.primary, pending: 'Writing command...' },
  shell:     { icon: '$', color: theme.primary, pending: 'Writing command...' },
  bash:      { icon: '$', color: theme.primary, pending: 'Writing command...' },

  // Web
  webfetch:        { icon: '%', color: theme.info, pending: 'Fetching from the web...' },
  browserless_fetch: { icon: '%', color: theme.info, pending: 'Fetching page...' },
  websearch:       { icon: '◈', color: theme.info, pending: 'Searching web...' },
  web_search:      { icon: '◈', color: theme.info, pending: 'Searching web...' },

  // Patch / apply
  apply_patch: { icon: '%', color: theme.success, pending: 'Preparing patch...' },

  // Tasks
  task:      { icon: '│', color: theme.info,    pending: 'Spawning subagent...' },
  todowrite: { icon: '⚙', color: theme.accent,  pending: 'Updating todos...'    },
  question:  { icon: '→', color: theme.warning, pending: 'Asking questions...'  },
  skill:     { icon: '→', color: theme.info,    pending: 'Loading skill...'     },

  // Memory / vault (NeuroClaw-specific)
  search_memory:           { icon: '◇', color: theme.info, pending: 'Searching memory...' },
  retrieve_relevant_memory:{ icon: '◇', color: theme.info, pending: 'Recalling...'        },
  write_vault_note:        { icon: '◆', color: theme.success, pending: 'Saving note...'   },
  save_session_summary:    { icon: '◆', color: theme.success, pending: 'Summarising...'   },

  // Agent comms
  message_agent:       { icon: '✉', color: theme.primary, pending: 'Messaging agent...' },
  assign_task_to_agent:{ icon: '↪', color: theme.primary, pending: 'Assigning task...' },
  notify_user:         { icon: '⚠', color: theme.warning, pending: 'Notifying user...' },
  spawn_agent:         { icon: '│', color: theme.info,    pending: 'Spawning agent...' },
  run_subtask:         { icon: '│', color: theme.info,    pending: 'Running subtask...' },
};

export function toolStyle(tool: string): ToolStyle {
  return TOOLS[tool] ?? DEFAULT_TOOL;
}
