/**
 * MessageBubble — renders a single conversation turn.
 *
 * Design goals (Claude Code / opencode parity):
 * - Coalesce consecutive text chunks into minimal re-render units.
 * - Tool calls shown inline while running, collapsed when done.
 * - Reasoning rendered with a │ left bar.
 * - Markdown rendered via renderMarkdown (chalk + marked-terminal).
 * - Sub-agent step output indented under a step header.
 */
import { Box, Text } from 'ink';
import { Spinner } from './Spinner';
import { theme, toolStyle } from './theme';
import { renderMarkdown } from './markdown';

// ── Message item discriminated union ──────────────────────────────────────────

export type MessageItem =
  | { kind: 'text';          content: string }
  | { kind: 'reasoning';     content: string }
  | { kind: 'tool_call';     tool: string; label: string; toolCallId?: string }
  | { kind: 'tool_done';     tool: string; durationMs?: number; toolCallId?: string; outputPreview?: string }
  | { kind: 'plan';          steps: Array<{ index: number; task: string; agent: string }> }
  | { kind: 'step_start';    stepIndex: number; task: string; agentName: string }
  | { kind: 'step_chunk';    stepIndex: number; agentName: string; content: string }
  | { kind: 'step_done';     stepIndex: number; agentName: string }
  | { kind: 'spawn_chunk';   agentName: string; content: string }
  | { kind: 'spawn_done';    agentName: string }
  | { kind: 'merge_start' }
  | { kind: 'route';         from: string; to: string }
  | { kind: 'agent_message'; from: string; to: string; preview: string }
  | { kind: 'interrupted';   reason: string }
  | { kind: 'error';         message: string };

export type Message = {
  role:       'user' | 'agent';
  agentName?: string;
  items:      MessageItem[];
};

interface Props {
  message:      Message;
  isStreaming?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Renderers ─────────────────────────────────────────────────────────────────

function InlineToolRunning({ tool, label }: { tool: string; label: string }) {
  const style = toolStyle(tool);
  return (
    <Box paddingLeft={2}>
      <Text color={theme.textMuted}>  </Text>
      <Spinner color={style.color} />
      <Text color={style.color}> {style.pending}</Text>
      {label ? <Text color={theme.textMuted}> {label}</Text> : null}
    </Box>
  );
}

function InlineToolDone({
  tool, label, durationMs, outputPreview,
}: { tool: string; label?: string; durationMs?: number; outputPreview?: string }) {
  const style = toolStyle(tool);
  return (
    <Box paddingLeft={2} flexDirection="column">
      <Box>
        <Text color={theme.textMuted}>  </Text>
        <Text color={style.color}>{style.icon} </Text>
        <Text color={theme.textMuted}>{tool}</Text>
        {label ? <Text color={theme.textMuted}> {label}</Text> : null}
        <Text color={theme.success}>  ✓ {fmtDuration(durationMs)}</Text>
      </Box>
      {outputPreview ? (
        <Box paddingLeft={6}>
          <Text color={theme.textFaint}>{outputPreview.slice(0, 120)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function ReasoningBlock({ content }: { content: string }) {
  if (!content.trim()) return null;
  const lines = content.split('\n');
  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Box>
        <Text color={theme.textMuted}>│ </Text>
        <Text color={theme.textMuted} italic>Thinking…</Text>
      </Box>
      {lines.map((line, i) => (
        <Box key={`r-${i}`}>
          <Text color={theme.textMuted}>│ </Text>
          <Text color={theme.textMuted}>{line || ' '}</Text>
        </Box>
      ))}
    </Box>
  );
}

function Plan({ steps }: { steps: Array<{ index: number; task: string; agent: string }> }) {
  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Text color={theme.info} bold>  plan</Text>
      {steps.map((s) => (
        <Box key={s.index}>
          <Text color={theme.textMuted}>  {s.index + 1}. </Text>
          <Text>{s.task}</Text>
          <Text color={theme.textMuted}>  @{s.agent}</Text>
        </Box>
      ))}
    </Box>
  );
}

function StepHeader({ stepIndex, task, agentName }: { stepIndex: number; task: string; agentName: string }) {
  return (
    <Box marginTop={1} paddingLeft={2}>
      <Text color={theme.info}>  ▸ </Text>
      <Text color={theme.info} bold>step {stepIndex + 1}</Text>
      <Text color={theme.textMuted}>  {agentName}  </Text>
      <Text>{task}</Text>
    </Box>
  );
}

function StepDone({ stepIndex, agentName }: { stepIndex: number; agentName: string }) {
  return (
    <Box paddingLeft={2}>
      <Text color={theme.success}>  ✓ step {stepIndex + 1} </Text>
      <Text color={theme.textMuted}>{agentName}</Text>
    </Box>
  );
}

function SpawnDone({ agentName }: { agentName: string }) {
  return (
    <Box paddingLeft={2}>
      <Text color={theme.success}>  ✓ </Text>
      <Text color={theme.textMuted}>sub-agent {agentName} done</Text>
    </Box>
  );
}

function Route({ from, to }: { from: string; to: string }) {
  return (
    <Box paddingLeft={2}>
      <Text color={theme.textMuted}>  ↪ </Text>
      <Text bold>{from}</Text>
      <Text color={theme.textMuted}> → </Text>
      <Text bold>{to}</Text>
    </Box>
  );
}

function AgentMessage({ from, to, preview }: { from: string; to: string; preview: string }) {
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      <Box>
        <Text color={theme.primary}>  ✉ </Text>
        <Text bold>{from}</Text>
        <Text color={theme.textMuted}> → </Text>
        <Text bold>{to}</Text>
      </Box>
      <Box paddingLeft={6}>
        <Text color={theme.textMuted}>{preview}</Text>
      </Box>
    </Box>
  );
}

function MergeStart() {
  return (
    <Box marginTop={1} paddingLeft={2}>
      <Text color={theme.info}>  ⤳ merging results…</Text>
    </Box>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <Box paddingLeft={2}>
      <Text color={theme.error}>  ✗ {message}</Text>
    </Box>
  );
}

function InterruptedLine({ reason }: { reason: string }) {
  return (
    <Box paddingLeft={2}>
      <Text color={theme.warning}>  ⚠ stream interrupted: </Text>
      <Text color={theme.textMuted}>{reason}</Text>
      <Text color={theme.warning}>  ·  /retry to resume</Text>
    </Box>
  );
}

function TextBlock({ content }: { content: string }) {
  if (!content) return null;
  const rendered = renderMarkdown(content);
  const lines    = rendered.split('\n');
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {lines.map((line, i) => (
        <Box key={`t-${i}`}>
          <Text>{line.length ? line : ' '}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Main bubble ──────────────────────────────────────────────────────────────

export default function MessageBubble({ message, isStreaming }: Props) {
  const isUser    = message.role === 'user';
  const nameColor = isUser ? theme.secondary : theme.primary;
  const name      = isUser ? 'You' : (message.agentName ?? 'Agent');

  // Build a map of completed tool calls by ID so we can collapse them inline.
  const doneByCallId = new Map<string, { tool: string; durationMs?: number; outputPreview?: string }>();
  for (const item of message.items) {
    if (item.kind === 'tool_done' && item.toolCallId) {
      doneByCallId.set(item.toolCallId, {
        tool: item.tool, durationMs: item.durationMs, outputPreview: item.outputPreview,
      });
    }
  }

  // Merge consecutive text items into paragraphs for efficient rendering.
  const rendered: React.ReactNode[] = [];
  let textBuf      = '';
  let reasoningBuf = '';
  let key          = 0;

  const flushText = () => {
    if (!textBuf) return;
    rendered.push(<TextBlock key={`tb-${key++}`} content={textBuf} />);
    textBuf = '';
  };
  const flushReasoning = () => {
    if (!reasoningBuf) return;
    rendered.push(<ReasoningBlock key={`rb-${key++}`} content={reasoningBuf} />);
    reasoningBuf = '';
  };

  for (let i = 0; i < message.items.length; i++) {
    const item = message.items[i]!;

    // Coalesce text into a buffer — flush when we hit a non-text item.
    if (item.kind === 'text') {
      flushReasoning();
      textBuf += item.content;
      continue;
    }
    if (item.kind === 'reasoning') {
      flushText();
      reasoningBuf += item.content;
      continue;
    }

    flushText();
    flushReasoning();

    switch (item.kind) {
      case 'tool_call': {
        // If the corresponding done event is already in the list, show done immediately.
        const callId = item.toolCallId ?? item.tool;
        const done   = doneByCallId.get(callId);
        if (done) {
          rendered.push(
            <InlineToolDone
              key={`td-${key++}`}
              tool={done.tool}
              label={item.label}
              durationMs={done.durationMs}
              outputPreview={done.outputPreview}
            />
          );
        } else {
          rendered.push(<InlineToolRunning key={`tr-${key++}`} tool={item.tool} label={item.label} />);
        }
        break;
      }
      case 'tool_done':
        // Already rendered inline above via tool_call; skip the orphan done.
        if (!item.toolCallId || !doneByCallId.has(item.toolCallId)) {
          rendered.push(
            <InlineToolDone key={`td-${key++}`} tool={item.tool} durationMs={item.durationMs} outputPreview={item.outputPreview} />
          );
        }
        break;
      case 'plan':
        rendered.push(<Plan key={`pl-${key++}`} steps={item.steps} />);
        break;
      case 'step_start':
        rendered.push(<StepHeader key={`ss-${key++}`} stepIndex={item.stepIndex} task={item.task} agentName={item.agentName} />);
        break;
      case 'step_chunk':
        // Step chunks are rendered as indented text blocks.
        rendered.push(
          <Box key={`sc-${key++}`} paddingLeft={4}>
            <TextBlock content={item.content} />
          </Box>
        );
        break;
      case 'step_done':
        rendered.push(<StepDone key={`sd-${key++}`} stepIndex={item.stepIndex} agentName={item.agentName} />);
        break;
      case 'spawn_chunk':
        rendered.push(
          <Box key={`spc-${key++}`} paddingLeft={4}>
            <TextBlock content={item.content} />
          </Box>
        );
        break;
      case 'spawn_done':
        rendered.push(<SpawnDone key={`spd-${key++}`} agentName={item.agentName} />);
        break;
      case 'merge_start':
        rendered.push(<MergeStart key={`ms-${key++}`} />);
        break;
      case 'route':
        rendered.push(<Route key={`rt-${key++}`} from={item.from} to={item.to} />);
        break;
      case 'agent_message':
        rendered.push(<AgentMessage key={`am-${key++}`} from={item.from} to={item.to} preview={item.preview} />);
        break;
      case 'interrupted':
        rendered.push(<InterruptedLine key={`il-${key++}`} reason={item.reason} />);
        break;
      case 'error':
        rendered.push(<ErrorLine key={`el-${key++}`} message={item.message} />);
        break;
    }
  }

  // Flush any trailing buffers.
  flushText();
  flushReasoning();

  // Waiting spinner when the agent hasn't produced any items yet.
  const showWaitSpinner = isStreaming && message.items.length === 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Name row */}
      <Box paddingLeft={1}>
        <Text color={nameColor} bold>{name}</Text>
        {isStreaming && !showWaitSpinner && (
          <>
            <Text color={theme.textMuted}> </Text>
            <Spinner color={theme.primary} />
          </>
        )}
      </Box>

      {/* Waiting spinner before first content */}
      {showWaitSpinner && (
        <Box paddingLeft={3}>
          <Spinner color={theme.primary} />
          <Text color={theme.textMuted}> thinking…</Text>
        </Box>
      )}

      {/* Content */}
      {rendered}
    </Box>
  );
}
