import https from 'https';
import http from 'http';
import { URL } from 'url';
import { executeToolCall } from './executor';

export interface RemoteAgent {
  id:     string;
  name:   string;
  role:   string;
  status: string;
}

export interface DisplayEvent {
  type:          'tool_call'  | 'tool_done' | 'step_start' | 'step_done' |
                 'plan'       | 'spawn_chunk' | 'spawn_done' | 'merge_start' |
                 'route'      | 'agent_message' | 'step_chunk' | 'interrupted' |
                 'meta';
  tool?:         string;
  toolCallId?:   string;
  args?:         Record<string, unknown>;
  stepIndex?:    number;
  task?:         string;
  agentName?:    string;
  content?:      string;
  steps?:        Array<{ index: number; task: string; agent: string }>;
  fromName?:     string;
  toName?:       string;
  preview?:      string;
  /** For `interrupted`: human-readable reason the stream was cut short. */
  reason?:       string;
  /** For `meta`: live model/token/cost info from the server. */
  tokensIn?:     number;
  tokensOut?:    number;
  costUsd?:      number;
  model?:        string;
}

export interface ChatOptions {
  url:         string;
  token:       string;
  message:     string;
  sessionId?:  string;
  agentId?:    string;
  context?:    string;
  /** Optional abort signal to cancel the stream */
  signal?:     AbortSignal;
  /** Called when the stream has been idle (no chunk + no tool work) this long */
  onStall?:    (idleMs: number) => void;
  /** Called when the stall clears */
  onStallClear?: () => void;
  /** Idle threshold before onStall fires (default 45_000 ms) */
  stallTimeoutMs?: number;
  /** Hard kill — abort the request if idle for this long (default 180_000 ms = 3 min) */
  hardAbortMs?: number;
  onConfirm:   (command: string) => Promise<import('./confirm').ConfirmResult>;
  onChunk:     (chunk: string) => void;
  onSession:   (sessionId: string) => void;
  onDisplay?:  (e: DisplayEvent) => void;
}

type SSEEvent = {
  type:        string;
  content?:    string;
  sessionId?:  string;
  message?:    string;
  toolCallId?: string;
  tool?:       string;
  args?:       Record<string, unknown>;
  stepIndex?:  number;
  task?:       string;
  agentName?:  string;
  steps?:      Array<{ index: number; task: string; agent: string }>;
  fromName?:   string;
  toName?:     string;
  preview?:    string;
  result?:     string;
  tokensIn?:   number;
  tokensOut?:  number;
  costUsd?:    number;
  model?:      string;
};

function httpLib(parsed: URL): typeof http | typeof https {
  return parsed.protocol === 'https:' ? https : http;
}

function makeOpts(
  parsed:  URL,
  method:  string,
  headers: Record<string, string | number> = {},
): http.RequestOptions {
  return {
    method,
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
    path:     parsed.pathname + parsed.search,
    headers,
  };
}

function postToolResult(
  url:        string,
  token:      string,
  sessionId:  string,
  toolCallId: string,
  result:     string,
): Promise<void> {
  const parsed = new URL(`${url.replace(/\/$/, '')}/api/chat/tool-result`);
  const body   = JSON.stringify({ toolCallId, result, sessionId });
  const opts   = makeOpts(parsed, 'POST', {
    'Content-Type':      'application/json',
    'Content-Length':    Buffer.byteLength(body),
    'x-dashboard-token': token,
  });

  return new Promise((resolve, reject) => {
    const req = httpLib(parsed).request(opts, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Open an SSE chat stream against the NeuroClaw server.
 *
 * Lifecycle:
 *   - `res.on('data')` parses `data: { ... }` lines into an event queue.
 *   - A single `drain()` runs serially, awaiting tool execution so we can
 *     post results back before more chunks arrive.
 *   - Resolves only when the server signals `[DONE]` AND the queue has drained.
 *   - `signal` aborts the entire request (destroys socket, posts nothing).
 *   - `onStall` fires after `stallTimeoutMs` of no progress (no chunks, no
 *     tool work). The stall timer resets every time data arrives or a tool
 *     completes. If still idle after `hardAbortMs`, we forcibly abort.
 */
export function chat(opts: ChatOptions): Promise<void> {
  const parsed = new URL(`${opts.url.replace(/\/$/, '')}/api/chat`);
  const body   = JSON.stringify({
    message:   opts.message,
    sessionId: opts.sessionId,
    agentId:   opts.agentId,
    context:   opts.context,
  });

  const reqOpts = makeOpts(parsed, 'POST', {
    'Content-Type':      'application/json',
    'Content-Length':    Buffer.byteLength(body),
    'x-dashboard-token': opts.token,
    'x-tool-relay':      'true',
  });

  const STALL_MS = opts.stallTimeoutMs ?? 45_000;
  const HARD_MS  = opts.hardAbortMs    ?? 180_000;

  return new Promise((resolve, reject) => {
    const req = httpLib(parsed).request(reqOpts, (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        reject(new Error('INVALID_TOKEN')); res.resume(); return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP_${res.statusCode}`)); res.resume(); return;
      }

      let buf             = '';
      let currentSession  = opts.sessionId ?? '';
      const eventQueue:     SSEEvent[] = [];
      let processing      = false;
      let serverDone      = false;
      let settled         = false;
      let toolBusy        = false;  // suppress stall detection while a tool is running

      // ── Stall detection ────────────────────────────────────────────────
      let lastProgressAt   = Date.now();
      let stallNotified    = false;
      const stallInterval  = setInterval(() => {
        if (settled || toolBusy) return;
        const idle = Date.now() - lastProgressAt;
        if (idle >= HARD_MS) {
          settle(new Error(`agent stalled — no progress for ${Math.round(idle / 1000)}s. Aborted.`));
          try { req.destroy(); } catch { /* ignore */ }
          return;
        }
        if (idle >= STALL_MS && !stallNotified) {
          stallNotified = true;
          opts.onStall?.(idle);
        }
      }, 1_000);

      const markProgress = () => {
        lastProgressAt = Date.now();
        if (stallNotified) {
          stallNotified = false;
          opts.onStallClear?.();
        }
      };

      const settle = (err?: Error): void => {
        if (settled) return;
        settled = true;
        clearInterval(stallInterval);
        if (signalListener) opts.signal?.removeEventListener?.('abort', signalListener);
        if (err) reject(err);
        else resolve();
      };

      const maybeResolve = (): void => {
        if (settled) return;
        if (serverDone && eventQueue.length === 0 && !processing) settle();
      };

      // ── Abort signal handling ──────────────────────────────────────────
      const signalListener = () => {
        try { req.destroy(); } catch { /* ignore */ }
        settle(new Error('cancelled by user'));
      };
      if (opts.signal) {
        if (opts.signal.aborted) {
          signalListener();
          return;
        }
        opts.signal.addEventListener('abort', signalListener, { once: true });
      }

      async function drain(): Promise<void> {
        if (processing) return;
        processing = true;
        try {
          while (eventQueue.length > 0) {
            if (settled) return; // got aborted mid-drain
            const ev = eventQueue.shift()!;

            try {
              if (ev.type === 'session' && ev.sessionId) {
                currentSession = ev.sessionId;
                opts.onSession(ev.sessionId);

              } else if (ev.type === 'chunk' && ev.content) {
                opts.onChunk(ev.content);
                markProgress();

              } else if (ev.type === 'done') {
                serverDone = true;

              } else if (ev.type === 'error') {
                settle(new Error(ev.message ?? 'agent error'));
                return;

              } else if (ev.type === 'tool_call' && ev.toolCallId && ev.tool) {
                opts.onDisplay?.({ type: 'tool_call', tool: ev.tool, toolCallId: ev.toolCallId, args: ev.args });
                toolBusy = true;
                let result: string;
                try {
                  result = await executeToolCall(ev.tool, ev.args ?? {}, opts.onConfirm);
                } catch (e) {
                  result = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
                }
                toolBusy = false;
                markProgress(); // tool completion counts as progress
                opts.onDisplay?.({ type: 'tool_done', tool: ev.tool, toolCallId: ev.toolCallId });
                if (settled) return;
                try {
                  await postToolResult(opts.url, opts.token, currentSession, ev.toolCallId, result);
                } catch (e) {
                  settle(new Error(`(connection lost) failed to post tool result: ${e instanceof Error ? e.message : String(e)}`));
                  return;
                }

              } else if (ev.type === 'step_start') {
                opts.onDisplay?.({ type: 'step_start', stepIndex: ev.stepIndex, task: ev.task, agentName: ev.agentName });
                markProgress();
              } else if (ev.type === 'step_chunk') {
                opts.onDisplay?.({ type: 'step_chunk', stepIndex: ev.stepIndex, agentName: ev.agentName, content: ev.content });
                markProgress();
              } else if (ev.type === 'step_done') {
                opts.onDisplay?.({ type: 'step_done', stepIndex: ev.stepIndex, agentName: ev.agentName });
              } else if (ev.type === 'plan') {
                opts.onDisplay?.({ type: 'plan', steps: ev.steps });
              } else if (ev.type === 'spawn_chunk') {
                opts.onDisplay?.({ type: 'spawn_chunk', agentName: ev.agentName, content: ev.content });
                markProgress();
              } else if (ev.type === 'spawn_done') {
                opts.onDisplay?.({ type: 'spawn_done', agentName: ev.agentName });
              } else if (ev.type === 'merge_start') {
                opts.onDisplay?.({ type: 'merge_start' });
              } else if (ev.type === 'route' && ev.fromName && ev.toName) {
                opts.onDisplay?.({ type: 'route', fromName: ev.fromName, toName: ev.toName });
              } else if (ev.type === 'agent_message') {
                opts.onDisplay?.({ type: 'agent_message', fromName: ev.fromName, toName: ev.toName, preview: ev.preview });
              } else if (ev.type === 'meta') {
                opts.onDisplay?.({
                  type:      'meta',
                  tokensIn:  ev.tokensIn,
                  tokensOut: ev.tokensOut,
                  costUsd:   ev.costUsd,
                  model:     ev.model,
                });
              }
            } catch (handlerErr) {
              // eslint-disable-next-line no-console
              console.error('[nclaw] event handler error:', handlerErr);
            }
          }
        } finally {
          processing = false;
          maybeResolve();
        }
      }

      res.setEncoding('utf8');
      res.on('data', (raw: string) => {
        markProgress();
        buf += raw;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') { serverDone = true; void drain(); continue; }
          try {
            eventQueue.push(JSON.parse(data) as SSEEvent);
          } catch (parseErr) {
            // eslint-disable-next-line no-console
            console.error('[nclaw] SSE parse error:', parseErr, 'data:', data.slice(0, 200));
          }
        }
        void drain();
      });

      res.on('end', () => {
        if (buf.trim()) {
          const trimmed = buf.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') { serverDone = true; }
            else {
              try { eventQueue.push(JSON.parse(data) as SSEEvent); }
              catch { /* ignore */ }
            }
          }
          buf = '';
        }
        void drain();
        Promise.resolve().then(async () => {
          // Wait for the in-progress drain to finish (max 10s).
          const deadline = Date.now() + 10_000;
          while (processing && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 10));
          }
          if (!serverDone) {
            // The stream ended without a [DONE] sentinel. Don't reject — that
            // would lose any text we already streamed into the active bubble.
            // Instead, emit an `interrupted` display event so the bubble can
            // show a marker, and resolve normally; the App's finally block
            // finalizes the partial message into staticMessages.
            opts.onDisplay?.({
              type:   'interrupted',
              reason: 'connection ended without [DONE]',
            });
            settle();
          } else {
            maybeResolve();
          }
        });
      });
      res.on('error', (e) => settle(new Error(`(connection lost) ${e.message}`)));
    });

    req.on('socket', (socket) => {
      socket.setKeepAlive(true, 10_000);
      // Disable Node's built-in socket timeout; we manage our own stall timer.
      socket.setTimeout(0);
    });
    req.on('error', (e) => reject(new Error(`(connection failed) ${e.message}`)));
    req.write(body);
    req.end();
  });
}

export function listAgents(url: string, token: string): Promise<RemoteAgent[]> {
  const parsed  = new URL(`${url.replace(/\/$/, '')}/api/agents`);
  const reqOpts = makeOpts(parsed, 'GET', { 'x-dashboard-token': token });

  return new Promise((resolve, reject) => {
    const req = httpLib(parsed).request(reqOpts, (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        reject(new Error('INVALID_TOKEN')); res.resume(); return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { data += c; });
      res.on('end', () => {
        try   { resolve(JSON.parse(data) as RemoteAgent[]); }
        catch { reject(new Error('Failed to parse agents response')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export function checkConnection(url: string, token: string): Promise<void> {
  const parsed  = new URL(`${url.replace(/\/$/, '')}/api/status`);
  const reqOpts = makeOpts(parsed, 'GET', { 'x-dashboard-token': token });

  return new Promise((resolve, reject) => {
    const req = httpLib(parsed).request(reqOpts, (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        reject(new Error('Invalid token — check your dashboard token.')); res.resume(); return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Server returned HTTP ${res.statusCode}`)); res.resume(); return;
      }
      res.resume(); resolve();
    });
    req.on('error', (e) => reject(new Error(`Cannot reach ${url} — ${e.message}`)));
    req.end();
  });
}
