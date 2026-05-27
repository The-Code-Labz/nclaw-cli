/**
 * Persistent input history — saved to ~/.nclaw/history.json
 * Survives restarts, deduplicated, capped at MAX_ENTRIES.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const MAX_ENTRIES = 500;
const HISTORY_DIR  = path.join(os.homedir(), '.nclaw');
const HISTORY_PATH = path.join(HISTORY_DIR, 'history.json');

let cache: string[] | null = null;

function ensureSecureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch { /* ignore */ }
}

function secureWrite(filePath: string, data: string): void {
  ensureSecureDir(path.dirname(filePath));
  try {
    fs.writeFileSync(filePath, data, { mode: 0o600 });
  } catch {
    fs.writeFileSync(filePath, data);
  }
}

export function loadHistory(): string[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    cache = (JSON.parse(raw) as string[]).slice(0, MAX_ENTRIES);
  } catch {
    cache = [];
  }
  return cache;
}

export function saveHistory(entries: string[]): void {
  cache = entries.slice(0, MAX_ENTRIES);
  try {
    secureWrite(HISTORY_PATH, JSON.stringify(cache, null, 0));
  } catch { /* non-fatal */ }
}

/**
 * Push a new entry to the top of history (deduplicated).
 * Returns the updated history array.
 */
export function pushHistory(entries: string[], newEntry: string): string[] {
  const filtered = entries.filter(e => e !== newEntry);
  const next     = [newEntry, ...filtered].slice(0, MAX_ENTRIES);
  saveHistory(next);
  return next;
}
