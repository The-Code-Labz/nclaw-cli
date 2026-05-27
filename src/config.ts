import fs from 'fs';
import os from 'os';
import path from 'path';

export interface NclawConfig {
  url:          string;
  token:        string;
  defaultAgent: string | null;
}

const CONFIG_DIR  = path.join(os.homedir(), '.nclaw');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function ensureSecureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    // If mkdir fails, fall through — writeFileSync will likely fail too.
  }
}

function secureWrite(filePath: string, data: string): void {
  ensureSecureDir(path.dirname(filePath));
  try {
    fs.writeFileSync(filePath, data, { mode: 0o600 });
  } catch {
    // Last resort: try without explicit mode (e.g. on Windows).
    fs.writeFileSync(filePath, data);
  }
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export function readConfig(): NclawConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw) as NclawConfig;
}

export function writeConfig(cfg: NclawConfig): void {
  secureWrite(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

/** Returns config, preferring env vars over the file. Throws 'NO_CONFIG' if neither exists. */
export function resolveConfig(): NclawConfig {
  const urlEnv   = process.env.NEUROCLAW_URL?.trim();
  const tokenEnv = process.env.NEUROCLAW_TOKEN?.trim();

  if (urlEnv && tokenEnv) {
    return { url: urlEnv, token: tokenEnv, defaultAgent: null };
  }

  if (!configExists()) throw new Error('NO_CONFIG');

  const cfg = readConfig();
  return {
    url:          urlEnv   ?? cfg.url,
    token:        tokenEnv ?? cfg.token,
    defaultAgent: cfg.defaultAgent,
  };
}
