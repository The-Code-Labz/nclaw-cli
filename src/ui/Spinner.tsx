import { useState, useEffect } from 'react';
import { Text } from 'ink';

// Braille dot spinner — same as Claude Code / opencode.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface Props {
  color?:      string;
  intervalMs?: number;
  // Allows rendering a static frame for tests / screenshot.
  staticFrame?: number;
}

export function Spinner({ color = '#FBBF24', intervalMs = 80, staticFrame }: Props) {
  const [frame, setFrame] = useState(staticFrame ?? 0);

  useEffect(() => {
    if (staticFrame != null) return;
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, staticFrame]);

  return <Text color={color}>{FRAMES[frame]}</Text>;
}
