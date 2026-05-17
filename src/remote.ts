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
  reason?:       string;
  tokensIn?:     number;
  tokensOut?:    number;
  costUsd?:      number;
  model?:        string;
}

export interface ChatOptions {
  url:             string;
  token:           string;
  message:         string;
  sessionId?:      string;
  agentId?:        string;
  context?:        string;
  signal?:         AbortSignal;
  onStall?:        (idleMs: number) => void;
  onStallClear?:   () => void;
  stallTimeoutMs?: number;
  hardAbortMs?:    number;
  onConfirm:       (command: string) => Promise<import('./confirm').ConfirmResult>;
  onChunk:         (chunk: string) => void;
  onSession:       (sessionId: string) => void;
  onDisplay?:      (e: DisplayEvent) => void;
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

const POST_TOOL_TIMEOUT_MS = 30_000;

/**
 * POST a tool result back to the server.
 * Has an explicit 30s timeout to prevent the drain loop from hanging forever
 * if the server is unresponsive.
 */
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
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      req.destroy();
      reject(new Error(`postToolResult timed out after ${POST_TOOL_TIMEOUT_MS}ms`));
    }, POST_TOOL_TIMEOUT_MS);

    const req = httpLib(parsed).request(opts, (res) => {
      res.resume();
      res.on('end', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      });
      res.on('error', (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      });
    });
    req.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

/**
 * Open an SSE chat stream against the NeuroClaw server.
 *
 * Lifecycle:
 *   - `res.on('data')` parses `data: { ... }` lines into an event queue.
 *   - A single `drain()` loop runs serially, awaiting tool execution so we
 *     can post results back before more chunks arrive.
 *   - Resolves when the server signals `[DONE]` AND the queue has drained.
 *   - `signal` aborts the entire request (destroys socket, posts nothing).
 *   - `onStall` fires after `stallTimeoutMs` of no progress.
 *   - Hard abort fires after `hardAbortMs` of idle.
 *   - `postToolResult` has its own 30s timeout so drain never hangs forever.
 *
 * Bug fixes vs original:
 *   - Replaced busy-poll (10ms setInterval for up to 10s) in `res.on('end')`
 *     with a Promise-based drain completion signal via a simple event emitter
 *     pattern — zero CPU waste, instant resolution.
 *   - `postToolResult` now has an explicit timeout (30s) so a slow server
 *     cannot freeze the drain loop indefinitely.
 *   - Chunk buffer swap is atomic: we read and zero in one assignment.
 */
export function chat(opts: ChatOptions): Promise<void> {
  const parsed  = new URL(`${opts.url.replace(/\/$/, '')}/api/chat`);
  const body    = JSON.stringify({
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
      const eventQueue:   SSEEvent[] = [];
      let processing      = false;
      let serverDone      = false;
      let settled         = false;
      let toolBusy        = false;

      // Resolve the promise returned by waitForDrain() when drain finishes.
      let drainResolve: (() => void) | null = null;

      // ── Stall detection ─────────────────────────────────────────────────
      let lastProgressAt  = Date.now();
      let stallNotified   = false;
      const stallInterval = setInterval(() => {
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
        // Signal any waiting drain waiter.
        drainResolve?.();
        if (err) reject(err);
        else resolve();
      };

      const maybeResolve = (): void => {
        if (settled) return;
        if (serverDone && eventQueue.length === 0 && !processing) settle();
      };

      // ── Abort signal ────────────────────────────────────────────────────
      const signalListener = () => {
        try { req.destroy(); } catch { /* ignore */ }
        settle(new Error('cancelled by user'));
      };
      if (opts.signal) {
        if (opts.signal.aborted) { signalListener(); return; }
        opts.signal.addEventListener('abort', signalListener, { once: true });
      }

      // ── Drain loop ───────────────────────────────────────────────────────
      // Returns a Promise that resolves once the drain loop exits.
      async function drain(): Promise<void> {
        if (processing) return;
        processing = true;
        try {
          while (eventQueue.length > 0) {
            if (settled) return;
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
                markProgress();
                let result: string;
                try {
                  result = await executeToolCall(ev.tool, ev.args ?? {}, opts.onConfirm);
                } catch (e) {
                  result = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
                }
                toolBusy = false;
                markProgress();
                opts.onDisplay?.({ type: 'tool_done', tool: ev.tool, toolCallId: ev.toolCallId, preview: ev.result });
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
              } else if (ev.type === 'interrupted') {
                opts.onDisplay?.({ type: 'interrupted', reason: ev.content ?? 'stream interrupted' });
              }
            } catch (handlerErr) {
              // eslint-disable-next-line no-console
              console.error('[nclaw] event handler error:', handlerErr);
            }
          }
        } finally {
          processing = false;
          // Signal any waiter blocked on drain completion.
          drainResolve?.();
          drainResolve = null;
          maybeResolve();
        }
      }

      // Returns a Promise that resolves when the current drain loop finishes.
      function waitForDrain(): Promise<void> {
        if (!processing) return Promise.resolve();
        return new Promise<void>(r => { drainResolve = r; });
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
          try { eventQueue.push(JSON.parse(data) as SSEEvent); }
          catch { /* ignore malformed SSE frame */ }
        }
        void drain();
      });

      res.on('end', () => {
        // Flush any remaining data in buf (no trailing \n case).
        if (buf.trim()) {
          const trimmed = buf.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') serverDone = true;
            else {
              try { eventQueue.push(JSON.parse(data) as SSEEvent); }
              catch { /* ignore */ }
            }
          }
          buf = '';
        }

        // Wait for any in-progress drain to finish — no busy-poll.
        void (async () => {
          void drain();
          await waitForDrain();

          if (!serverDone) {
            opts.onDisplay?.({ type: 'interrupted', reason: 'connection ended without [DONE]' });
          }
          // Always resolve; App's finally block will commit the partial message.
          settle();
        })();
      });

      res.on('error', (e) => settle(new Error(`(connection lost) ${e.message}`)));
    });

    req.on('socket', (socket) => {
      socket.setKeepAlive(true, 10_000);
      (socket as import('net').Socket).setTimeout(0); // disable idle socket timeout
    });

    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

// ── Utility endpoints ────────────────────────────────────────────────────────

export async function checkConnection(url: string, token: string): Promise<void> {
  const parsed = new URL(`${url.replace(/\/$/, '')}/api/health`);
  const opts   = makeOpts(parsed, 'GET', { 'x-dashboard-token': token });
  return new Promise((resolve, reject) => {
    const req = httpLib(parsed).request(opts, (res) => {
      res.resume();
      if (res.statusCode === 401 || res.statusCode === 403) {
        reject(new Error('Invalid token — check DASHBOARD_TOKEN'));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Server returned HTTP ${res.statusCode}`));
        return;
      }
      resolve();
    });
    req.on('error', (e) => reject(new Error(`Cannot reach server: ${e.message}`)));
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Connection timed out')); });
    req.end();
  });
}

export async function listAgents(url: string, token: string): Promise<RemoteAgent[]> {
  const parsed = new URL(`${url.replace(/\/$/, '')}/api/agents`);
  const opts   = makeOpts(parsed, 'GET', { 'x-dashboard-token': token });
  return new Promise((resolve, reject) => {
    const req = httpLib(parsed).request(opts, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { raw += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw) as RemoteAgent[]); }
        catch { reject(new Error('Invalid agent list response')); }
      });
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('listAgents timed out')); });
    req.end();
  });
}
