/**
 * Welcome splash shown on startup — rendered into <Static>.
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
  '  ╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ',
];

export default function Welcome({ version, host, agentName, model }: Props) {
  const cols    = process.stdout.columns ?? 80;
  const divider = '─'.repeat(Math.min(56, cols - 4));

  return (
    <Box flexDirection="column" marginBottom={1}>
      {LOGO.map((line, i) => (
        <Text key={i} color={i < 3 ? theme.primary : theme.brand}>
          {line}
        </Text>
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
      <Box paddingLeft={2} marginTop={0}>
        <Text color={theme.textMuted}>Type </Text>
        <Text color={theme.accent}>/help</Text>
        <Text color={theme.textMuted}> for commands  ·  </Text>
        <Text color={theme.accent}>Ctrl+C</Text>
        <Text color={theme.textMuted}> to abort stream / exit</Text>
      </Box>
      <Box paddingLeft={2} marginTop={0}>
        <Text color={theme.textFaint}>{divider}</Text>
      </Box>
    </Box>
  );
}
