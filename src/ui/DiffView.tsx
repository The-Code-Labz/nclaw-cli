/**
 * DiffView — inline before/after diff for fs_write tool results.
 *
 * Renders a compact unified diff when the agent writes or overwrites a file.
 * Lines are colored: added = green, removed = red, context = muted.
 * Automatically collapses if the file was newly created (no old content).
 */
import { Box, Text } from 'ink';
import { theme } from './theme';

export interface FileDiff {
  path:    string;
  before:  string | null;  // null = file didn't exist (new file)
  after:   string;
  mode:    'create' | 'overwrite' | 'append';
}

interface Props {
  diff: FileDiff;
}

/** Compute a minimal line-by-line diff (no patience diff — keep it simple). */
function buildDiffLines(before: string | null, after: string): DiffLine[] {
  if (before === null) {
    // New file — show all lines as added
    const lines = after.split('\n');
    // Cap display at 40 lines for new files
    const shown  = lines.slice(0, 40);
    const result: DiffLine[] = shown.map(l => ({ type: 'add', text: l }));
    if (lines.length > 40) result.push({ type: 'info', text: `… +${lines.length - 40} more lines` });
    return result;
  }

  const oldLines = before.split('\n');
  const newLines = after.split('\n');

  // Simple LCS-based diff — good enough for small files
  const diff = lcs(oldLines, newLines);
  const out: DiffLine[] = [];
  let shown = 0;

  for (const d of diff) {
    if (shown >= 60) { out.push({ type: 'info', text: `… ${diff.length - shown} more changes` }); break; }
    out.push(d);
    shown++;
  }
  return out;
}

type DiffLine =
  | { type: 'add';  text: string }
  | { type: 'del';  text: string }
  | { type: 'ctx';  text: string }
  | { type: 'info'; text: string };

/** Very small Myers-style diff using a simple recursive LCS approach. */
function lcs(a: string[], b: string[]): DiffLine[] {
  // Build edit script — use DP table for arrays up to 2000 lines each
  if (a.length > 2000 || b.length > 2000) {
    // Too large — just show counts
    return [
      { type: 'info', text: `File too large to diff (${a.length} → ${b.length} lines)` },
    ];
  }

  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j]
        ? (dp[i+1]![j+1]! + 1)
        : Math.max(dp[i+1]![j]!, dp[i]![j+1]!);

  const result: DiffLine[] = [];
  let i = 0, j = 0;
  let contextWindow = 2;
  const pending: DiffLine[] = [];

  const flush = () => {
    for (const l of pending) result.push(l);
    pending.length = 0;
  };

  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      // Context line — only show near changes
      if (contextWindow > 0) {
        pending.push({ type: 'ctx', text: a[i]! });
        contextWindow--;
      } else {
        flush();
        // skip context far from changes
      }
      i++; j++;
    } else if (j < n && (i >= m || dp[i]![j+1]! >= dp[i+1]![j]!)) {
      flush(); contextWindow = 2;
      result.push({ type: 'add', text: b[j]! });
      j++;
    } else {
      flush(); contextWindow = 2;
      result.push({ type: 'del', text: a[i]! });
      i++;
    }
  }
  flush();
  return result;
}

function shortPath(p: string): string {
  const home = process.env.HOME ?? '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export default function DiffView({ diff }: Props) {
  const lines   = buildDiffLines(diff.before, diff.after);
  const isNew   = diff.before === null;
  const hasChanges = lines.some(l => l.type === 'add' || l.type === 'del');

  const modeLabel =
    diff.mode === 'create'    ? 'created' :
    diff.mode === 'append'    ? 'appended' :
    isNew                     ? 'created' :
                                'modified';

  const afterLines  = diff.after.split('\n').length;
  const beforeLines = diff.before ? diff.before.split('\n').length : 0;
  const deltaSign   = afterLines - beforeLines;
  const deltaStr    = deltaSign > 0 ? `+${deltaSign}` : deltaSign < 0 ? `${deltaSign}` : '±0';

  if (!hasChanges && !isNew) {
    return (
      <Box paddingLeft={4} marginTop={1}>
        <Text color={theme.textFaint}>  (no changes) </Text>
        <Text color={theme.textMuted}>{shortPath(diff.path)}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={4} marginTop={1}>
      {/* Header */}
      <Box>
        <Text color={isNew ? theme.success : theme.info}>  {isNew ? '✚' : '●'} </Text>
        <Text color={theme.text} bold>{shortPath(diff.path)}</Text>
        <Text color={theme.textMuted}>  {modeLabel}  </Text>
        <Text color={deltaSign >= 0 ? theme.success : theme.error}>{deltaStr}</Text>
        <Text color={theme.textMuted}> lines</Text>
      </Box>

      {/* Diff lines */}
      <Box flexDirection="column" paddingLeft={2} marginTop={0}>
        {lines.map((line, i) => {
          if (line.type === 'add') {
            return (
              <Box key={i}>
                <Text color={theme.success}>+ </Text>
                <Text color={theme.success}>{line.text || ' '}</Text>
              </Box>
            );
          }
          if (line.type === 'del') {
            return (
              <Box key={i}>
                <Text color={theme.error}>- </Text>
                <Text color={theme.error}>{line.text || ' '}</Text>
              </Box>
            );
          }
          if (line.type === 'info') {
            return (
              <Box key={i}>
                <Text color={theme.textFaint}>  {line.text}</Text>
              </Box>
            );
          }
          // ctx
          return (
            <Box key={i}>
              <Text color={theme.textFaint}>  {line.text || ' '}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
