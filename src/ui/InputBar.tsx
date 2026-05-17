/**
 * InputBar — interactive prompt, confirm, agent picker.
 *
 * Sizing rules:
 *  - No fixed heights anywhere. Everything sizes to content.
 *  - Suggestion dropdown uses max 6 entries to stay compact.
 *  - Agent picker uses max 8 entries; scrolls with ↑↓.
 *  - All boxes use paddingX={1} not paddingX={2} to save horizontal space.
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

const PASTE_THRESHOLD = 30;
const PASTE_LINES     = 3;
let pasteSeq = 0;

interface PasteRef { id: string; marker: string; text: string; }

export default function InputBar({
  streaming, pendingConfirm, pendingAgentPick, agents,
  error, stalled,
  onSubmit, onAbort, onConfirmResolve, onAgentPick, onAgentSelected, onExit, cmdCtx,
}: Props) {
  const [value,        setValueRaw]    = useState('');
  const [cursor,       setCursorRaw]   = useState(0);
  const [history,      setHistory]     = useState<string[]>(() => loadHistory());
  const [histIdx,      setHistIdx]     = useState(-1);
  const [cursorOn,     setCursorOn]    = useState(true);
  const [suggestIdx,   setSuggestIdx]  = useState(0);
  const [agentPickIdx, setAgentPickIdx]= useState(0);

  const cursorRef  = useRef(0);
  const pastesRef  = useRef<Map<string, PasteRef>>(new Map());

  // Keep cursorRef in sync
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  function setValue(v: string | ((p: string) => string)) {
    setValueRaw(prev => {
      const next = typeof v === 'function' ? (v as (p: string) => string)(prev) : v;
      const c    = next.length;
      setCursorRaw(c);
      cursorRef.current = c;
      return next;
    });
  }

  // ── Slash suggestions ──────────────────────────────────────────────────────
  const showSuggest = !pendingConfirm && !pendingAgentPick && !streaming &&
    value.startsWith('/') && !value.includes(' ');
  const suggestions: Command[] = useMemo(
    () => showSuggest ? matchCommands(value, 6) : [],
    [showSuggest, value],
  );
  useEffect(() => {
    if (suggestIdx >= Math.max(1, suggestions.length)) setSuggestIdx(0);
  }, [suggestions.length]);

  // ── Cursor blink ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (streaming || pendingConfirm || pendingAgentPick) { setCursorOn(true); return; }
    const id = setInterval(() => setCursorOn(c => !c), 500);
    return () => clearInterval(id);
  }, [streaming, pendingConfirm, pendingAgentPick]);

  useEffect(() => { if (pendingAgentPick) setAgentPickIdx(0); }, [pendingAgentPick]);

  // ── Paste helpers ──────────────────────────────────────────────────────────
  function buildMarker(text: string): string {
    const lines = (text.match(/\n/g)?.length ?? 0) + 1;
    return `[Pasted ${lines} line${lines === 1 ? '' : 's'} #${++pasteSeq}]`;
  }
  function insertAtCursor(text: string) {
    setValueRaw(v => {
      const c    = Math.min(cursorRef.current, v.length);
      const next = v.slice(0, c) + text + v.slice(c);
      const nc   = c + text.length;
      setCursorRaw(nc);
      cursorRef.current = nc;
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

  // ── Input handler ──────────────────────────────────────────────────────────
  useInput((input, key) => {
    // Global
    if (key.ctrl && input === 'c') { if (streaming) { onAbort(); return; } onExit(); return; }
    if (key.escape) {
      if (streaming) { onAbort(); return; }
      if (showSuggest) { setValue(''); return; }
      return;
    }

    // Confirm
    if (pendingConfirm) {
      const ch = input.toLowerCase();
      if (ch === 'y') { onConfirmResolve('yes');    return; }
      if (ch === 'a') { onConfirmResolve('always'); return; }
      if (ch === 'n' || key.return) { onConfirmResolve('no'); return; }
      return;
    }

    // Agent picker
    if (pendingAgentPick) {
      const active = agents.filter(a => a.status === 'active');
      if (key.upArrow)   { setAgentPickIdx(i => (i - 1 + active.length) % active.length); return; }
      if (key.downArrow) { setAgentPickIdx(i => (i + 1) % active.length); return; }
      if (key.return)    { onAgentSelected(agentPickIdx + 1); return; }
      if (key.escape)    { onAgentSelected(0); return; }
      if (/^\d$/.test(input)) {
        const n = parseInt(input, 10);
        if (n >= 1 && n <= active.length) { onAgentSelected(n); return; }
      }
      return;
    }

    // Suggestions: arrow nav + Tab/Enter to accept
    if (showSuggest && suggestions.length > 0) {
      if (key.upArrow)   { setSuggestIdx(i => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (key.downArrow) { setSuggestIdx(i => (i + 1) % suggestions.length); return; }
      if (key.tab) {
        const chosen = suggestions[suggestIdx];
        if (chosen) { setValue(chosen.slash + ' '); setSuggestIdx(0); }
        return;
      }
      // fall through for Enter (submits if complete command)
    }

    if (streaming) return;

    // Paste detection
    let candidate = input;
    if (candidate.startsWith('\u001b[200~')) candidate = candidate.slice(6);
    if (candidate.endsWith('\u001b[201~'))   candidate = candidate.slice(0, -6);
    if (!key.ctrl && !key.meta && (candidate.length >= PASTE_THRESHOLD || candidate.includes('\n'))) {
      const lines = (candidate.match(/\n/g)?.length ?? 0) + 1;
      if (lines >= PASTE_LINES || candidate.length > 150) { insertPaste(candidate); return; }
      insertAtCursor(candidate.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
      return;
    }

    // Submit
    if (key.return && !key.shift) {
      const raw = expandPastes(value).trim();
      clearPastes();
      if (!raw) return;
      if (raw.startsWith('/') && cmdCtx) {
        const cmd = findCommand(raw);
        if (cmd) {
          const parts = raw.trim().split(/\s+/);
          void cmd.run(cmdCtx, parts.slice(1));
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

    // Newline
    if ((key.shift && key.return) || (key.ctrl && input === 'j')) { insertAtCursor('\n'); return; }

    // History
    if (key.upArrow && !showSuggest) {
      const next = Math.min(histIdx + 1, history.length - 1);
      if (history[next] !== undefined) { setHistIdx(next); setValue(history[next]!); }
      return;
    }
    if (key.downArrow && !showSuggest) {
      if (histIdx <= 0) { setHistIdx(-1); setValue(''); return; }
      const next = histIdx - 1;
      setHistIdx(next);
      setValue(history[next]!);
      return;
    }

    // Cursor movement
    if (key.leftArrow)  { setCursorRaw(p => { const n = Math.max(0, p-1); cursorRef.current=n; return n; }); return; }
    if (key.rightArrow) { setCursorRaw(p => { const n = Math.min(value.length, p+1); cursorRef.current=n; return n; }); return; }
    if ((key.ctrl && input === 'a') || input === '\u001b[H' || input === '\u001bOH') { setCursorRaw(0); cursorRef.current=0; return; }
    if ((key.ctrl && input === 'e') || input === '\u001b[F' || input === '\u001bOF') { setCursorRaw(value.length); cursorRef.current=value.length; return; }
    if ((key.ctrl && key.leftArrow) || (key.meta && input === 'b')) {
      setCursorRaw(p => {
        let i = p - 1;
        while (i > 0 && value[i - 1] === ' ') i--;
        while (i > 0 && value[i - 1] !== ' ') i--;
        cursorRef.current = i;
        return i;
      });
      return;
    }
    if ((key.ctrl && key.rightArrow) || (key.meta && input === 'f')) {
      setCursorRaw(p => {
        let i = p;
        while (i < value.length && value[i] === ' ') i++;
        while (i < value.length && value[i] !== ' ') i++;
        cursorRef.current = i;
        return i;
      });
      return;
    }

    // Editing
    if (key.backspace || key.delete) {
      const c = cursorRef.current;
      if (c === 0) return;
      setValueRaw(v => {
        for (const marker of pastesRef.current.keys()) {
          if (v.slice(0, c).endsWith(marker)) {
            pastesRef.current.delete(marker);
            const next = v.slice(0, c - marker.length) + v.slice(c);
            const nc   = c - marker.length;
            setCursorRaw(nc); cursorRef.current = nc;
            return next;
          }
        }
        const next = v.slice(0, c - 1) + v.slice(c);
        const nc   = c - 1;
        setCursorRaw(nc); cursorRef.current = nc;
        return next;
      });
      return;
    }
    if (key.ctrl && input === 'u') { clearPastes(); setValue(''); return; }
    if (key.ctrl && input === 'w') {
      setValueRaw(v => {
        const c = cursorRef.current;
        for (const marker of pastesRef.current.keys()) {
          if (v.slice(0, c).endsWith(marker)) {
            pastesRef.current.delete(marker);
            const next = v.slice(0, c - marker.length) + v.slice(c);
            const nc   = c - marker.length;
            setCursorRaw(nc); cursorRef.current = nc;
            return next;
          }
        }
        let start = c;
        while (start > 0 && v[start - 1] === ' ') start--;
        while (start > 0 && v[start - 1] !== ' ') start--;
        const next = v.slice(0, start) + v.slice(c);
        setCursorRaw(start); cursorRef.current = start;
        return next;
      });
      return;
    }
    if (key.ctrl && input === 'k') {
      setValueRaw(v => { const next = v.slice(0, cursorRef.current); return next; });
      return;
    }

    // Normal character
    if (input && !key.ctrl && !key.meta && !key.escape) insertAtCursor(input);
  });

  // ── Render helpers ─────────────────────────────────────────────────────────
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
    // Show max 8 agents; scroll window around agentPickIdx
    const WINDOW = 8;
    const start  = Math.max(0, Math.min(agentPickIdx - Math.floor(WINDOW / 2), active.length - WINDOW));
    const visible = active.slice(start, start + WINDOW);
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={theme.borderActive} paddingX={1}>
        <Text color={theme.info} bold>Switch agent</Text>
        <Text color={theme.textFaint}>↑↓ navigate · Enter select · Esc cancel</Text>
        {visible.map((a, i) => {
          const idx = start + i;
          return (
            <Box key={a.id}>
              <Text color={idx === agentPickIdx ? theme.primary : theme.textMuted}>
                {idx === agentPickIdx ? ' ▶ ' : '   '}{a.name}
              </Text>
              {idx === agentPickIdx && <Text color={theme.textFaint}>  {a.role}</Text>}
            </Box>
          );
        })}
        {active.length > WINDOW && (
          <Text color={theme.textFaint}> {active.length - WINDOW} more…</Text>
        )}
      </Box>
    );
  }

  // ── Confirm ────────────────────────────────────────────────────────────────
  if (pendingConfirm) {
    const cols  = process.stdout.columns ?? 80;
    const avail = cols - 20;
    const cmd   = pendingConfirm.command.length > avail
      ? pendingConfirm.command.slice(0, avail - 3) + '…'
      : pendingConfirm.command;
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={theme.borderWarn} paddingX={1}>
        <Box>
          <Text color={theme.warning} bold>Run? </Text>
          <Text>{cmd}</Text>
        </Box>
        <Box>
          <Text color={theme.success} bold>y</Text>
          <Text color={theme.textMuted}> yes  </Text>
          <Text color={theme.accent} bold>a</Text>
          <Text color={theme.textMuted}> always  </Text>
          <Text color={theme.error} bold>n</Text>
          <Text color={theme.textMuted}> no</Text>
        </Box>
      </Box>
    );
  }

  // ── Suggestion dropdown ────────────────────────────────────────────────────
  const suggestBox = showSuggest && suggestions.length > 0 ? (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
      {suggestions.map((s, i) => (
        <Box key={s.name}>
          <Text color={i === suggestIdx ? theme.primary : theme.textMuted}>
            {i === suggestIdx ? ' ▶ ' : '   '}{s.slash}
          </Text>
          <Text color={theme.textFaint}>  {s.description}</Text>
        </Box>
      ))}
      <Text color={theme.textFaint}> ↑↓ Tab to select</Text>
    </Box>
  ) : null;

  return (
    <Box flexDirection="column">
      {suggestBox}
      {error && (
        <Box paddingLeft={1}>
          <Text color={theme.error}>✗ {error}</Text>
        </Box>
      )}
      {stalled && streaming && (
        <Box paddingLeft={1}>
          <Spinner color={theme.warning} />
          <Text color={theme.warning}> stalled…  Ctrl+C to abort</Text>
        </Box>
      )}
      {streaming ? (
        <Box paddingLeft={1}>
          <Spinner color={theme.accent} />
          <Text color={theme.textMuted}> responding  ·  Ctrl+C / Esc to abort</Text>
        </Box>
      ) : (
        <Box paddingLeft={1}>
          <Text color={theme.secondary} bold>❯ </Text>
          {renderInput(value, cursor)}
        </Box>
      )}
    </Box>
  );
}
