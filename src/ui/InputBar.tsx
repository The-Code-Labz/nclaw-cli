import { useState, useEffect, useRef, useMemo, cloneElement } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from './Spinner';
import { theme } from './theme';
import type { ConfirmResult } from '../confirm';
import type { RemoteAgent } from '../remote';
import type { Command, CommandContext } from '../commands/types';
import { findCommand } from '../commands/registry';
import { matchCommands } from '../commands/match';

export type ConfirmRequest = {
  command: string;
  resolve: (r: ConfirmResult) => void;
};

interface Props {
  streaming:        boolean;
  pendingConfirm:   ConfirmRequest | null;
  pendingAgentPick: boolean;
  agents:           RemoteAgent[];
  error:            string | null;
  stalled:          boolean;
  onSubmit:         (text: string) => void;
  onAbort:          () => void;
  onConfirmResolve: (r: ConfirmResult) => void;
  onAgentPick:      () => void;
  onAgentSelected:  (n: number) => void;
  onExit:           () => void;
  /** Slash-command context. When provided, /commands are resolved via registry. */
  cmdCtx?:          CommandContext;
}

// A paste is anything bigger than this single-event input length.
// Single keystrokes are 1 character; pastes arrive as a chunk.
const PASTE_THRESHOLD_CHARS = 30;
const PASTE_LINE_THRESHOLD  = 3;

interface PasteRef {
  id:        string;
  marker:    string;   // e.g. "[Pasted 12 lines]"
  text:      string;   // the real content
}

let pasteSeq = 0;

export default function InputBar({
  streaming, pendingConfirm, pendingAgentPick, agents,
  error, stalled,
  onSubmit, onAbort, onConfirmResolve, onAgentPick, onAgentSelected, onExit, cmdCtx,
}: Props) {
  const [value,   setValueRaw] = useState('');
  const [cursor,  setCursorRaw] = useState(0);
  const [history, setHistory]  = useState<string[]>([]);
  const [histIdx, setHistIdx]  = useState(-1);
  const [cursorOn, setCursorOn] = useState(true);
  const [suggestIdx, setSuggestIdx] = useState(0);

  // Wrapped setValue that keeps cursor sane when value mutates externally
  // (history navigation, slash-command completion, paste insertion).
  function setValue(v: string | ((p: string) => string)) {
    setValueRaw(prev => {
      const next = typeof v === 'function' ? (v as (p: string) => string)(prev) : v;
      // If the new value is shorter than the old cursor pos, clamp to end.
      // Most external setValue callers want cursor at end-of-text.
      setCursorRaw(next.length);
      return next;
    });
  }


  // Command-suggestion dropdown is visible when the input starts with "/"
  // and the user has not yet typed a space (i.e. they're still typing the
  // command name, not its arguments).
  const showSuggest = !pendingConfirm && !pendingAgentPick && !streaming &&
    value.startsWith('/') && !value.includes(' ');
  const suggestions: Command[] = useMemo(
    () => showSuggest ? matchCommands(value, 6) : [],
    [showSuggest, value],
  );
  // Clamp suggestIdx when the suggestion list shrinks.
  useEffect(() => {
    if (suggestIdx >= suggestions.length) setSuggestIdx(0);
  }, [suggestions.length, suggestIdx]);

  // Pasted blocks live in a ref keyed by their marker text so they survive
  // re-renders.  On submit we substitute the marker with the real content.
  const pastesRef = useRef<Map<string, PasteRef>>(new Map());

  // Cursor blink when idle
  useEffect(() => {
    if (streaming || pendingConfirm || pendingAgentPick) {
      setCursorOn(true);
      return;
    }
    const id = setInterval(() => setCursorOn(c => !c), 500);
    return () => clearInterval(id);
  }, [streaming, pendingConfirm, pendingAgentPick]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  function buildMarker(text: string): string {
    const lines = (text.match(/\n/g)?.length ?? 0) + 1;
    return `[Pasted ${lines} line${lines === 1 ? '' : 's'} #${++pasteSeq}]`;
  }

  function insertAtCursor(text: string) {
    setValueRaw(v => {
      const c = Math.min(cursor, v.length);
      const next = v.slice(0, c) + text + v.slice(c);
      setCursorRaw(c + text.length);
      return next;
    });
  }

  function insertPaste(raw: string) {
    // Normalize newlines so terminals that send \r\n don't break the count
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const marker = buildMarker(normalized);
    pastesRef.current.set(marker, { id: marker, marker, text: normalized });
    insertAtCursor(marker);
  }

  function expandPastes(input: string): string {
    let out = input;
    for (const [marker, paste] of pastesRef.current.entries()) {
      // Allow multiple occurrences just in case
      out = out.split(marker).join(paste.text);
    }
    return out;
  }

  function clearPastesForSubmit() {
    pastesRef.current.clear();
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (streaming) { onAbort(); return; }
      onExit();
      return;
    }
    if (key.escape && streaming) {
      onAbort();
      return;
    }

    if (pendingConfirm) {
      const ch = input.toLowerCase();
      if (ch === 'y') { onConfirmResolve('yes');    return; }
      if (ch === 'a') { onConfirmResolve('always'); return; }
      if (ch === 'n' || key.return) { onConfirmResolve('no'); return; }
      return;
    }

    if (pendingAgentPick) {
      if (key.return) {
        const n = parseInt(value.trim(), 10);
        if (!isNaN(n) && n >= 1 && n <= agents.length) onAgentSelected(n);
        else onAgentSelected(0);
        setValue('');
        return;
      }
      if (key.backspace || key.delete) { setValue(v => v.slice(0, -1)); return; }
      if (/^\d$/.test(input)) { setValue(v => v + input); return; }
      return;
    }

    // ── Paste detection ─────────────────────────────────────────────────
    // Bracketed paste mode wraps content in ESC [200~ and ESC [201~.
    // We strip those markers if present, then decide whether to summarise.
    let candidate = input;
    if (candidate.startsWith('\u001b[200~')) candidate = candidate.slice(6);
    if (candidate.endsWith('\u001b[201~'))   candidate = candidate.slice(0, -6);

    if (
      !key.ctrl && !key.meta &&
      (candidate.length >= PASTE_THRESHOLD_CHARS || candidate.includes('\n'))
    ) {
      const lines = (candidate.match(/\n/g)?.length ?? 0) + 1;
      if (lines >= PASTE_LINE_THRESHOLD || candidate.length > 150) {
        insertPaste(candidate);
        return;
      }
      // Fallthrough: short multi-line paste, just inline it at cursor.
      insertAtCursor(candidate.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
      return;
    }

    // ── Bash-style line keybinds ───────────────────────────────────────
    // Shift+Enter / Ctrl+J: insert a literal newline instead of submitting.
    if ((key.shift && key.return) || (key.ctrl && input === 'j')) {
      insertAtCursor('\n');
      return;
    }
    // Ctrl+U: clear the entire input.
    if (key.ctrl && input === 'u') {
      pastesRef.current.clear();
      setValue('');
      return;
    }
    // Ctrl+W: delete the previous word (or full paste marker at the tail).
    if (key.ctrl && input === 'w') {
      setValueRaw(v => {
        const c = Math.min(cursor, v.length);
        // If a paste marker ends at the cursor, remove it whole.
        for (const marker of pastesRef.current.keys()) {
          if (v.slice(0, c).endsWith(marker)) {
            pastesRef.current.delete(marker);
            const next = v.slice(0, c - marker.length) + v.slice(c);
            setCursorRaw(c - marker.length);
            return next;
          }
        }
        // Otherwise, trailing whitespace + run of non-whitespace.
        let end = c;
        let start = c;
        while (start > 0 && /\s/.test(v[start - 1]!)) start--;
        while (start > 0 && !/\s/.test(v[start - 1]!)) start--;
        const next = v.slice(0, start) + v.slice(end);
        setCursorRaw(start);
        return next;
      });
      return;
    }
    // Ctrl+A: cursor to start.
    if (key.ctrl && input === 'a') { setCursorRaw(0); return; }
    // Ctrl+E: cursor to end.
    if (key.ctrl && input === 'e') { setCursorRaw(value.length); return; }
    // Ctrl+L: clear screen via registry.
    if (key.ctrl && input === 'l') {
      cmdCtx?.clearScreen();
      return;
    }
    // Left / Right arrow: move cursor.
    if (key.leftArrow)  { setCursorRaw(c => Math.max(0, c - 1)); return; }
    if (key.rightArrow) { setCursorRaw(c => Math.min(value.length, c + 1)); return; }

    // Slash-command suggestion dropdown: hijack Up/Down/Tab while visible.
    if (showSuggest && suggestions.length > 0) {
      if (key.upArrow)   { setSuggestIdx(i => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (key.downArrow) { setSuggestIdx(i => (i + 1) % suggestions.length); return; }
      if (key.tab) {
        const picked = suggestions[suggestIdx];
        if (picked) {
          const completed = picked.slash + ' ';
          setValueRaw(completed);
          setCursorRaw(completed.length);
        }
        return;
      }
    }

    // History navigation (only when dropdown is not eating arrow keys).
    if (key.upArrow) {
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setValue(history[next] ?? '');
      return;
    }
    if (key.downArrow) {
      const next = histIdx - 1;
      setHistIdx(next);
      setValue(next < 0 ? '' : (history[next] ?? ''));
      return;
    }

    if (key.return) {
      const trimmed = value.trim();
      if (!trimmed) return;
      // Expand any [Pasted ...] markers into their actual text before submitting.
      const expanded = expandPastes(trimmed);

      // Slash-command resolution via registry.
      if (expanded.startsWith('/') && cmdCtx) {
        const cmd = findCommand(expanded);
        if (cmd) {
          const args = expanded.split(/\s+/).slice(1);
          setHistory(h => [trimmed, ...h].slice(0, 50));
          setHistIdx(-1);
          setValue('');
          clearPastesForSubmit();
          void Promise.resolve(cmd.run(cmdCtx, args));
          return;
        }
        // Unknown /command — fall through to normal submit so the agent
        // can decide what to do with it.
      }

      setHistory(h => [trimmed, ...h].slice(0, 50));
      setHistIdx(-1);
      setValue('');
      clearPastesForSubmit();
      onSubmit(expanded);
      return;
    }

    if (key.backspace || key.delete) {
      // Delete the character to the LEFT of the cursor. If the segment
      // ending at the cursor matches a paste marker, remove the entire
      // marker (and its stored content) in one keypress.
      setValueRaw(v => {
        const c = Math.min(cursor, v.length);
        if (c === 0) return v;
        for (const marker of pastesRef.current.keys()) {
          if (v.slice(0, c).endsWith(marker)) {
            pastesRef.current.delete(marker);
            const next = v.slice(0, c - marker.length) + v.slice(c);
            setCursorRaw(c - marker.length);
            return next;
          }
        }
        const next = v.slice(0, c - 1) + v.slice(c);
        setCursorRaw(c - 1);
        return next;
      });
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      insertAtCursor(input);
    }
  });

  // ── Confirmation dialog ──────────────────────────────────────────────────
  if (pendingConfirm) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box paddingX={1} borderStyle="round" borderColor={theme.borderWarn}>
          <Text color={theme.warning} bold>⚠ Run command</Text>
        </Box>
        <Box paddingX={2}>
          <Text>{pendingConfirm.command.slice(0, 200)}</Text>
        </Box>
        <Box paddingX={2}>
          <Text dimColor>[</Text>
          <Text color={theme.success} bold>y</Text>
          <Text dimColor>]es  [</Text>
          <Text color={theme.info} bold>a</Text>
          <Text dimColor>]lways  [</Text>
          <Text color={theme.error} bold>N</Text>
          <Text dimColor>]o</Text>
        </Box>
      </Box>
    );
  }

  // ── Agent picker ─────────────────────────────────────────────────────────
  if (pendingAgentPick) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box paddingX={1} borderStyle="round" borderColor={theme.borderActive}>
          <Text bold color={theme.info}>select agent</Text>
        </Box>
        {agents.map((a, i) => (
          <Box key={a.id} paddingX={2}>
            <Text dimColor>{i + 1}. </Text>
            <Text bold>{a.name}</Text>
            <Text dimColor>  ({a.role})</Text>
          </Box>
        ))}
        <Box paddingX={1} borderStyle="round" borderColor={theme.borderActive}>
          <Text dimColor>{`select [1-${agents.length}]: `}</Text>
          <Text>{value}</Text>
          <Text color={theme.secondary}>█</Text>
        </Box>
      </Box>
    );
  }

  // ── Normal prompt ────────────────────────────────────────────────────────
  const borderColor = streaming
    ? (stalled ? theme.borderError : theme.borderWarn)
    : error ? theme.borderError : theme.border;

  // Multi-line rendering: split the value at \n boundaries and emit one row
  // per logical line. The prompt arrow only decorates the first line; later
  // lines get a 2-space indent so they visually align under the typed text.
  // The cursor block is drawn at its exact position by splitting whichever
  // line contains it into (before|cursor|after).
  const lines = value.length === 0 ? [''] : value.split('\n');
  // Map cursor (absolute index in value) to (lineIdx, colIdx).
  let cursorLine = 0;
  let cursorCol  = 0;
  {
    let remaining = Math.min(cursor, value.length);
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i]!.length;
      if (remaining <= lineLen) { cursorLine = i; cursorCol = remaining; break; }
      remaining -= lineLen + 1; // +1 for the consumed \n
    }
  }

  function renderLine(line: string, idx: number, isCursorLine: boolean): JSX.Element[] {
    const reKey = (els: JSX.Element[], prefix: string) =>
      els.map((el, i) => cloneElement(el, { key: `${prefix}-${idx}-${i}` }));
    const segs = reKey(renderValueWithPastes(line, pastesRef.current), 's');
    if (!isCursorLine || streaming || !cursorOn) {
      return segs.length ? segs : [<Text key={`empty-${idx}`}> </Text>];
    }
    // Split at cursor column. Each half is rendered through the same
    // paste-aware helper so marker styling is preserved.
    const before = line.slice(0, cursorCol);
    const after  = line.slice(cursorCol);
    return [
      ...reKey(renderValueWithPastes(before, pastesRef.current), 'b'),
      <Text key={`c-${idx}`} color={theme.secondary}>█</Text>,
      ...reKey(renderValueWithPastes(after, pastesRef.current), 'a'),
    ];
  }

  return (
    <Box flexDirection="column">
      {error && (
        <Box paddingX={1}>
          <Text color={theme.error}>✗ </Text>
          <Text dimColor>{error}</Text>
        </Box>
      )}

      {stalled && streaming && (
        <Box paddingX={1}>
          <Text color={theme.warning}>! </Text>
          <Text dimColor>agent appears stalled — press Esc to cancel</Text>
        </Box>
      )}

      {showSuggest && suggestions.length > 0 && (
        <Box flexDirection="column" paddingX={1} marginBottom={0}>
          {suggestions.map((cmd, i) => (
            <Box key={cmd.slash}>
              <Text color={i === suggestIdx ? theme.info : theme.textMuted}>
                {i === suggestIdx ? '› ' : '  '}
              </Text>
              <Text color={i === suggestIdx ? theme.info : theme.text} bold={i === suggestIdx}>
                {cmd.slash}
              </Text>
              <Text color={theme.textMuted}>  {cmd.description}</Text>
            </Box>
          ))}
          <Box>
            <Text color={theme.textMuted} dimColor>  tab to complete · ↑↓ to navigate</Text>
          </Box>
        </Box>
      )}

      <Box flexDirection="column" paddingX={1} borderStyle="round" borderColor={borderColor}>
        {lines.map((line, idx) => (
          <Box key={`l-${idx}`}>
            {idx === 0
              ? (streaming
                  ? <Spinner color={stalled ? theme.error : theme.warning} />
                  : <Text color={theme.secondary}>›</Text>)
              : <Text>  </Text>}
            <Text> </Text>
            {renderLine(line, idx, idx === cursorLine)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Split the textbox value into normal-text and paste-marker segments so we
 * can style the markers (dim italic) differently from typed text.
 */
function renderValueWithPastes(value: string, pastes: Map<string, PasteRef>): JSX.Element[] {
  if (pastes.size === 0) return [<Text key="t">{value}</Text>];
  // Build a regex matching any of the markers (escape regex metas).
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp([...pastes.keys()].map(escape).join('|'), 'g');
  const out: JSX.Element[] = [];
  let lastIdx = 0;
  let key = 0;
  for (const m of value.matchAll(pattern)) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) {
      out.push(<Text key={key++}>{value.slice(lastIdx, idx)}</Text>);
    }
    out.push(
      <Text key={key++} color={theme.info} italic>{m[0]}</Text>,
    );
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < value.length) {
    out.push(<Text key={key++}>{value.slice(lastIdx)}</Text>);
  }
  return out;
}
