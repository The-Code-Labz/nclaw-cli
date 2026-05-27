/**
 * Toast — lightweight non-intrusive notification overlay.
 * Auto-dismisses after `duration` ms. Non-blocking: never steals input focus.
 * Trigger via showToast() callback passed through CommandContext.
 */
import { useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme';

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastData {
  id:       number;
  message:  string;
  variant:  ToastVariant;
  duration: number;
}

interface ItemProps {
  toast:     ToastData;
  onDismiss: (id: number) => void;
}

function variantColor(v: ToastVariant): string {
  if (v === 'success') return theme.success;
  if (v === 'error')   return theme.error;
  return theme.info;
}

function variantIcon(v: ToastVariant): string {
  if (v === 'success') return '✓';
  if (v === 'error')   return '✗';
  return 'ℹ';
}

function ToastItem({ toast, onDismiss }: ItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const color = variantColor(toast.variant);
  return (
    <Box borderStyle="round" borderColor={color} paddingX={1}>
      <Text color={color}>{variantIcon(toast.variant)} </Text>
      <Text color={theme.text}>{toast.message}</Text>
    </Box>
  );
}

interface Props {
  toasts:    ToastData[];
  onDismiss: (id: number) => void;
}

export default function Toast({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <Box flexDirection="column" alignItems="flex-end" marginRight={1}>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </Box>
  );
}
