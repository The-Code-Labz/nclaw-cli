/**
 * Welcome splash — rendered once into <Static>.
 *
 * Compact single-line format when terminal is narrow (< 60 cols).
 * Full ASCII logo when there's room.
 */
import { Box, Text } from 'ink';
import { theme } from './theme';

interface Props {
  version:   string;
  host:      string;
  agentName: string;
  model?:    string;
}

const LOGO = [
  '  ███╗   ██╗ ██████╗██╗      █████╗ ██╗    ██╗',
  '  ████╗  ██║██╔════╝██║     ██╔══██╗██║    ██║',
  '  ██╔██╗ ██║██║     ██║     ███████║██║ █╗ ██║',
  '  ██║╚██╗██║██║     ██║     ██╔══██║██║███╗██║',
  '  ██║ ╚████║╚██████╗███████╗██║  ██║╚███╔███╔╝',
  '  ╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝',
];

export default function Welcome({ version, host, agentName, model }: Props) {
  const cols    = process.stdout.columns ?? 80;
  const narrow  = cols < 60;
  const divider = '─'.repeat(Math.max(8, cols - 4));

  if (narrow) {
    // Single-line compact header for small terminals
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row">
          <Text color={theme.primary} bold>nclaw </Text>
          <Text color={theme.textMuted}>v{version}  {host}  </Text>
          <Text color={theme.primary}>{agentName}</Text>
        </Box>
        <Text color={theme.textFaint}>{divider}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {LOGO.map((line, i) => (
        <Text key={i} color={i < 3 ? theme.primary : theme.brand}>{line}</Text>
      ))}
      <Box marginTop={1} paddingLeft={2} flexDirection="row">
        <Text color={theme.textMuted}>v{version}</Text>
        <Text color={theme.textMuted}>  ·  </Text>
        <Text color={theme.textMuted}>{host}</Text>
        <Text color={theme.textMuted}>  ·  </Text>
        <Text color={theme.primary}>{agentName}</Text>
        {model && (
          <>
            <Text color={theme.textMuted}>  ·  </Text>
            <Text color={theme.textMuted}>{model}</Text>
          </>
        )}
      </Box>
      <Box paddingLeft={2}>
        <Text color={theme.textMuted}>/help  ·  Ctrl+C abort/exit  ·  /update to upgrade</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color={theme.textFaint}>{divider}</Text>
      </Box>
    </Box>
  );
}
