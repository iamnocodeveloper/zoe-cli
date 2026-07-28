import fs from 'fs';
import path from 'path';
import { resolveWorkspacePath } from './workspace.js';

function backupRoot(): string {
  return path.join(process.cwd(), '.zoe', 'backups');
}

export function backupFile(input: string): string | null {
  const source = resolveWorkspacePath(input);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return null;

  const relative = path.relative(process.cwd(), source);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupRoot(), timestamp, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

export function restoreLatestBackup(input: string): string {
  const source = resolveWorkspacePath(input);
  const relative = path.relative(process.cwd(), source);
  if (!fs.existsSync(backupRoot())) throw new Error('No backups exist for this project.');

  const candidates = fs.readdirSync(backupRoot())
    .sort()
    .reverse()
    .map((dir) => path.join(backupRoot(), dir, relative))
    .filter((candidate) => fs.existsSync(candidate));

  if (candidates.length === 0) throw new Error(`No backup found for ${input}.`);
  fs.copyFileSync(candidates[0], source);
  return candidates[0];
}
