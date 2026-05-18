/**
 * App — root TUI component.
 *
 * Layout philosophy (Claude Code / opencode):
 *   - Do NOT set a fixed height on the root box. Let Ink + the terminal
 *     manage vertical space. Static scrolls naturally; live content sticks
 *     to the bottom.
 *   - The bottom chrome (divider + InputBar + Footer) is pinned by being
 *     rendered last; Ink always appends to the current cursor position.
 *   - No overflow/clip fighting — just natural terminal scroll.
 *
 * Features added in v0.3.0:
 *   - /cd <path>   — change cwd mid-session; agent context updates immediately
 *   - /files [dir] — list directory inline with multi-column layout
 *   - Diff view    — fs_write tool_done events render before/after diff
 *   - Auto-reconnect — SSE drop → exponential backoff re-send of last message
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Static, Text, useApp } from 'ink';
import fs   from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { chat, listAgents, RemoteAgent, DisplayEvent } from '../remote';
import type { NclawConfig } from '../config';
import { scanTree } from '../tree';
import MessageBubble, { Message, MessageItem } from './MessageBubble';
import InputBar, { ConfirmRequest } from './InputBar';
import Footer from './Footer';
import Welcome from './Welcome';
import DiffView, { FileDiff } from './DiffView';
import type { ConfirmResult } from '../confirm';
import { commands } from '../commands/registry';
import type { CommandContext } from '../commands/types';
import { isYoloMode } from '../permissions';

// ── Package version ────────────────────────────────────────────────────────────
let PKG_VERSION = '0.3.0';
try {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  PKG_VERSION   = pkg.version ?? PKG_VERSION;
} catch { /* no-op */ }

// ── Git helpers ────────────────────────────────────────────────────────────────
function readGitBranch(cwd: string): string | undefined {
  try {
    const head = fs.readFileSync(path.join(cwd, '.git', 'HEAD'), 'utf8').trim();
    const m    = head.match(/^ref:\s+refs\/heads\/(.+)$/);
    if (m) return m[1];
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7);
  } catch { /* not a git repo */ }
  return undefined;
}
function readGitDirty(cwd: string): Promise<boolean> {
  return new Promise(resolve => {
    execFile('git', ['status', '--porcelain'], { cwd, timeout: 5000 }, (err, out) => {
      resolve(!err && out.trim().length > 0);
    });
  });
}

interface Props {
  cfg:    NclawConfig;
  agents: RemoteAgent[];
}

function getHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function toolLabel(args: Record<string, unknown>): string {
  return String(args['path'] ?? args['command'] ?? args['title'] ?? '').slice(0, 60);
}

// ── Divider line ───────────────────────────────────────────────────────────────
function Divider({ streaming }: { streaming: boolean }) {
  const cols  = process.stdout.columns ?? 80;
  const color = streaming ? '#22D3EE' : '#374151';
  return (
    <Box paddingX={1}>
      <Text color={color}>{'─'.repeat(Math.max(1, cols - 2))}</Text>
    </Box>
  );
}

// ── Help message ───────────────────────────────────────────────────────────────
function makeHelpMessage(): Message {
  const lines: string[] = [
    'Available commands:',
    '',
    ...commands.map(c => `  ${c.slash.padEnd(18)} ${c.description}`),
    '',
    'Keyboard shortcuts:',
    '  Ctrl+C         abort stream · exit',
    '  Ctrl+U         clear input',
    '  Ctrl+W         delete word',
    '  Ctrl+K         delete to end of line',
    '  Ctrl+A / Home  beginning of line',
    '  Ctrl+E / End   end of line',
    '  Shift+Enter    insert newline',
    '  ↑↓             history navigation',
    '  /cmd ↑↓ Tab    command suggestions',
  ];
  return {
    role:      'agent',
    agentName: 'nclaw',
    items:     [{ kind: 'text', content: lines.join('\n') }],
  };
}

// ── Reconnect config ───────────────────────────────────────────────────────────
const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 20_000]; // ms per attempt

// ── Static item types ──────────────────────────────────────────────────────────
type StaticItem =
  | { _type: 'welcome'; key: string; version: string; host: string; agent: string }
  | { _type: 'message'; key: string; message: Message }
  | { _type: 'diff';    key: string; diff: FileDiff };

export default function App({ cfg, agents: initialAgents }: Props) {
  const { exit } = useApp();

  const [agents,           setAgents]           = useState<RemoteAgent[]>(initialAgents);
  const [currentAgent,     setCurrentAgent]     = useState<RemoteAgent>(
    () => initialAgents.find(a => a.status === 'active') ?? initialAgents[0]!,
  );
  const [staticItems,      setStaticItems]      = useState<StaticItem[]>([]);
  const [activeMessage,    setActiveMessage]    = useState<Message | null>(null);
  const [sessionId,        setSessionId]        = useState<string | undefined>();
  const [streaming,        setStreaming]        = useState(false);
  const [pendingConfirm,   setPendingConfirm]   = useState<ConfirmRequest | null>(null);
  const [pendingAgentPick, setPendingAgentPick] = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [stalled,          setStalled]          = useState(false);
  const [toolCount,        setToolCount]        = useState(0);
  const [cwd,              setCwd]              = useState(() => process.cwd());
  const [metaInfo,         setMetaInfo]         = useState<{
    tokensIn?: number; tokensOut?: number; costUsd?: number; model?: string;
  }>({});
  const [gitInfo,          setGitInfo]          = useState<{ branch?: string; dirty?: boolean }>({});
  const [reconnectCount,   setReconnectCount]   = useState(0);

  // context is re-derived whenever cwd changes
  const context = useMemo(() => scanTree(cwd), [cwd]);

  const toolTimers    = useRef(new Map<string, number>());
  const chunkBuffer   = useRef('');
  const flushTimer    = useRef<NodeJS.Timeout | null>(null);
  const activeRef     = useRef<Message | null>(null);
  const abortRef      = useRef<AbortController | null>(null);
  const lastUserRef   = useRef<string | null>(null);
  const staticRef     = useRef<StaticItem[]>([]);
  const itemCounter   = useRef(0);
  const reconnectRef  = useRef(0);
  const reconnecting  = useRef(false);

  useEffect(() => { staticRef.current = staticItems; }, [staticItems]);
  useEffect(() => { activeRef.current = activeMessage; }, [activeMessage]);

  function nextKey(): string {
    return String(++itemCounter.current);
  }

  // ── Git status ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const branch = readGitBranch(cwd);
    setGitInfo({ branch, dirty: undefined });
    if (!branch) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      const dirty = await readGitDirty(cwd);
      if (!cancelled) setGitInfo(prev => ({ ...prev, dirty }));
    };
    void refresh();
    const id = setInterval(() => { if (!streaming) void refresh(); }, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [cwd, streaming]);

  // ── Confirm gate ────────────────────────────────────────────────────────────
  const handleConfirm = useCallback((command: string): Promise<ConfirmResult> => {
    return new Promise(resolve => setPendingConfirm({ command, resolve }));
  }, []);

  // ── Active-message mutation ─────────────────────────────────────────────────
  const mutateActive = useCallback((mutator: (m: Message) => Message) => {
    setActiveMessage(prev => {
      if (!prev) return prev;
      const next = mutator(prev);
      activeRef.current = next;
      return next;
    });
  }, []);

  const appendItem = useCallback((item: MessageItem) => {
    mutateActive(prev => ({ ...prev, items: [...prev.items, item] }));
  }, [mutateActive]);

  // ── Streamed text batching (16ms = one ~60fps frame) ──────────────────────
  const flushChunkBuffer = useCallback(() => {
    flushTimer.current = null;
    const buffered = chunkBuffer.current;
    chunkBuffer.current = '';
    if (!buffered) return;
    mutateActive(prev => {
      const items = [...prev.items];
      const last  = items[items.length - 1];
      let pending = '';
      if (last?.kind === 'text' && !last.content.endsWith('\n')) {
        pending = last.content;
        items.pop();
      }
      const combined   = pending + buffered;
      const newlineIdx = combined.lastIndexOf('\n');
      if (newlineIdx === -1) {
        items.push({ kind: 'text', content: combined });
      } else {
        const finalized = combined.slice(0, newlineIdx + 1);
        const tail      = combined.slice(newlineIdx + 1);
        for (const line of finalized.split('\n')) {
          items.push({ kind: 'text', content: line + '\n' });
        }
        if (tail) items.push({ kind: 'text', content: tail });
      }
      return { ...prev, items };
    });
  }, [mutateActive]);

  const appendChunk = useCallback((chunk: string) => {
    chunkBuffer.current += chunk;
    if (flushTimer.current == null) {
      flushTimer.current = setTimeout(flushChunkBuffer, 16);
    }
  }, [flushChunkBuffer]);

  // ── Diff extraction from tool_done ─────────────────────────────────────────
  const tryExtractDiff = useCallback((preview: string | undefined, tool: string): FileDiff | null => {
    if (tool !== 'fs_write' || !preview) return null;
    try {
      const parsed = JSON.parse(preview);
      if (parsed && typeof parsed === 'object' && parsed.ok && parsed.path) {
        return {
          path:   parsed.path,
          before: parsed.before ?? null,
          after:  parsed.after  ?? '',
          mode:   parsed.mode   ?? 'overwrite',
        } as FileDiff;
      }
    } catch { /* not JSON or not a diff payload */ }
    return null;
  }, []);

  // ── Display-event handler ───────────────────────────────────────────────────
  const handleDisplay = useCallback((e: DisplayEvent) => {
    switch (e.type) {
      case 'tool_call':
        if (e.tool) {
          const key = e.toolCallId ?? e.tool;
          toolTimers.current.set(key, Date.now());
          flushChunkBuffer();
          appendItem({ kind: 'tool_call', tool: e.tool, label: toolLabel(e.args ?? {}), toolCallId: e.toolCallId });
          setToolCount(n => n + 1);
        }
        break;

      case 'tool_done':
        if (e.tool) {
          const key     = e.toolCallId ?? e.tool;
          const started = toolTimers.current.get(key);
          const dur     = started ? Date.now() - started : undefined;
          toolTimers.current.delete(key);

          // Replace the running tool_call item with a tool_done item
          mutateActive(prev => ({
            ...prev,
            items: prev.items.map(item =>
              item.kind === 'tool_call' &&
              (item.toolCallId === e.toolCallId || item.tool === e.tool) &&
              !prev.items.some(i => i.kind === 'tool_done' && i.toolCallId === e.toolCallId)
                ? { kind: 'tool_done' as const, tool: e.tool!, durationMs: dur, toolCallId: e.toolCallId, outputPreview: e.preview }
                : item,
            ),
          }));

          // If fs_write, extract diff and add it to the static feed
          const diff = tryExtractDiff(e.preview, e.tool);
          if (diff) {
            setStaticItems(prev => [...prev, { _type: 'diff', key: nextKey(), diff }]);
          }
        }
        break;

      case 'step_start':
        flushChunkBuffer();
        appendItem({ kind: 'step_start', stepIndex: e.stepIndex ?? 0, task: e.task ?? '', agentName: e.agentName ?? '' });
        break;
      case 'step_chunk':
        appendItem({ kind: 'step_chunk', stepIndex: e.stepIndex ?? 0, agentName: e.agentName ?? '', content: e.content ?? '' });
        break;
      case 'step_done':
        appendItem({ kind: 'step_done', stepIndex: e.stepIndex ?? 0, agentName: e.agentName ?? '' });
        break;
      case 'spawn_chunk':
        appendItem({ kind: 'spawn_chunk', agentName: e.agentName ?? '', content: e.content ?? '' });
        break;
      case 'spawn_done':
        appendItem({ kind: 'spawn_done', agentName: e.agentName ?? '' });
        break;
      case 'plan':
        if (e.steps) appendItem({ kind: 'plan', steps: e.steps });
        break;
      case 'merge_start':
        appendItem({ kind: 'merge_start' });
        break;
      case 'route':
        if (e.fromName && e.toName) appendItem({ kind: 'route', from: e.fromName, to: e.toName });
        break;
      case 'agent_message':
        if (e.fromName && e.toName) appendItem({ kind: 'agent_message', from: e.fromName, to: e.toName, preview: e.preview ?? '' });
        break;
      case 'interrupted':
        appendItem({ kind: 'interrupted', reason: e.reason ?? 'unknown' });
        break;
      case 'meta':
        setMetaInfo({ tokensIn: e.tokensIn, tokensOut: e.tokensOut, costUsd: e.costUsd, model: e.model });
        break;
    }
  }, [mutateActive, appendItem, flushChunkBuffer, tryExtractDiff]);

  // ── Core send (used by submit + reconnect) ─────────────────────────────────
  const sendMessage = useCallback(async (
    text:      string,
    sid:       string | undefined,
    agentMsg:  Message,
    abort:     AbortController,
    attempt:   number,
  ): Promise<void> => {
    activeRef.current = agentMsg;

    try {
      await chat({
        url:      cfg.url,
        token:    cfg.token,
        message:  text,
        sessionId: sid,
        agentId:  currentAgent.id,
        context,
        signal:   abort.signal,
        onStall:      () => setStalled(true),
        onStallClear: () => setStalled(false),
        onConfirm:  handleConfirm,
        onChunk:    appendChunk,
        onSession:  (id) => setSessionId(id),
        onDisplay:  handleDisplay,
      });
      // Clean success — reset reconnect counter
      reconnectRef.current = 0;
      setReconnectCount(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // User-initiated abort — don't reconnect
      if (msg === 'cancelled by user' || abort.signal.aborted) throw err;

      // Network-level drop — attempt reconnect
      const isNetworkError = msg.startsWith('socket hang up') ||
        msg.startsWith('ECONNRESET') ||
        msg.startsWith('ECONNREFUSED') ||
        msg.startsWith('ETIMEDOUT') ||
        msg.includes('network') ||
        msg.startsWith('HTTP_5');

      if (isNetworkError && attempt < RECONNECT_DELAYS.length) {
        const delay = RECONNECT_DELAYS[attempt]!;
        reconnectRef.current = attempt + 1;
        setReconnectCount(attempt + 1);
        reconnecting.current = true;

        // Notify user
        mutateActive(prev => ({
          ...prev,
          items: [...prev.items, {
            kind: 'text' as const,
            content: `\n⟳ Connection dropped. Reconnecting in ${delay / 1000}s… (attempt ${attempt + 1}/${RECONNECT_DELAYS.length})\n`,
          }],
        }));

        await new Promise(r => setTimeout(r, delay));
        if (abort.signal.aborted) { reconnecting.current = false; throw err; }
        reconnecting.current = false;

        return sendMessage(text, sid, agentMsg, abort, attempt + 1);
      }

      throw err;
    }
  }, [cfg, currentAgent, context, appendChunk, handleConfirm, handleDisplay, mutateActive]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (text: string) => {
    if (streaming) return;
    lastUserRef.current = text;
    setError(null);
    setStalled(false);
    setStreaming(true);
    setToolCount(0);
    reconnectRef.current = 0;
    setReconnectCount(0);

    const userMsg: Message = { role: 'user', items: [{ kind: 'text', content: text }] };
    setStaticItems(prev => [...prev, { _type: 'message', key: nextKey(), message: userMsg }]);

    const agentMsg: Message = { role: 'agent', agentName: currentAgent.name, items: [] };
    setActiveMessage(agentMsg);
    activeRef.current = agentMsg;

    const abort = new AbortController();
    abortRef.current = abort;
    const snapSessionId = sessionId;

    try {
      await sendMessage(text, snapSessionId, agentMsg, abort, 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'cancelled by user') {
        setError(msg);
        mutateActive(prev => ({ ...prev, items: [...prev.items, { kind: 'error', message: msg }] }));
      }
    } finally {
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
      flushChunkBuffer();
      const finished = activeRef.current;
      if (finished && finished.items.length > 0) {
        setStaticItems(prev => [...prev, { _type: 'message', key: nextKey(), message: finished }]);
      }
      setActiveMessage(null);
      activeRef.current  = null;
      abortRef.current   = null;
      setStreaming(false);
      setStalled(false);
      reconnecting.current = false;
    }
  }, [streaming, sessionId, currentAgent, sendMessage, flushChunkBuffer, mutateActive]);

  // ── Abort ──────────────────────────────────────────────────────────────────
  const handleAbort = useCallback(() => { abortRef.current?.abort(); }, []);

  // ── Agent picker ───────────────────────────────────────────────────────────
  const handleAgentSelected = useCallback(async (n: number) => {
    setPendingAgentPick(false);
    const active = agents.filter(a => a.status === 'active');
    const chosen = active[n - 1];
    if (!chosen) return;
    setCurrentAgent(chosen);
    setStaticItems(prev => [...prev, {
      _type:   'message',
      key:     nextKey(),
      message: {
        role:      'agent',
        agentName: 'nclaw',
        items:     [{ kind: 'text', content: `Switched to ${chosen.name}` }],
      },
    }]);
  }, [agents]);

  // ── Command context ────────────────────────────────────────────────────────
  const cmdCtx = useMemo<CommandContext>(() => ({
    submit:        handleSubmit,
    clearScreen:   () => setStaticItems([]),
    openAgentPick: () => setPendingAgentPick(true),
    exit:          () => exit(),
    retryLast:     () => { if (lastUserRef.current) void handleSubmit(lastUserRef.current); },
    newSession: () => {
      setSessionId(undefined);
      setStaticItems([]);
      setMetaInfo({});
      setToolCount(0);
    },
    setCwdDisplay: () => {},

    // /cd — change cwd mid-session
    changeCwd: (dir: string) => {
      setCwd(dir);
    },

    // /files — list inline (handled in registry, uses emitSystem)
    listCwd: async () => {},

    getLastAgentMessage: () => {
      const items = [...staticRef.current];
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item._type === 'message' && item.message.role === 'agent') {
          return item.message.items
            .filter(it => it.kind === 'text')
            .map(it => (it as { content: string }).content)
            .join('');
        }
      }
      return null;
    },

    emitSystem: (text: string) => {
      if (text === '__internal_help__') {
        setStaticItems(prev => [...prev, { _type: 'message', key: nextKey(), message: makeHelpMessage() }]);
        return;
      }
      setStaticItems(prev => [...prev, {
        _type:   'message',
        key:     nextKey(),
        message: {
          role:      'agent',
          agentName: 'nclaw',
          items:     [{ kind: 'text', content: text }],
        },
      }]);
    },

    emitLines: (lines: string[]) => {
      setStaticItems(prev => [
        ...prev,
        ...lines.map(line => ({
          _type:   'message' as const,
          key:     nextKey(),
          message: {
            role:      'agent' as const,
            agentName: 'nclaw',
            items:     [{ kind: 'text' as const, content: line }],
          },
        })),
      ]);
    },
  }), [handleSubmit, exit]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const host = getHost(cfg.url);

  // Build initial welcome item once
  const welcomeItem = useMemo<StaticItem>(() => ({
    _type:   'welcome',
    key:     'welcome',
    version: PKG_VERSION,
    host,
    agent:   currentAgent.name,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const allStaticItems = useMemo<StaticItem[]>(
    () => [welcomeItem, ...staticItems],
    [welcomeItem, staticItems],
  );

  return (
    // NO fixed height — let the terminal scroll naturally.
    <Box flexDirection="column">

      {/* ── Scrollback: welcome splash + committed messages + diffs ───── */}
      <Static items={allStaticItems}>
        {(item) => {
          if (item._type === 'welcome') {
            return (
              <Welcome
                key={item.key}
                version={item.version}
                host={item.host}
                agentName={item.agent}
              />
            );
          }
          if (item._type === 'diff') {
            return <DiffView key={item.key} diff={item.diff} />;
          }
          // message
          return (
            <MessageBubble
              key={item.key}
              message={item.message}
              isStreaming={false}
            />
          );
        }}
      </Static>

      {/* ── Live streaming message ─────────────────────────────────────── */}
      {activeMessage && (
        <MessageBubble message={activeMessage} isStreaming={streaming} />
      )}

      {/* ── Error banner ──────────────────────────────────────────────── */}
      {error && !streaming && (
        <Box paddingX={2} marginY={0}>
          <Text color="#EF4444">  ✗ {error}</Text>
        </Box>
      )}

      {/* ── Divider + input + footer ───────────────────────────────────── */}
      <Divider streaming={streaming} />
      <InputBar
        streaming={streaming}
        stalled={stalled}
        error={error}
        pendingConfirm={pendingConfirm}
        pendingAgentPick={pendingAgentPick}
        agents={agents}
        onSubmit={handleSubmit}
        onAbort={handleAbort}
        onConfirmResolve={(r: import('../confirm').ConfirmResult) => {
          pendingConfirm?.resolve(r);
          setPendingConfirm(null);
        }}
        onAgentPick={() => setPendingAgentPick(true)}
        onAgentSelected={handleAgentSelected}
        onExit={() => exit()}
        cmdCtx={cmdCtx}
      />
      <Footer
        cwd={cwd}
        agentName={currentAgent.name}
        host={host}
        streaming={streaming}
        toolCount={toolCount}
        sessionId={sessionId}
        tokensIn={metaInfo.tokensIn}
        tokensOut={metaInfo.tokensOut}
        costUsd={metaInfo.costUsd}
        model={metaInfo.model}
        branch={gitInfo.branch}
        dirty={gitInfo.dirty}
        yolo={isYoloMode()}
        stalled={stalled}
        reconnect={reconnectCount > 0 ? reconnectCount : undefined}
      />
    </Box>
  );
}
