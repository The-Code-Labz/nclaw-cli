/**
 * InputBar — the interactive prompt at the bottom of the TUI.
 *
 * Improvements over original:
 * - Arrow-key agent picker (up/down) instead of raw number input.
 * - Persistent blinking cursor rendered inline.
 * - Multi-line input (Shift+Enter / Ctrl+J to newline).
 * - Paste summarisation with [Pasted N lines #N] markers.
 * - Bash-style keybinds: Ctrl+U, Ctrl+W, Ctrl+A, Ctrl+E, Home, End.
 * - Left/right arrow navigation with proper cursor tracking.
 * - Slash-command autocomplete with up/down selection.
 * - Confirm prompt rendered clearly inline.
 * - Stall warning shown in the prompt area.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from './Spinner';
import { theme } from './theme';
import type { ConfirmResult } from '../confirm';
import type { RemoteAgent } from '../remote';
import type { Command, CommandContext } from '../commands/types';
import { findCommand } from '../commands/registry';
import { matchCommands } from '../commands/match';
import { loadHistory, pushHistory } from '../history';

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
  cmdCtx?:          CommandContext;
}

const PASTE_THRESHOLD_CHARS = 30;
const PASTE_LINE_THRESHOLD  = 3;
let pasteSeq = 0;

interface PasteRef {
  id:     string;
  marker: string;
  text:   string;
}

export default function InputBar({
  streaming, pendingConfirm, pendingAgentPick, agents,
  error, stalled,
  onSubmit, onAbort, onConfirmResolve, onAgentPick, onAgentSelected, onExit, cmdCtx,
}: Props) {
  const [value,      setValueRaw]   = useState('');
  const [cursor,     setCursorRaw]  = useState(0);
  const [history,    setHistory]    = useState<string[]>(() => loadHistory());
  const [histIdx,    setHistIdx]    = useState(-1);
  const [cursorOn,   setCursorOn]   = useState(true);
  const [suggestIdx, setSuggestIdx] = useState(0);
  // Agent picker: index into agents array.
  const [agentPickIdx, setAgentPickIdx] = useState(0);

  // Wrapped setValue that keeps cursor sane on external mutation.
  function setValue(v: string | ((p: string) => string)) {
    setValueRaw(prev => {
      const next = typeof v === 'function' ? (v as (p: string) => string)(prev) : v;
      setCursorRaw(next.length);
      return next;
    });
  }
  function setCursor(c: number | ((p: number) => number)) {
    setCursorRaw(prev => {
      const next = typeof c === 'function' ? c(prev) : c;
      return Math.max(0, Math.min(next, value.length));
    });
  }

  // ── Slash-command suggestions ──────────────────────────────────────────────
  const showSuggest = !pendingConfirm && !pendingAgentPick && !streaming &&
    value.startsWith('/') && !value.includes(' ');
  const suggestions: Command[] = useMemo(
    () => showSuggest ? matchCommands(value, 8) : [],
    [showSuggest, value],
  );
  useEffect(() => {
    if (suggestIdx >= Math.max(1, suggestions.length)) setSuggestIdx(0);
  }, [suggestions.length]);

  // ── Paste storage ──────────────────────────────────────────────────────────
  const pastesRef = useRef<Map<string, PasteRef>>(new Map());

  // ── Cursor blink ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (streaming || pendingConfirm || pendingAgentPick) {
      setCursorOn(true);
      return;
    }
    const id = setInterval(() => setCursorOn(c => !c), 500);
    return () => clearInterval(id);
  }, [streaming, pendingConfirm, pendingAgentPick]);

  // ── Agent picker init ──────────────────────────────────────────────────────
  useEffect(() => {
    if (pendingAgentPick) setAgentPickIdx(0);
  }, [pendingAgentPick]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function buildMarker(text: string): string {
    const lines = (text.match(/\n/g)?.length ?? 0) + 1;
    return `[Pasted ${lines} line${lines === 1 ? '' : 's'} #${++pasteSeq}]`;
  }
  function insertAtCursor(text: string) {
    setValueRaw(v => {
      const c    = Math.min(cursor, v.length);
      const next = v.slice(0, c) + text + v.slice(c);
      setCursorRaw(c + text.length);
      return next;
    });
  }
  function insertPaste(raw: string) {
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const marker     = buildMarker(normalized);
    pastesRef.current.set(marker, { id: marker, marker, text: normalized });
    insertAtCursor(marker);
  }
  function expandPastes(input: string): string {
    let out = input;
    for (const [marker, paste] of pastesRef.current.entries()) {
      out = out.split(marker).join(paste.text);
    }
    return out;
  }
  function clearPastes() { pastesRef.current.clear(); }

  // ── Main input handler ─────────────────────────────────────────────────────
  useInput((input, key) => {
    // ── Global abort / exit ──────────────────────────────────────────────────
    if (key.ctrl && input === 'c') {
      if (streaming) { onAbort(); return; }
      onExit();
      return;
    }
    if (key.escape && streaming) { onAbort(); return; }

    // ── Confirm prompt ───────────────────────────────────────────────────────
    if (pendingConfirm) {
      const ch = input.toLowerCase();
      if (ch === 'y') { onConfirmResolve('yes');    return; }
      if (ch === 'a') { onConfirmResolve('always'); return; }
      if (ch === 'n' || key.return) { onConfirmResolve('no'); return; }
      return;
    }

    // ── Agent picker (arrow-key) ──────────────────────────────────────────────
    if (pendingAgentPick) {
      if (key.upArrow)   { setAgentPickIdx(i => (i - 1 + agents.length) % agents.length); return; }
      if (key.downArrow) { setAgentPickIdx(i => (i + 1) % agents.length); return; }
      if (key.return) {
        onAgentSelected(agentPickIdx + 1); // registry is 1-based
        return;
      }
      if (key.escape) { onAgentSelected(0); return; } // cancel
      // Also allow direct number press for power users.
      if (/^\d$/.test(input)) {
        const n = parseInt(input, 10);
        if (n >= 1 && n <= agents.length) {
          onAgentSelected(n);
          return;
        }
      }
      return;
    }

    // ── Slash-command suggestion navigation ───────────────────────────────────
    if (showSuggest && suggestions.length > 0) {
      if (key.upArrow)   { setSuggestIdx(i => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (key.downArrow) { setSuggestIdx(i => (i + 1) % suggestions.length); return; }
      if (key.tab || key.return) {
        const chosen = suggestions[suggestIdx];
        if (chosen) {
          setValue(chosen.slash + ' ');
          setSuggestIdx(0);
          if (key.return) {
            // Immediately run the command if it takes no args.
            const cmd = findCommand(chosen.slash);
            if (cmd && cmdCtx) {
              void cmd.run(cmdCtx, []);
              setValue('');
              clearPastes();
            }
          }
        }
        return;
      }
    }

    // ── Streaming: only abort is allowed ─────────────────────────────────────
    if (streaming) return;

    // ── Paste detection ───────────────────────────────────────────────────────
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
      insertAtCursor(candidate.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
      return;
    }

    // ── Submit ────────────────────────────────────────────────────────────────
    if (key.return && !key.shift) {
      const raw = expandPastes(value).trim();
      clearPastes();
      if (!raw) return;

      // Check for slash command.
      if (raw.startsWith('/') && cmdCtx) {
        const cmd = findCommand(raw);
        if (cmd) {
          const parts = raw.trim().split(/\s+/);
          const args  = parts.slice(1);
          void cmd.run(cmdCtx, args);
          setHistory(h => pushHistory(h, raw));
          setValue('');
          setHistIdx(-1);
          return;
        }
      }

      onSubmit(raw);
      setHistory(h => pushHistory(h, raw));
      setValue('');
      setHistIdx(-1);
      return;
    }

    // ── Newline (Shift+Enter / Ctrl+J) ────────────────────────────────────────
    if ((key.shift && key.return) || (key.ctrl && input === 'j')) {
      insertAtCursor('\n');
      return;
    }

    // ── History ───────────────────────────────────────────────────────────────
    if (key.upArrow && !showSuggest) {
      const next = Math.min(histIdx + 1, history.length - 1);
      if (history[next] !== undefined) {
        setHistIdx(next);
        setValue(history[next]!);
      }
      return;
    }
    if (key.downArrow && !showSuggest) {
      if (histIdx <= 0) { setHistIdx(-1); setValue(''); return; }
      const next = histIdx - 1;
      setHistIdx(next);
      setValue(history[next]!);
      return;
    }

    // ── Cursor movement ───────────────────────────────────────────────────────
    if (key.leftArrow) {
      setCursorRaw(p => Math.max(0, p - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorRaw(p => Math.min(value.length, p + 1));
      return;
    }
    // Ctrl+A / Home
    if ((key.ctrl && input === 'a') || input === '\u001b[H' || input === '\u001bOH') {
      setCursorRaw(0);
      return;
    }
    // Ctrl+E / End
    if ((key.ctrl && input === 'e') || input === '\u001b[F' || input === '\u001bOF') {
      setCursorRaw(value.length);
      return;
    }
    // Ctrl+Left (word back) — some terminals send this as meta+b
    if ((key.ctrl && key.leftArrow) || (key.meta && input === 'b')) {
      setCursorRaw(p => {
        let i = p - 1;
        while (i > 0 && value[i - 1] === ' ') i--;
        while (i > 0 && value[i - 1] !== ' ') i--;
        return i;
      });
      return;
    }
    // Ctrl+Right (word forward) — some terminals send as meta+f
    if ((key.ctrl && key.rightArrow) || (key.meta && input === 'f')) {
      setCursorRaw(p => {
        let i = p;
        while (i < value.length && value[i] === ' ') i++;
        while (i < value.length && value[i] !== ' ') i++;
        return i;
      });
      return;
    }

    // ── Editing ───────────────────────────────────────────────────────────────
    // Backspace
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      setValueRaw(v => {
        const c = Math.min(cursor, v.length);
        // If a paste marker ends at cursor, delete the whole marker.
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
    // Ctrl+U: clear line
    if (key.ctrl && input === 'u') {
      clearPastes();
      setValue('');
      return;
    }
    // Ctrl+W: delete previous word
    if (key.ctrl && input === 'w') {
      setValueRaw(v => {
        const c = Math.min(cursor, v.length);
        for (const marker of pastesRef.current.keys()) {
          if (v.slice(0, c).endsWith(marker)) {
            pastesRef.current.delete(marker);
            const next = v.slice(0, c - marker.length) + v.slice(c);
            setCursorRaw(c - marker.length);
            return next;
          }
        }
        let end   = c;
        let start = c;
        while (start > 0 && v[start - 1] === ' ') start--;
        while (start > 0 && v[start - 1] !== ' ') start--;
        const next = v.slice(0, start) + v.slice(end);
        setCursorRaw(start);
        return next;
      });
      return;
    }
    // Ctrl+K: delete to end of line
    if (key.ctrl && input === 'k') {
      setValueRaw(v => {
        const c = Math.min(cursor, v.length);
        const next = v.slice(0, c);
        return next;
      });
      return;
    }

    // ── Regular character input ───────────────────────────────────────────────
    if (input && !key.ctrl && !key.meta && !key.escape) {
      insertAtCursor(input);
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  const cols   = process.stdout.columns ?? 80;
  const prompt = '❯ ';

  // Render the value with a blinking cursor at position.
  function renderInput(val: string, cur: number): React.ReactNode {
    const before = val.slice(0, cur);
    const at     = val[cur] ?? ' ';
    const after  = val.slice(cur + 1);
    return (
      <>
        <Text color={theme.secondary}>{before}</Text>
        <Text color={theme.secondary} inverse={cursorOn}>{at}</Text>
        <Text color={theme.secondary}>{after}</Text>
      </>
    );
  }

  // ── Agent picker ───────────────────────────────────────────────────────────
  if (pendingAgentPick) {
    const active = agents.filter(a => a.status === 'active');
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.borderActive} paddingX={1}>
        <Text color={theme.info} bold>  Switch agent  </Text>
        <Text color={theme.textMuted}>  ↑↓ navigate · Enter select · Esc cancel</Text>
        <Box marginTop={0} flexDirection="column">
          {active.map((a, i) => (
            <Box key={a.id}>
              <Text color={i === agentPickIdx ? theme.primary : theme.textMuted}>
                {i === agentPickIdx ? '  ▶ ' : '    '}
                {a.name}
              </Text>
              {i === agentPickIdx && (
                <Text color={theme.textFaint}>  {a.role}</Text>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  // ── Confirm prompt ────────────────────────────────────────────────────────
  if (pendingConfirm) {
    const short = pendingConfirm.command.length > cols - 24
      ? pendingConfirm.command.slice(0, cols - 27) + '…'
      : pendingConfirm.command;
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.borderWarn} paddingX={1}>
        <Box>
          <Text color={theme.warning} bold>  Run command?  </Text>
          <Text color={theme.text}>{short}</Text>
        </Box>
        <Box marginTop={0}>
          <Text color={theme.textMuted}>  </Text>
          <Text color={theme.success} bold>y</Text>
          <Text color={theme.textMuted}> yes  </Text>
          <Text color={theme.accent} bold>a</Text>
          <Text color={theme.textMuted}> always allow  </Text>
          <Text color={theme.error} bold>n</Text>
          <Text color={theme.textMuted}> no</Text>
        </Box>
      </Box>
    );
  }

  // ── Slash-command suggestions ──────────────────────────────────────────────
  const suggestBox = showSuggest && suggestions.length > 0 ? (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} marginBottom={0}>
      {suggestions.map((s, i) => (
        <Box key={s.name}>
          <Text color={i === suggestIdx ? theme.primary : theme.textMuted}>
            {i === suggestIdx ? ' ▶ ' : '   '}
            {s.slash}
          </Text>
          <Text color={theme.textFaint}>  {s.description}</Text>
        </Box>
      ))}
      <Text color={theme.textFaint}>   ↑↓ navigate · Tab/Enter select</Text>
    </Box>
  ) : null;

  // ── Error banner ──────────────────────────────────────────────────────────
  const errorBanner = error ? (
    <Box paddingLeft={1}>
      <Text color={theme.error}>  ✗ {error}</Text>
    </Box>
  ) : null;

  // ── Stall banner ──────────────────────────────────────────────────────────
  const stallBanner = stalled && streaming ? (
    <Box paddingLeft={1}>
      <Spinner color={theme.warning} />
      <Text color={theme.warning}> agent is taking longer than usual…</Text>
    </Box>
  ) : null;

  // ── Streaming indicator ──────────────────────────────────────────────────
  const streamRow = streaming ? (
    <Box paddingLeft={1}>
      <Spinner color={theme.accent} />
      <Text color={theme.textMuted}> responding  ·  Ctrl+C or Esc to abort</Text>
    </Box>
  ) : null;

  // ── Main input row ────────────────────────────────────────────────────────
  const inputRow = !streaming ? (
    <Box paddingLeft={1}>
      <Text color={theme.secondary} bold>{prompt}</Text>
      {renderInput(value, cursor)}
    </Box>
  ) : null;

  return (
    <Box flexDirection="column">
      {suggestBox}
      {errorBanner}
      {stallBanner}
      {streamRow}
      {inputRow}
    </Box>
  );
}
