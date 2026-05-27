import { Box, Text } from 'ink';
import { Spinner } from './Spinner';
import { theme, toolStyle } from './theme';
import { renderMarkdown } from './markdown';

// ── Message item discriminated union ─────────────────────────────────────────

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
  /** Show the working spinner under the name when no content has streamed yet. */
  isStreaming?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return ` ${ms}ms`;
  return ` ${(ms / 1000).toFixed(1)}s`;
}

// ── Inline item renderers ───────────────────────────────────────────────────

/** Inline tool — pending while running, icon+args when complete. (OpenCode pattern.) */
function InlineToolCall({ tool, label }: { tool: string; label: string }) {
  const style = toolStyle(tool);
  return (
    <Box paddingLeft={3}>
      <Text color={theme.textMuted}>~ </Text>
      <Spinner color={style.color} />
      <Text dimColor> {style.pending}</Text>
      {label && <Text dimColor>  {label}</Text>}
    </Box>
  );
}

function InlineToolDone({ tool, label, durationMs }: { tool: string; label?: string; durationMs?: number }) {
  const style = toolStyle(tool);
  return (
    <Box paddingLeft={3}>
      <Text color={style.color}>{style.icon} </Text>
      <Text>{tool}</Text>
      {label && <Text dimColor>  {label}</Text>}
      <Text color={theme.success}>  ✓{fmtDuration(durationMs)}</Text>
    </Box>
  );
}

/** Reasoning block — left bar of `│` glyphs, dim italic text. (OpenCode pattern.) */
function ReasoningBlock({ content }: { content: string }) {
  if (!content.trim()) return null;
  const lines = content.split('\n');
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0} paddingLeft={2}>
      <Box>
        <Text color={theme.textMuted}>│ </Text>
        <Text color={theme.textMuted} italic>Thinking</Text>
      </Box>
      {lines.map((line, i) => (
        <Box key={`r-${i}`}>
          <Text color={theme.textMuted}>│ </Text>
          <Text color={theme.textMuted}>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

function Plan({ steps }: { steps: Array<{ index: number; task: string; agent: string }> }) {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} paddingLeft={3}>
      <Box>
        <Text color={theme.info} bold>plan</Text>
      </Box>
      {steps.map((s) => (
        <Box key={s.index}>
          <Text dimColor>{s.index + 1}. </Text>
          <Text>{s.task}</Text>
          <Text dimColor>  @{s.agent}</Text>
        </Box>
      ))}
    </Box>
  );
}

function StepHeader({ stepIndex, task, agentName }: { stepIndex: number; task: string; agentName: string }) {
  return (
    <Box marginTop={1} paddingLeft={3}>
      <Text color={theme.info}>▸ step {stepIndex + 1}  </Text>
      <Text bold>{agentName}</Text>
      <Text dimColor>  {task}</Text>
    </Box>
  );
}

function StepDone({ stepIndex, agentName }: { stepIndex: number; agentName: string }) {
  return (
    <Box paddingLeft={3}>
      <Text color={theme.success}>✓ step {stepIndex + 1} done </Text>
      <Text dimColor>· {agentName}</Text>
    </Box>
  );
}

function SpawnDone({ agentName }: { agentName: string }) {
  return (
    <Box paddingLeft={3}>
      <Text color={theme.success}>✓ </Text>
      <Text dimColor>sub-agent {agentName} finished</Text>
    </Box>
  );
}

function Route({ from, to }: { from: string; to: string }) {
  return (
    <Box paddingLeft={3}>
      <Text dimColor>↪ routed from </Text>
      <Text bold>{from}</Text>
      <Text dimColor> to </Text>
      <Text bold>{to}</Text>
    </Box>
  );
}

function AgentMessage({ from, to, preview }: { from: string; to: string; preview: string }) {
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={3}>
      <Box>
        <Text color={theme.primary}>✉ </Text>
        <Text bold>{from}</Text>
        <Text dimColor> → </Text>
        <Text bold>{to}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>{preview}</Text>
      </Box>
    </Box>
  );
}

function MergeStart() {
  return (
    <Box marginTop={1} paddingLeft={3}>
      <Text color={theme.info}>⤳ merging results...</Text>
    </Box>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <Box paddingLeft={3}>
      <Text color={theme.error}>✗ </Text>
      <Text>{message}</Text>
    </Box>
  );
}

function InterruptedLine({ reason }: { reason: string }) {
  return (
    <Box paddingLeft={3}>
      <Text color={theme.warning}>⚠ </Text>
      <Text color={theme.warning}>stream interrupted: </Text>
      <Text dimColor>{reason}</Text>
      <Text color={theme.warning}> · /retry to resume</Text>
    </Box>
  );
}

function TextBlock({ content }: { content: string }) {
  if (!content) return null;
  // Render markdown -> ANSI; fall back to raw input on parse errors.
  // `renderMarkdown` is internally try/catch wrapped so this is safe mid-stream.
  const rendered = renderMarkdown(content);
  const lines    = rendered.split('\n');
  return (
    <Box flexDirection="column" paddingLeft={3}>
      {lines.map((line, i) => (
        <Box key={`t-${i}`}>
          <Text>{line.length ? line : ' '}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Main bubble ─────────────────────────────────────────────────────────────

export default function MessageBubble({ message, isStreaming }: Props) {
  const isUser     = message.role === 'user';
  const nameColor  = isUser ? theme.secondary : theme.primary;
  const name       = isUser ? 'You' : (message.agentName ?? 'Agent');

  // Coalesce consecutive text items into paragraphs and pair tool_call→tool_done.
  // We render the message items in order, but merge tool_call+tool_done into a single line.
  const doneByCallId = new Map<string, { tool: string; durationMs?: number }>();
  for (const item of message.items) {
    if (item.kind === 'tool_done' && item.toolCallId) {
      doneByCallId.set(item.toolCallId, { tool: item.tool, durationMs: item.durationMs });
    }
  }

  const rendered: React.ReactNode[] = [];
  let textBuf = '';
  let reasoningBuf = '';
  let key = 0;

  const flushText = () => {
    if (textBuf) {
      rendered.push(<TextBlock key={`b-${key++}`} content={textBuf} />);
      textBuf = '';
    }
  };
  const flushReasoning = () => {
    if (reasoningBuf) {
      rendered.push(<ReasoningBlock key={`b-${key++}`} content={reasoningBuf} />);
      reasoningBuf = '';
    }
  };

  for (let i = 0; i < message.items.length; i++) {
    const item = message.items[i]!;
    if (item.kind === 'text') {
      flushReasoning();
      textBuf += item.content;
      // A text item ending in \n is "closed" — flush it as its own block
      // so React only re-renders the trailing (mutable) line during streaming.
      if (item.content.endsWith('\n')) flushText();
      continue;
    }
    if (item.kind === 'reasoning') { flushText(); reasoningBuf += item.content; continue; }
    flushText(); flushReasoning();

    switch (item.kind) {
      case 'tool_call': {
        // If we already saw the matching tool_done, render the completed line; else show pending spinner.
        const done = item.toolCallId ? doneByCallId.get(item.toolCallId) : undefined;
        if (done) {
          rendered.push(
            <InlineToolDone key={`b-${key++}`} tool={item.tool} label={item.label} durationMs={done.durationMs} />,
          );
        } else {
          rendered.push(<InlineToolCall key={`b-${key++}`} tool={item.tool} label={item.label} />);
        }
        break;
      }
      case 'tool_done':
        // Already merged with its matching call.
        if (!item.toolCallId) {
          rendered.push(<InlineToolDone key={`b-${key++}`} tool={item.tool} durationMs={item.durationMs} />);
        }
        break;
      case 'plan':         rendered.push(<Plan key={`b-${key++}`} steps={item.steps} />); break;
      case 'step_start':   rendered.push(<StepHeader key={`b-${key++}`} stepIndex={item.stepIndex} task={item.task} agentName={item.agentName} />); break;
      case 'step_chunk':
        rendered.push(
          <Box key={`b-${key++}`} paddingLeft={5}>
            <Text dimColor>{item.content}</Text>
          </Box>,
        );
        break;
      case 'step_done':    rendered.push(<StepDone key={`b-${key++}`} stepIndex={item.stepIndex} agentName={item.agentName} />); break;
      case 'spawn_chunk':
        rendered.push(
          <Box key={`b-${key++}`} paddingLeft={5}>
            <Text dimColor>{item.agentName}: {item.content}</Text>
          </Box>,
        );
        break;
      case 'spawn_done':   rendered.push(<SpawnDone key={`b-${key++}`} agentName={item.agentName} />); break;
      case 'merge_start':  rendered.push(<MergeStart key={`b-${key++}`} />); break;
      case 'route':        rendered.push(<Route key={`b-${key++}`} from={item.from} to={item.to} />); break;
      case 'agent_message':rendered.push(<AgentMessage key={`b-${key++}`} from={item.from} to={item.to} preview={item.preview} />); break;
      case 'interrupted':  rendered.push(<InterruptedLine key={`b-${key++}`} reason={item.reason} />); break;
      case 'error':        rendered.push(<ErrorLine key={`b-${key++}`} message={item.message} />); break;
    }
  }
  flushText();
  flushReasoning();

  // Show working spinner if the assistant has no content yet.
  const showSpinner = !isUser && isStreaming && rendered.length === 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={nameColor} bold>{name}</Text>
      </Box>
      {rendered}
      {showSpinner && (
        <Box paddingLeft={3}>
          <Spinner color={theme.accent} />
          <Text dimColor>  thinking...</Text>
        </Box>
      )}
    </Box>
  );
}
