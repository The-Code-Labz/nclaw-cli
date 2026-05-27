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
    `Working directory: ${dir}`,
    `IMPORTANT: bash_run commands execute with cwd already set to this directory. Run commands directly — never prefix with \`cd ${dir} &&\` or \`cd /path &&\`.`,
    `IMPORTANT: When executing a multi-step task, complete the full task in a single response. Do NOT stop mid-task to ask "shall I continue?". Use tools iteratively until done. Only stop if blocked by missing information you cannot discover yourself.`,
    `WORKFLOW: For any implementation task follow this order — (1) Plan: state what you'll build and how; (2) Execute: write all code and files completely; (3) Test: run the dev server or test command and capture real output; (4) Debug: if there are errors, fix them in the same response before moving on; (5) Ship: only declare done once you've verified it runs.`,
    `HANDOFF: After every completed task, end your response with a structured walkthrough the user can follow. Use this exact format:\n  WHAT WAS BUILT — 1-2 sentence description of what you built and the problem it solves\n  FILES — list every file created or modified with a one-line description of its role\n  HOW TO RUN — the exact command(s) to start or use it\n  WALKTHROUGH — describe what the user will actually see and interact with, screen by screen or feature by feature\n  HONEST NOTES — anything that isn't perfect yet, known limitations, or what you'd tackle next\nThis walkthrough is mandatory. Never skip it. The user needs to understand what was built without reading the code.`,
  ];

  // Inject AGENT.md if the project has one
  const agentMdPath = path.join(dir, 'AGENT.md');
  try {
    const agentMd = fs.readFileSync(agentMdPath, 'utf8').trim();
    if (agentMd) {
      lines.push('', '=== AGENT.md (project context) ===', agentMd, '=== end AGENT.md ===');
    }
  } catch { /* not present, skip */ }

  lines.push('', 'File tree:');

  function walk(current: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
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
- If the dev server or tests show errors, fix them in the same response before finishing
- After every completed task, end with a full walkthrough:
    WHAT WAS BUILT — what you built and the problem it solves
    FILES — every file created/modified and its role
    HOW TO RUN — exact command(s) to start or use it
    WALKTHROUGH — what the user will see and interact with
    HONEST NOTES — limitations, known issues, what to tackle next
`;

