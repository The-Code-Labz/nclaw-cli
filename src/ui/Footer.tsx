import { Box, Text } from 'ink';
import { useThemeContext } from './ThemeProvider';

interface Props {
  cwd:         string;
  agentName:   string;
  host:        string;
  streaming:   boolean;
  toolCount:   number;
  tokensIn?:   number;
  tokensOut?:  number;
  costUsd?:    number;
  model?:      string;
  branch?:     string;
  dirty?:      boolean;
  yolo?:       boolean;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  return usd >= 0.1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
}

export default function Footer({
  cwd, agentName, host, streaming, toolCount,
  tokensIn, tokensOut, costUsd, model, branch, dirty, yolo,
}: Props) {
  const { colors } = useThemeContext();
  const home = process.env.HOME ?? '';
  const display = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
  const short = display.length > 40 ? '…' + display.slice(-39) : display;

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
      <Box>
        <Text color={colors.textMuted}>{short}</Text>
        {branch && (
          <>
            <Text color={colors.textMuted}>  ⎇ </Text>
            <Text color={dirty ? colors.warning : colors.textMuted}>
              {branch}{dirty ? '*' : ''}
            </Text>
          </>
        )}
      </Box>
      <Box>
        {model && (
          <>
            <Text color={colors.textMuted}>{model}</Text>
            <Text color={colors.textMuted}>  ·  </Text>
          </>
        )}
        {(tokensIn != null || tokensOut != null) && (
          <>
            {tokensIn  != null && <Text color={colors.textMuted}>{fmtTokens(tokensIn)}↑ </Text>}
            {tokensOut != null && <Text color={colors.textMuted}>{fmtTokens(tokensOut)}↓</Text>}
            <Text color={colors.textMuted}>  ·  </Text>
          </>
        )}
        {costUsd != null && (
          <>
            <Text color={colors.textMuted}>{fmtCost(costUsd)}</Text>
            <Text color={colors.textMuted}>  ·  </Text>
          </>
        )}
        <Text color={streaming ? colors.warning : colors.success}>● </Text>
        <Text color={colors.text}>{agentName}</Text>
        <Text color={colors.textMuted}>  ·  </Text>
        <Text color={colors.textMuted}>{host}</Text>
        {toolCount > 0 && (
          <>
            <Text color={colors.textMuted}>  ·  </Text>
            <Text color={colors.textMuted}>{toolCount} tool{toolCount === 1 ? '' : 's'}</Text>
          </>
        )}
        {yolo && (
          <>
            <Text color={colors.textMuted}>  ·  </Text>
            <Text color={colors.error} bold>🔥 YOLO</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
