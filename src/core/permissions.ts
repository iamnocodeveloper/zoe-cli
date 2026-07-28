import fs from 'fs';
import { resolveWorkspacePath } from './workspace.js';
import { terminalInput, type TerminalInputCoordinator } from '../ui/terminal-input.js';

export type PermissionLevel = 'read' | 'write' | 'shell' | 'destructive';
export type PermissionDecision = 'approve' | 'deny' | 'always' | 'invalid';

const approvedForSession = new Set<PermissionLevel>();

export function parsePermissionDecision(input: string): PermissionDecision {
  const normalized = input.trim().toLowerCase();
  if (normalized === 'y' || normalized === 'yes') return 'approve';
  if (normalized === 'n' || normalized === 'no') return 'deny';
  if (normalized === 'a' || normalized === 'always') return 'always';
  return 'invalid';
}

function commandLevel(command: string): PermissionLevel {
  const value = command.trim().toLowerCase();
  if (/\b(rm|rmdir|del|erase|format|git\s+(reset|clean|push|checkout)|drop\s+database|docker\s+system\s+prune)\b/.test(value)) return 'destructive';
  return 'shell';
}

export function getPermissionLevel(toolName: string, params: Record<string, unknown>): PermissionLevel {
  if (toolName === 'read_file' || toolName === 'list_directory' || toolName === 'glob_files' ||
      toolName === 'grep_files' || toolName === 'get_project_context') return 'read';
  if (toolName === 'run_command') return commandLevel(String(params.command || ''));
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'create_directory') return 'write';
  return 'shell';
}

export async function requestPermissionDecision(
  input: TerminalInputCoordinator,
  prompt: string,
  onInvalid: (message: string) => void = console.log,
): Promise<Exclude<PermissionDecision, 'invalid'>> {
  while (true) {
    const decision = parsePermissionDecision(await input.readLine('permission', prompt));
    if (decision !== 'invalid') return decision;
    onInvalid('Invalid choice. Enter y, n, or a.');
  }
}

export async function requestPermission(toolName: string, params: Record<string, unknown>, input: TerminalInputCoordinator = terminalInput): Promise<boolean> {
  const level = getPermissionLevel(toolName, params);
  if (level === 'read' || approvedForSession.has(level)) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

  const target = toolName === 'run_command' ? String(params.command || '') : String(params.path || '');
  const label = level === 'destructive' ? 'DESTRUCTIVE ACTION' : level.toUpperCase();
  let preview = '';
  if (toolName === 'write_file' && params.path) {
    const filePath = resolveWorkspacePath(String(params.path));
    preview = fs.existsSync(filePath)
      ? `\n  Existing file will be overwritten (${fs.statSync(filePath).size} bytes).`
      : `\n  New file (${Buffer.byteLength(String(params.content || ''), 'utf8')} bytes).`;
  } else if (toolName === 'edit_file' && params.path) {
    const filePath = resolveWorkspacePath(String(params.path));
    preview = `\n  Edit preview: -${String(params.old_text || '').split('\n').length} line(s), +${String(params.new_text || '').split('\n').length} line(s).`;
    if (!fs.existsSync(filePath)) preview += ' File does not exist.';
  } else if (toolName === 'create_directory') {
    preview = '\n  A new directory will be created.';
  }

  const decision = await requestPermissionDecision(input, `\nZoe requests ${label} permission for ${toolName}: ${target}${preview}\nAllow? [y]es / [n]o / [a]lways: `);
  if (decision === 'always') approvedForSession.add(level);
  return decision === 'approve' || decision === 'always';
}
