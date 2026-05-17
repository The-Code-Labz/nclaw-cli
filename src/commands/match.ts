import fuzzysort from 'fuzzysort';
import { commands } from './registry';
import type { Command } from './types';

/**
 * Return commands matching the given partial input (e.g. "/he").
 * Empty / single "/" returns all commands in registry order.
 * Otherwise we fuzzy-match against both `slash` and `name` fields.
 */
export function matchCommands(input: string, limit = 8): Command[] {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed === '/') return commands.slice(0, limit);

  const needle = trimmed.replace(/^\//, '');
  const scored = fuzzysort.go(needle, commands, {
    keys: ['name', 'slash'],
    limit,
    threshold: -10000,
  });
  // If nothing scored, fall back to startsWith on the raw needle so a single
  // unusual character still surfaces something useful.
  if (!scored.length) {
    return commands.filter(c => c.slash.startsWith('/' + needle)).slice(0, limit);
  }
  return scored.map(r => r.obj);
}
