import fs from 'fs';
import os from 'os';
import path from 'path';

// Persistent allowlist for tool calls. Stored at ~/.nclaw/permissions.json.
//
// Shape:
//   {
//     "bash_run": { "alwaysAllow": false, "patterns": ["git", "ls"] }
//   }
//
// `alwaysAllow` means every payload for that tool is auto-approved.
// `patterns` is a list of pattern heads (e.g. for bash_run we store the
// first whitespace-separated token of the command).

export interface ToolPermission {
  alwaysAllow: boolean;
  patterns:    string[];
}

export type PermissionMap = Record<string, ToolPermission>;

const PERMS_DIR  = path.join(os.homedir(), '.nclaw');
const PERMS_PATH = path.join(PERMS_DIR, 'permissions.json');

let cache: PermissionMap | null = null;
let yolo = false;

function defaults(): PermissionMap {
  return { bash_run: { alwaysAllow: false, patterns: [] } };
}

export function loadPermissions(): PermissionMap {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(PERMS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as PermissionMap;
    // Merge against defaults so unknown tools still get a baseline entry.
    cache = { ...defaults(), ...parsed };
  } catch {
    cache = defaults();
  }
  return cache;
}

export function savePermissions(perms: PermissionMap): void {
  cache = perms;
  try {
    fs.mkdirSync(PERMS_DIR, { recursive: true });
    fs.writeFileSync(PERMS_PATH, JSON.stringify(perms, null, 2), 'utf8');
  } catch {
    // Persist failure is non-fatal — the cache is still updated for the
    // current session, just won't survive a restart.
  }
}

/**
 * Derive the matchable "head" of a tool payload.
 * For bash_run the head is the first whitespace-separated token of the
 * command (e.g. "git status -s" -> "git"). For other tools we just use
 * the full payload (most tools don't allow pattern matching today).
 */
export function payloadHead(tool: string, payload: string): string {
  if (tool === 'bash_run' || tool === 'bash' || tool === 'shell') {
    return payload.trim().split(/\s+/, 1)[0] ?? '';
  }
  return payload;
}

export function isAllowed(tool: string, payload: string): boolean {
  if (yolo) return true;
  const perms = loadPermissions();
  const entry = perms[tool];
  if (!entry) return false;
  if (entry.alwaysAllow) return true;
  const head = payloadHead(tool, payload);
  return entry.patterns.includes(head);
}

export function allowAlways(tool: string, payload: string): void {
  const perms = loadPermissions();
  const entry = perms[tool] ?? { alwaysAllow: false, patterns: [] };
  const head  = payloadHead(tool, payload);
  if (head && !entry.patterns.includes(head)) {
    entry.patterns.push(head);
  }
  perms[tool] = entry;
  savePermissions(perms);
}

export function setYoloMode(on: boolean): void { yolo = on; }
export function isYoloMode(): boolean { return yolo; }
