import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Static, useApp } from 'ink';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { chat, listAgents, RemoteAgent, DisplayEvent } from '../remote';
import type { NclawConfig } from '../config';
import { scanTree } from '../tree';
import MessageBubble, { Message, MessageItem } from './MessageBubble';
import InputBar, { ConfirmRequest } from './InputBar';
import Footer from './Footer';
import type { ConfirmResult } from '../confirm';
import { commands } from '../commands/registry';
import type { CommandContext } from '../commands/types';
import { isYoloMode } from '../permissions';
import Toast, { ToastData, ToastVariant } from './Toast';
import { useThemeContext } from './ThemeProvider';

// ── Git status detection ──────────────────────────────────────────────────
function readGitBranch(): string | undefined {
  try {
    const head = fs.readFileSync(path.join(process.cwd(), '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref:\s+refs\/heads\/(.+)$/);
    if (m) return m[1];
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7);
  } catch { /* not a repo */ }
  return undefined;
}
function readGitDirty(): Promise<boolean> {
  return new Promise(resolve => {
    execFile('git', ['status', '--porcelain'], { cwd: process.cwd(), timeout: 5000 }, (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve(stdout.trim().length > 0);
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
  return String(args['path'] ?? args['command'] ?? '').slice(0, 60);
}

export default function App({ cfg, agents: initialAgents }: Props) {
  const { exit } = useApp();

  const [agents,           setAgents]           = useState<RemoteAgent[]>(initialAgents);
  const [currentAgent,     setCurrentAgent]     = useState<RemoteAgent>(
    () => initialAgents.find(a => a.status === 'active') ?? initialAgents[0]!,
  );
  const [staticMessages,   setStaticMessages]   = useState<Message[]>([]);
  const [activeMessage,    setActiveMessage]    = useState<Message | null>(null);
  const [sessionId,        setSessionId]        = useState<string | undefined>();
  const [streaming,        setStreaming]        = useState(false);
  const [pendingConfirm,   setPendingConfirm]   = useState<ConfirmRequest | null>(null);
  const [pendingAgentPick, setPendingAgentPick] = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [stalled,          setStalled]          = useState(false);
  const [toolCount,        setToolCount]        = useState(0);
  const [context]                               = useState(() => scanTree(process.cwd()));
  const [metaInfo,         setMetaInfo]         = useState<{
    tokensIn?: number; tokensOut?: number; costUsd?: number; model?: string;
  }>({});
  const [gitInfo,          setGitInfo]          = useState<{ branch?: string; dirty?: boolean }>({});

  const { cycle: cycleThemePreset } = useThemeContext();

  // ── Toast notifications ───────────────────────────────────────────────────
  const [toasts,      setToasts]    = useState<ToastData[]>([]);
  const toastCounter  = useRef(0);

  const showToast = useCallback((
    message:  string,
    variant:  ToastVariant = 'info',
    duration: number       = 3000,
  ) => {
    const id = ++toastCounter.current;
    setToasts(prev => [...prev.slice(-4), { id, message, variant, duration }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toolTimers   = useRef(new Map<string, number>());
  const chunkBuffer  = useRef('');
  const flushTimer   = useRef<NodeJS.Timeout | null>(null);
  const activeRef    = useRef<Message | null>(null);
  const abortRef     = useRef<AbortController | null>(null);
  const lastUserRef  = useRef<string | null>(null);
  const staticRef    = useRef<Message[]>([]);

  useEffect(() => { staticRef.current = staticMessages; }, [staticMessages]);

  // Git status: branch from .git/HEAD, dirty via `git status --porcelain`.
  // Re-checked every 10s while not streaming. Silent if git isn't installed.
  useEffect(() => {
    const branch = readGitBranch();
    if (!branch) return;
    setGitInfo(prev => ({ ...prev, branch }));

    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      const dirty = await readGitDirty();
      if (cancelled) return;
      setGitInfo(prev => ({ ...prev, dirty }));
    };
    void refresh();
    const id = setInterval(() => {
      // Skip refresh while streaming to avoid spawning git mid-response.
      if (!streaming) void refresh();
    }, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [streaming]);

  useEffect(() => { activeRef.current = activeMessage; }, [activeMessage]);

  // ── Confirmation gate ─────────────────────────────────────────────────────
  const handleConfirm = useCallback((command: string): Promise<ConfirmResult> => {
    return new Promise(resolve => setPendingConfirm({ command, resolve }));
  }, []);

  // ── Active-message mutation helpers ───────────────────────────────────────
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

  // ── Streamed text batching ────────────────────────────────────────────────
  // Split incoming buffered chunks into closed lines (terminated by \n) and
  // a tail. Closed lines become their own immutable `text` items so React
  // can skip re-rendering them on subsequent flushes; only the tail (the
  // last partial line) lives in mutable state and re-renders each tick.
  const flushChunkBuffer = useCallback(() => {
    flushTimer.current = null;
    const buffered = chunkBuffer.current;
    chunkBuffer.current = '';
    if (!buffered) return;
    mutateActive(prev => {
      const items = [...prev.items];
      const last  = items[items.length - 1];

      // If the last item is a text item that has not been "closed" (does
      // not end with \n), we're allowed to extend it. Otherwise we start a
      // new text item.
      let pending = '';
      if (last?.kind === 'text' && !last.content.endsWith('\n')) {
        pending = last.content;
        items.pop();
      }
      const combined = pending + buffered;

      // Split into [finalizedWithNewline..., tail]. Each finalized line is
      // pushed as its own `text` item ending in '\n'; the tail (if any)
      // remains mutable as the new last item.
      const newlineIdx = combined.lastIndexOf('\n');
      if (newlineIdx === -1) {
        items.push({ kind: 'text', content: combined });
      } else {
        const finalized = combined.slice(0, newlineIdx + 1);
        const tail      = combined.slice(newlineIdx + 1);
        // Push each line (including its trailing \n) as a separate item so
        // re-renders only touch the last (mutable) tail item.
        for (const line of finalized.split(/(?<=\n)/)) {
          if (line) items.push({ kind: 'text', content: line });
        }
        if (tail) items.push({ kind: 'text', content: tail });
      }
      return { ...prev, items };
    });
  }, [mutateActive]);

  const appendChunk = useCallback((chunk: string) => {
    chunkBuffer.current += chunk;
    if (flushTimer.current == null) {
      flushTimer.current = setTimeout(flushChunkBuffer, 30);
    }
  }, [flushChunkBuffer]);

  // ── Display-event handler ─────────────────────────────────────────────────
  const handleDisplay = useCallback((e: DisplayEvent) => {
    switch (e.type) {
      case 'tool_call':
        if (e.tool) {
          const key = e.toolCallId ?? e.tool;
          toolTimers.current.set(key, Date.now());
          flushChunkBuffer();
          appendItem({
            kind:       'tool_call',
            tool:       e.tool,
            label:      toolLabel(e.args ?? {}),
            toolCallId: e.toolCallId,
          });
          setToolCount(c => c + 1);
        }
        break;

      case 'tool_done':
        if (e.tool) {
          const key      = e.toolCallId ?? e.tool;
          const started  = toolTimers.current.get(key);
          const duration = started != null ? Date.now() - started : undefined;
          toolTimers.current.delete(key);
          flushChunkBuffer();
          appendItem({ kind: 'tool_done', tool: e.tool, toolCallId: e.toolCallId, durationMs: duration });
        }
        break;

      case 'plan':
        if (e.steps) { flushChunkBuffer(); appendItem({ kind: 'plan', steps: e.steps }); }
        break;

      case 'step_start':
        if (e.stepIndex != null && e.task && e.agentName) {
          flushChunkBuffer();
          appendItem({ kind: 'step_start', stepIndex: e.stepIndex, task: e.task, agentName: e.agentName });
        }
        break;

      case 'step_chunk':
        if (e.stepIndex != null && e.agentName && e.content) {
          appendItem({ kind: 'step_chunk', stepIndex: e.stepIndex, agentName: e.agentName, content: e.content });
        }
        break;

      case 'step_done':
        if (e.stepIndex != null && e.agentName) {
          appendItem({ kind: 'step_done', stepIndex: e.stepIndex, agentName: e.agentName });
        }
        break;

      case 'spawn_chunk':
        if (e.agentName && e.content) {
          appendItem({ kind: 'spawn_chunk', agentName: e.agentName, content: e.content });
        }
        break;

      case 'spawn_done':
        if (e.agentName) appendItem({ kind: 'spawn_done', agentName: e.agentName });
        break;

      case 'merge_start':
        flushChunkBuffer();
        appendItem({ kind: 'merge_start' });
        break;

      case 'route':
        if (e.fromName && e.toName) {
          flushChunkBuffer();
          appendItem({ kind: 'route', from: e.fromName, to: e.toName });
        }
        break;

      case 'agent_message':
        if (e.fromName && e.toName && e.preview) {
          flushChunkBuffer();
          appendItem({ kind: 'agent_message', from: e.fromName, to: e.toName, preview: e.preview });
        }
        break;

      case 'interrupted':
        flushChunkBuffer();
        appendItem({ kind: 'interrupted', reason: e.reason ?? 'stream ended unexpectedly' });
        break;

      case 'meta':
        // Server-side metadata: model id, token counts, cost. All optional;
        // merge into existing state so partial updates don't clobber fields.
        setMetaInfo(prev => ({
          tokensIn:  e.tokensIn  ?? prev.tokensIn,
          tokensOut: e.tokensOut ?? prev.tokensOut,
          costUsd:   e.costUsd   ?? prev.costUsd,
          model:     e.model     ?? prev.model,
        }));
        break;
    }
  }, [appendItem, flushChunkBuffer]);

  // ── Submit a user message ─────────────────────────────────────────────────
  const handleSubmit = useCallback(async (text: string) => {
    if (streaming) return;
    setError(null);
    setStalled(false);

    lastUserRef.current = text;
    const userMsg: Message = { role: 'user', items: [{ kind: 'text', content: text }] };
    setStaticMessages(prev => [...prev, userMsg]);

    const newActive: Message = { role: 'agent', agentName: currentAgent.name, items: [] };
    setActiveMessage(newActive);
    activeRef.current = newActive;
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await chat({
        url:       cfg.url,
        token:     cfg.token,
        message:   text,
        sessionId,
        agentId:   currentAgent.id,
        context,
        signal:    ac.signal,
        onStall:      () => setStalled(true),
        onStallClear: () => setStalled(false),
        onConfirm: handleConfirm,
        onSession: (id) => setSessionId(id),
        onChunk:   appendChunk,
        onDisplay: handleDisplay,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'INVALID_TOKEN') {
        setError('Invalid token. Run `nclaw config` to re-authenticate.');
        exit();
        return;
      }
      // Surface as part of the transcript, not as a global error toast.
      mutateActive(prev => ({ ...prev, items: [...prev.items, { kind: 'error', message: msg }] }));
    } finally {
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
      flushChunkBuffer();
      const finalActive = activeRef.current;
      if (finalActive) setStaticMessages(prev => [...prev, finalActive]);
      setActiveMessage(null);
      activeRef.current = null;
      setStreaming(false);
      setStalled(false);
      abortRef.current = null;
      setPendingConfirm(prev => { prev?.resolve('no'); return null; });
    }
  }, [
    streaming, sessionId, currentAgent, cfg, context,
    handleConfirm, appendChunk, handleDisplay, flushChunkBuffer, mutateActive, exit,
  ]);

  // ── Cancel the in-flight request ─────────────────────────────────────────
  const handleAbort = useCallback(() => {
    if (!streaming) return;
    abortRef.current?.abort();
  }, [streaming]);

  // ── Agent picker ──────────────────────────────────────────────────────────
  const handleAgentPick = useCallback(async () => {
    setPendingAgentPick(true);
    try {
      const fresh = await listAgents(cfg.url, cfg.token);
      setAgents(fresh);
    } catch { /* keep stale list */ }
  }, [cfg]);

  const handleAgentSelected = useCallback((n: number) => {
    const active = agents.filter(a => a.status === 'active');
    const picked = active[n - 1];
    if (picked) setCurrentAgent(picked);
    setPendingAgentPick(false);
  }, [agents]);

  const handleConfirmResolve = useCallback((r: ConfirmResult) => {
    pendingConfirm?.resolve(r);
    setPendingConfirm(null);
  }, [pendingConfirm]);

  // ── Slash-command helpers ────────────────────────────────────────────────
  const emitSystem = useCallback((text: string) => {
    // Render help inline as a synthetic agent message so it integrates with
    // the existing transcript / Static rendering pipeline.
    if (text === '__internal_help__') {
      const helpLines = commands
        .map(c => `  **${c.slash}**${c.aliases?.length ? ` (${c.aliases.join(', ')})` : ''} — ${c.description}`)
        .join('\n');
      const body = `### Commands\n\n${helpLines}\n\nKeys: Shift+Enter newline · Ctrl+C abort · Esc cancel stream`;
      setStaticMessages(prev => [...prev, {
        role: 'agent', agentName: 'nclaw', items: [{ kind: 'text', content: body }],
      }]);
      return;
    }
    setStaticMessages(prev => [...prev, {
      role: 'agent', agentName: 'nclaw', items: [{ kind: 'text', content: text }],
    }]);
  }, []);

  const handleNewSession = useCallback(() => {
    setSessionId(undefined);
    setStaticMessages([]);
    setActiveMessage(null);
    activeRef.current = null;
    setToolCount(0);
    lastUserRef.current = null;
  }, []);

  const handleClearScreen = useCallback(() => {
    // Ink's <Static> only flushes finalized items; clearing scrollback means
    // dropping all static messages so the next render starts fresh.
    setStaticMessages([]);
    setActiveMessage(null);
    activeRef.current = null;
    // Also try to actually clear the terminal scrollback.
    if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  }, []);

  const handleRetryLast = useCallback(() => {
    const last = lastUserRef.current;
    if (!last) { emitSystem('Nothing to retry — no previous message.'); return; }
    void handleSubmit(last);
  }, [handleSubmit, emitSystem]);

  const getLastAgentMessage = useCallback((): string | null => {
    // Search staticMessages in reverse for the most recent agent text content.
    const msgs = staticRef.current;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m || m.role !== 'agent') continue;
      const text = m.items
        .filter((it): it is { kind: 'text'; content: string } => it.kind === 'text')
        .map(it => it.content)
        .join('');
      if (text.trim()) return text;
    }
    return null;
  }, []);

  const cmdCtx = useMemo<CommandContext>(() => ({
    submit:        (t) => void handleSubmit(t),
    clearScreen:   handleClearScreen,
    openAgentPick: () => void handleAgentPick(),
    exit:          () => exit(),
    retryLast:     handleRetryLast,
    newSession:    handleNewSession,
    setCwdDisplay: () => { /* footer reads process.cwd() directly */ },
    getLastAgentMessage,
    emitSystem,
    showToast,
    cycleTheme: cycleThemePreset,
  }), [
    handleSubmit, handleClearScreen, handleAgentPick, exit,
    handleRetryLast, handleNewSession, getLastAgentMessage, emitSystem,
    showToast, cycleThemePreset,
  ]);

  return (
    <Box flexDirection="column">
      <Static items={staticMessages}>
        {(msg, i) => <MessageBubble key={i} message={msg} />}
      </Static>

      {activeMessage && (
        <MessageBubble message={activeMessage} isStreaming={streaming} />
      )}

      <Toast toasts={toasts} onDismiss={dismissToast} />

      <InputBar
        streaming={streaming}
        pendingConfirm={pendingConfirm}
        pendingAgentPick={pendingAgentPick}
        agents={agents.filter(a => a.status === 'active')}
        error={error}
        stalled={stalled}
        onSubmit={handleSubmit}
        onAbort={handleAbort}
        onConfirmResolve={handleConfirmResolve}
        onAgentPick={handleAgentPick}
        onAgentSelected={handleAgentSelected}
        onExit={exit}
        cmdCtx={cmdCtx}
      />

      <Footer
        cwd={process.cwd()}
        agentName={currentAgent.name}
        host={getHost(cfg.url)}
        streaming={streaming}
        toolCount={toolCount}
        tokensIn={metaInfo.tokensIn}
        tokensOut={metaInfo.tokensOut}
        costUsd={metaInfo.costUsd}
        model={metaInfo.model}
        branch={gitInfo.branch}
        dirty={gitInfo.dirty}
        yolo={isYoloMode()}
      />
    </Box>
  );
}
