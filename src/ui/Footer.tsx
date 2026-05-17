/**
 * Footer status bar — always shown at the bottom.
 */
import { Box, Text } from 'ink';
import { theme } from './theme';

interface Props {
  cwd:        string;
  agentName:  string;
  host:       string;
  streaming:  boolean;
  toolCount:  number;
  sessionId?: string;
  tokensIn?:  number;
  tokensOut?: number;
  costUsd?:   number;
  model?:     string;
  branch?:    string;
  dirty?:     boolean;
  yolo?:      boolean;
  stalled?:   boolean;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd >= 1)    return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function Sep() {
  return <Text color={theme.textFaint}>  ·  </Text>;
}

export default function Footer({
  cwd, agentName, host, streaming, toolCount, sessionId,
  tokensIn, tokensOut, costUsd, model, branch, dirty, yolo, stalled,
}: Props) {
  const home    = process.env.HOME ?? '';
  const display = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
  const short   = display.length > 38 ? '…' + display.slice(-37) : display;

  // Status indicator
  let statusColor: string = theme.success;
  let statusChar  = '●';
  if (stalled)   { statusColor = theme.warning; statusChar = '◌'; }
  if (streaming) { statusColor = theme.accent;  statusChar = '◉'; }

  // Session ID (last 8 chars)
  const shortSid = sessionId ? sessionId.slice(-8) : null;

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1} marginTop={0}>
      {/* Left: cwd + git */}
      <Box>
        <Text color={theme.textMuted}>{short}</Text>
        {branch && (
          <>
            <Text color={theme.textFaint}>  ⎇ </Text>
            <Text color={dirty ? theme.warning : theme.textMuted}>
              {branch}{dirty ? '*' : ''}
            </Text>
          </>
        )}
      </Box>

      {/* Right */}
      <Box>
        {yolo && (
          <>
            <Text color={theme.error} bold>🔥 YOLO</Text>
            <Sep />
          </>
        )}
        {stalled && (
          <>
            <Text color={theme.warning}>stalled</Text>
            <Sep />
          </>
        )}
        {model && (
          <>
            <Text color={theme.textMuted}>{model}</Text>
            <Sep />
          </>
        )}
        {(tokensIn != null || tokensOut != null) && (
          <>
            {tokensIn  != null && <Text color={theme.textMuted}>{fmtTokens(tokensIn)}↑</Text>}
            <Text color={theme.textFaint}> </Text>
            {tokensOut != null && <Text color={theme.textMuted}>{fmtTokens(tokensOut)}↓</Text>}
            <Sep />
          </>
        )}
        {costUsd != null && (
          <>
            <Text color={theme.textMuted}>{fmtCost(costUsd)}</Text>
            <Sep />
          </>
        )}
        {toolCount > 0 && (
          <>
            <Text color={theme.textMuted}>{toolCount}⚙</Text>
            <Sep />
          </>
        )}
        {shortSid && (
          <>
            <Text color={theme.textFaint}>{shortSid}</Text>
            <Sep />
          </>
        )}
        <Text color={statusColor}>{statusChar} </Text>
        <Text color={theme.text} bold>{agentName}</Text>
        <Text color={theme.textFaint}>@</Text>
        <Text color={theme.textMuted}>{host}</Text>
      </Box>
    </Box>
  );
}
