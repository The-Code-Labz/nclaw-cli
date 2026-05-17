#!/usr/bin/env node
import readline from 'readline';
import { render } from 'ink';
import { resolveConfig, writeConfig, configExists, readConfig, NclawConfig } from './config';
import { checkConnection, listAgents } from './remote';
import { setYoloMode } from './permissions';
import App from './ui/App';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, a => resolve(a.trim())));
}

async function runConfig(): Promise<void> {
  const rl       = readline.createInterface({ input: process.stdin, output: process.stdout });
  const existing = configExists() ? readConfig() : null;

  process.stdout.write('\n  nclaw  config\n\n');

  const urlDefault   = existing?.url   ?? 'http://localhost:3141';
  const tokenDefault = existing?.token ?? '';

  const urlRaw   = await ask(rl, `  Server URL [${urlDefault}]: `);
  const tokenRaw = await ask(rl, `  Dashboard token${tokenDefault ? ' [current]' : ''}: `);

  const url   = urlRaw   || urlDefault;
  const token = tokenRaw || tokenDefault;

  if (!token) {
    process.stdout.write('\n  ✗ Token is required.\n\n');
    rl.close(); process.exit(1);
  }

  process.stdout.write('\n  Connecting...\n');
  try {
    await checkConnection(url, token);
  } catch (e) {
    process.stdout.write(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n\n`);
    rl.close(); process.exit(1);
  }

  writeConfig({ url, token, defaultAgent: existing?.defaultAgent ?? null });
  process.stdout.write('  ✓ Connected. Config saved to ~/.nclaw/config.json\n\n');
  rl.close();
}

// ── Bracketed paste mode ────────────────────────────────────────────────────
// Enables ESC[200~ / ESC[201~ wrappers around pasted text so we can detect
// and summarise large pastes in the input bar (Claude Code / opencode behaviour).
const BRACKETED_PASTE_ON  = '\x1b[?2004h';
const BRACKETED_PASTE_OFF = '\x1b[?2004l';

function enableBracketedPaste(): void {
  if (process.stdout.isTTY) process.stdout.write(BRACKETED_PASTE_ON);
}
function disableBracketedPaste(): void {
  if (process.stdout.isTTY) process.stdout.write(BRACKETED_PASTE_OFF);
}

async function main(): Promise<void> {
  if (process.argv[2] === 'config') { await runConfig(); return; }

  // --yolo: skip all tool confirmation prompts for this session.
  const yolo = process.argv.includes('--yolo');
  if (yolo) setYoloMode(true);

  let cfg: NclawConfig;
  try {
    cfg = resolveConfig();
  } catch {
    process.stdout.write('\n  ✗ No config found. Run: nclaw config\n\n');
    process.exit(1);
  }

  try {
    await checkConnection(cfg.url, cfg.token);
  } catch (e) {
    process.stdout.write(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n\n`);
    process.exit(1);
  }

  let agents;
  try {
    agents = await listAgents(cfg.url, cfg.token);
  } catch (e) {
    process.stdout.write(`\n  ✗ Failed to fetch agents: ${e instanceof Error ? e.message : String(e)}\n\n`);
    process.exit(1);
  }

  const active = agents.filter(a => a.status === 'active');
  if (!active.length) {
    process.stdout.write('\n  ✗ No active agents on server.\n\n');
    process.exit(1);
  }

  enableBracketedPaste();
  const cleanup = () => disableBracketedPaste();
  process.on('exit',    cleanup);
  process.on('SIGINT',  () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  // exitOnCtrlC=false: our InputBar handles Ctrl+C as either abort-stream
  // or quit (depending on streaming state).
  render(<App cfg={cfg} agents={agents} />, { exitOnCtrlC: false });
}

main();
