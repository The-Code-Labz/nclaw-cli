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
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Box, Static, Text, useApp } from 'ink';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { chat, listAgents, RemoteAgent, DisplayEvent } from '../remote';
import type { NclawConfig } from '../config';
import { scanTree } from '../tree';
import MessageBubble, { Message, MessageItem } from './MessageBubble';
import InputBar, { ConfirmRequest } from './InputBar';
import Footer from './Footer';
import Welcome from './Welcome';
import type { ConfirmResult } from '../confirm';
import { commands } from '../commands/registry';
import type { CommandContext } from '../commands/types';
import { isYoloMode } from '../permissions';

// ── Package version ───────────────────────────────────────────────────────────
let PKG_VERSION = '0.2.0';
try {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  PKG_VERSION   = pkg.version ?? PKG_VERSION;
} catch { /* no-op */ }

// ── Git helpers ───────────────────────────────────────────────────────────────
function readGitBranch(): string | undefined {
  try {
    const head = fs.readFileSync(path.join(process.cwd(), '.git', 'HEAD'), 'utf8').trim();
    const m    = head.match(/^ref:\s+refs\/heads\/(.+)$/);
    if (m) return m[1];
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7);
  } catch { /* not a git repo */ }
  return undefined;
}
function readGitDirty(): Promise<boolean> {
  return new Promise(resolve => {
    execFile('git', ['status', '--porcelain'], { cwd: process.cwd(), timeout: 5000 }, (err, out) => {
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

// ── Divider line ──────────────────────────────────────────────────────────────
function Divider({ streaming }: { streaming: boolean }) {
  const cols  = process.stdout.columns ?? 80;
  const char  = '─';
  const color = streaming ? '#22D3EE' : '#374151';
  return (
    <Box paddingX={1}>
      <Text color={color}>{char.repeat(Math.max(1, cols - 2))}</Text>
    </Box>
  );
}

// ── Help message ──────────────────────────────────────────────────────────────
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

  const toolTimers  = useRef(new Map<string, number>());
  const chunkBuffer = useRef('');
  const flushTimer  = useRef<NodeJS.Timeout | null>(null);
  const activeRef   = useRef<Message | null>(null);
  const abortRef    = useRef<AbortController | null>(null);
  const lastUserRef = useRef<string | null>(null);
  const staticRef   = useRef<Message[]>([]);

  useEffect(() => { staticRef.current = staticMessages; }, [staticMessages]);
  useEffect(() => { activeRef.current = activeMessage;  }, [activeMessage]);

  // ── Git status ────────────────────────────────────────────────────────────
  useEffect(() => {
    const branch = readGitBranch();
    if (!branch) return;
    setGitInfo(prev => ({ ...prev, branch }));
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      const dirty = await readGitDirty();
      if (!cancelled) setGitInfo(prev => ({ ...prev, dirty }));
    };
    void refresh();
    const id = setInterval(() => { if (!streaming) void refresh(); }, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [streaming]);

  // ── Confirm gate ──────────────────────────────────────────────────────────
  const handleConfirm = useCallback((command: string): Promise<ConfirmResult> => {
    return new Promise(resolve => setPendingConfirm({ command, resolve }));
  }, []);

  // ── Active-message mutation ───────────────────────────────────────────────
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

  // ── Streamed text batching (16ms = one ~60fps frame) ─────────────────────
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
      flushTimer.current = setTimeout(flushChunkBuffer, 16);
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
          mutateActive(prev => ({
            ...prev,
            items: prev.items.map(item =>
              item.kind === 'tool_call' &&
              (item.toolCallId === e.toolCallId || item.tool === e.tool) &&
              !prev.items.some(i => i.kind === 'tool_done' && i.toolCallId === e.toolCallId)
                ? { kind: 'tool_done' as const, tool: e.tool!, durationMs: dur, toolCallId: e.toolCallId, outputPreview: e.preview }
                : item
            ),
          }));
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
  }, [mutateActive, appendItem, flushChunkBuffer]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (text: string) => {
    if (streaming) return;
    lastUserRef.current = text;
    setError(null);
    setStalled(false);
    setStreaming(true);
    setToolCount(0);

    const userMsg: Message = { role: 'user', items: [{ kind: 'text', content: text }] };
    setStaticMessages(prev => [...prev, userMsg]);

    const agentMsg: Message = { role: 'agent', agentName: currentAgent.name, items: [] };
    setActiveMessage(agentMsg);
    activeRef.current = agentMsg;

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await chat({
        url:      cfg.url,
        token:    cfg.token,
        message:  text,
        sessionId,
        agentId:  currentAgent.id,
        context,
        signal:   abort.signal,
        onStall:      () => setStalled(true),
        onStallClear: () => setStalled(false),
        onConfirm:  handleConfirm,
        onChunk:    appendChunk,
        onSession:  (sid) => setSessionId(sid),
        onDisplay:  handleDisplay,
      });
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
      if (finished) setStaticMessages(prev => [...prev, finished]);
      setActiveMessage(null);
      activeRef.current  = null;
      abortRef.current   = null;
      setStreaming(false);
      setStalled(false);
    }
  }, [streaming, sessionId, currentAgent, cfg, context, appendChunk, handleConfirm, handleDisplay, flushChunkBuffer, mutateActive]);

  // ── Abort ─────────────────────────────────────────────────────────────────
  const handleAbort = useCallback(() => { abortRef.current?.abort(); }, []);

  // ── Agent picker ──────────────────────────────────────────────────────────
  const handleAgentSelected = useCallback(async (n: number) => {
    setPendingAgentPick(false);
    const active = agents.filter(a => a.status === 'active');
    const chosen = active[n - 1];
    if (!chosen) return;
    setCurrentAgent(chosen);
    setStaticMessages(prev => [...prev, {
      role:      'agent',
      agentName: 'nclaw',
      items:     [{ kind: 'text', content: `Switched to ${chosen.name}` }],
    }]);
  }, [agents]);

  // ── Command context ───────────────────────────────────────────────────────
  const cmdCtx = useMemo<CommandContext>(() => ({
    submit:        handleSubmit,
    clearScreen:   () => setStaticMessages([]),
    openAgentPick: () => setPendingAgentPick(true),
    exit:          () => exit(),
    retryLast:     () => { if (lastUserRef.current) void handleSubmit(lastUserRef.current); },
    newSession:    () => {
      setSessionId(undefined);
      setStaticMessages([]);
      setMetaInfo({});
      setToolCount(0);
    },
    setCwdDisplay: () => {},
    getLastAgentMessage: () => {
      const msgs = [...staticRef.current];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]!.role === 'agent') {
          return msgs[i]!.items
            .filter(item => item.kind === 'text')
            .map(item => (item as { content: string }).content)
            .join('');
        }
      }
      return null;
    },
    emitSystem: (text: string) => {
      if (text === '__internal_help__') {
        setStaticMessages(prev => [...prev, makeHelpMessage()]);
        return;
      }
      setStaticMessages(prev => [...prev, {
        role:      'agent',
        agentName: 'nclaw',
        items:     [{ kind: 'text', content: text }],
      }]);
    },
    emitLines: (lines: string[]) => {
      setStaticMessages(prev => [
        ...prev,
        ...lines.map(line => ({
          role:      'agent' as const,
          agentName: 'nclaw',
          items:     [{ kind: 'text' as const, content: line }],
        })),
      ]);
    },
  }), [handleSubmit, exit]);

  // ── Render ────────────────────────────────────────────────────────────────
  const host = getHost(cfg.url);

  return (
    // NO fixed height — let the terminal scroll naturally.
    // flexDirection=column is still needed so Static + live + chrome stack vertically.
    <Box flexDirection="column">
      {/* ── Scrollback: welcome splash + committed messages ────────────── */}
      <Static items={[
        { _type: 'welcome' as const },
        ...staticMessages.map((m, i) => ({ _type: 'msg' as const, m, i })),
      ]}>
        {(item) => {
          if (item._type === 'welcome') {
            return (
              <Welcome
                key="welcome"
                version={PKG_VERSION}
                host={host}
                agentName={currentAgent.name}
              />
            );
          }
          return <MessageBubble key={`msg-${item.i}`} message={item.m} />;
        }}
      </Static>

      {/* ── Live streaming message ─────────────────────────────────────── */}
      {activeMessage && (
        <MessageBubble message={activeMessage} isStreaming={streaming} />
      )}

      {/* ── Bottom chrome — always visible at cursor position ─────────── */}
      <Divider streaming={streaming} />

      <InputBar
        streaming={streaming}
        pendingConfirm={pendingConfirm}
        pendingAgentPick={pendingAgentPick}
        agents={agents}
        error={error}
        stalled={stalled}
        onSubmit={(t) => void handleSubmit(t)}
        onAbort={handleAbort}
        onConfirmResolve={(r) => {
          const pending = pendingConfirm;
          setPendingConfirm(null);
          pending?.resolve(r);
        }}
        onAgentPick={() => setPendingAgentPick(true)}
        onAgentSelected={handleAgentSelected}
        onExit={() => exit()}
        cmdCtx={cmdCtx}
      />

      <Footer
        cwd={process.cwd()}
        agentName={currentAgent.name}
        host={host}
        streaming={streaming}
        stalled={stalled}
        toolCount={toolCount}
        sessionId={sessionId}
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
