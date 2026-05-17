// NeuroClaw CLI — visual theme
// Inspired by Claude Code + OpenCode palettes.
// All hex strings are supported by Ink via chalk under the hood.

export const theme = {
  // Text
  text:        'white',
  textMuted:   '#6B7280',   // gray-500 — secondary/dim content
  textFaint:   '#374151',   // gray-700 — very dim
  textInverse: 'black',

  // Brand
  primary:     '#A855F7',   // purple-500 — agent name, primary accents
  secondary:   '#22D3EE',   // cyan-400   — user name, prompt cursor
  accent:      '#FBBF24',   // amber-400  — tool icons, spinner

  // Status
  success:     '#22C55E',   // green-500
  warning:     '#F59E0B',   // amber-500
  error:       '#EF4444',   // red-500
  info:        '#60A5FA',   // blue-400

  // Borders / structure
  border:      '#374151',   // gray-700
  borderActive:'#22D3EE',   // cyan-400
  borderWarn:  '#F59E0B',
  borderError: '#EF4444',

  // Surfaces
  surface:     '#111827',   // gray-900
  surfaceRaised:'#1F2937',  // gray-800

  // NeuroClaw brand
  brand:       '#8B5CF6',   // violet-500
} as const;

export type ThemeColor = string;

// ── Tool visual identity ──────────────────────────────────────────────────
export interface ToolStyle {
  icon:    string;
  color:   string;
  pending: string;
}

const DEFAULT_TOOL: ToolStyle = { icon: '⚙', color: theme.accent, pending: 'Working...' };

const TOOLS: Record<string, ToolStyle> = {
  // File ops
  fs_read:    { icon: '↗', color: theme.info,    pending: 'Reading...'           },
  read:       { icon: '↗', color: theme.info,    pending: 'Reading...'           },
  fs_write:   { icon: '↙', color: theme.success, pending: 'Writing...'           },
  write:      { icon: '↙', color: theme.success, pending: 'Writing...'           },
  fs_edit:    { icon: '↙', color: theme.success, pending: 'Editing...'           },
  edit:       { icon: '↙', color: theme.success, pending: 'Editing...'           },
  fs_list:    { icon: '⋮', color: theme.info,    pending: 'Listing...'           },
  fs_search:  { icon: '✦', color: theme.accent,  pending: 'Searching files...'   },
  glob:       { icon: '✦', color: theme.accent,  pending: 'Finding files...'     },
  grep:       { icon: '✦', color: theme.accent,  pending: 'Searching content...' },

  // Shell
  bash_run:   { icon: '$', color: theme.primary, pending: 'Running command...'   },
  shell:      { icon: '$', color: theme.primary, pending: 'Running command...'   },
  bash:       { icon: '$', color: theme.primary, pending: 'Running command...'   },

  // Web
  webfetch:         { icon: '⬡', color: theme.info, pending: 'Fetching...'         },
  browserless_fetch:{ icon: '⬡', color: theme.info, pending: 'Fetching page...'    },
  mcp__crawl4ai__crawl_page: { icon: '⬡', color: theme.info, pending: 'Crawling...' },
  websearch:        { icon: '◈', color: theme.info, pending: 'Searching web...'    },
  web_search:       { icon: '◈', color: theme.info, pending: 'Searching web...'    },

  // Patch
  apply_patch: { icon: '⊕', color: theme.success, pending: 'Applying patch...'    },

  // Tasks / agents
  task:              { icon: '│', color: theme.info,    pending: 'Spawning subagent...' },
  run_subtask:       { icon: '│', color: theme.info,    pending: 'Running subtask...'   },
  spawn_agent:       { icon: '│', color: theme.info,    pending: 'Spawning agent...'    },
  message_agent:     { icon: '✉', color: theme.primary, pending: 'Messaging agent...'   },
  assign_task_to_agent:{ icon: '↪', color: theme.primary, pending: 'Assigning task...'  },
  notify_user:       { icon: '⚠', color: theme.warning, pending: 'Notifying...'         },
  ask_alfred:        { icon: '✉', color: theme.primary, pending: 'Asking Alfred...'      },

  // Memory / vault
  search_memory:            { icon: '◇', color: theme.info,    pending: 'Searching memory...' },
  retrieve_relevant_memory: { icon: '◇', color: theme.info,    pending: 'Recalling...'         },
  write_vault_note:         { icon: '◆', color: theme.success, pending: 'Saving note...'       },
  save_session_summary:     { icon: '◆', color: theme.success, pending: 'Summarising...'       },
  compact_context:          { icon: '◆', color: theme.success, pending: 'Compacting...'        },
  get_context_pack:         { icon: '◇', color: theme.info,    pending: 'Loading context...'   },

  // Projects / tasks
  find_projects:   { icon: '⊞', color: theme.info,    pending: 'Finding projects...' },
  manage_project:  { icon: '⊞', color: theme.success, pending: 'Managing project...' },
  find_tasks:      { icon: '☑', color: theme.info,    pending: 'Finding tasks...'    },
  manage_task:     { icon: '☑', color: theme.success, pending: 'Managing task...'    },

  // Misc
  todowrite: { icon: '⚙', color: theme.accent,  pending: 'Updating todos...'    },
  question:  { icon: '?', color: theme.warning, pending: 'Asking...'            },
};

export function toolStyle(tool: string): ToolStyle {
  return TOOLS[tool] ?? DEFAULT_TOOL;
}
