import { useState, useEffect } from 'react';
import { Text } from 'ink';

// Braille spinner — same as Claude Code / opencode use.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface Props {
  color?: string;
  intervalMs?: number;
}

export function Spinner({ color = 'yellow', intervalMs = 90 }: Props) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return <Text color={color}>{FRAMES[frame]}</Text>;
}
