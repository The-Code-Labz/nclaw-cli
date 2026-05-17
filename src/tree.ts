import fs from 'fs';
import path from 'path';

const IGNORE_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage', '.nyc_output',
]);
const IGNORE_EXTS = new Set([
  '.db', '.sqlite', '.sqlite3', '.db-shm', '.db-wal', '.log',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg',
  '.zip', '.tar', '.gz', '.bz2',
  '.bin', '.exe', '.dll', '.so',
]);

export function scanTree(dir: string, maxDepth = 4): string {
  const lines: string[] = [
    // ── Critical context the agent MUST understand ──────────────────────────
    `CLIENT WORKING DIRECTORY: ${dir}`,
    ``,
    `IMPORTANT — YOU ARE CONNECTED VIA THE NCLAW CLI TOOL:`,
    `- The user is running nclaw on their own machine in the directory above.`,
    `- ALL file operations (fs_read, fs_write, fs_list, fs_search) execute ON THE USER'S MACHINE in "${dir}".`,
    `- ALL bash_run commands execute ON THE USER'S MACHINE in "${dir}".`,
    `- When you create files, they are created at "${dir}/<filename>" on the user's machine.`,
    `- NEVER prefix commands with "cd ${dir} &&" — the cwd is already set to that directory.`,
    `- NEVER use absolute paths like /home/neuroclaw-v1/... — use relative paths like ./filename or just filename.`,
    `- The NeuroClaw server is separate from the user's machine. Do not confuse them.`,
    ``,
    `WORKFLOW: For any implementation task follow this order — (1) Plan; (2) Execute: write all code/files completely; (3) Test: run the dev server or test command; (4) Debug: fix errors in the same response; (5) Ship: only declare done once verified.`,
    `HANDOFF: End every completed task with: WHAT WAS BUILT · FILES (each file + role) · HOW TO RUN · WALKTHROUGH · HONEST NOTES`,
  ];

  // Inject AGENT.md if present
  const agentMdPath = path.join(dir, 'AGENT.md');
  try {
    const agentMd = fs.readFileSync(agentMdPath, 'utf8').trim();
    if (agentMd) {
      lines.push('', '=== AGENT.md (project context) ===', agentMd, '=== end AGENT.md ===');
    }
  } catch { /* not present */ }

  lines.push('', `File tree of ${dir}:`);

  function walk(current: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { return; }

    const visible = entries.filter((e) => {
      if (IGNORE_NAMES.has(e.name)) return false;
      if (e.name.startsWith('.') && e.name !== '.env.example') return false;
      if (e.isFile() && IGNORE_EXTS.has(path.extname(e.name).toLowerCase())) return false;
      return true;
    });
    visible.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    visible.forEach((entry, idx) => {
      const isLast      = idx === visible.length - 1;
      const connector   = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      if (entry.isDirectory()) walk(path.join(current, entry.name), childPrefix, depth + 1);
    });
  }

  walk(dir, '', 1);
  return lines.join('\n');
}

export const AGENT_MD_TEMPLATE = `# AGENT.md

This file is read by nclaw AI agents on every turn. Fill in the sections below so the agent understands your project.

## Project Overview

<!-- What does this project do? 1-3 sentences. -->

## Tech Stack

<!-- Languages, frameworks, key libraries -->

## Commands

\`\`\`bash
# Key commands for this project:
# npm run dev     # Start development server
# npm run build   # Build for production
# npm test        # Run tests
\`\`\`

## Architecture

<!-- How is the project structured? Key design decisions? -->

## Key Files

<!-- Most important files and what they do -->

## Agent Instructions

<!-- Any special constraints or instructions for the AI working in this project -->
- Always run and verify your code before reporting done
- Use relative paths for all file operations
- After every completed task, end with a full walkthrough
`;
