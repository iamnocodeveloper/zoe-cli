import fs from 'fs';
import path from 'path';

const PROTECTED_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
]);

const PROTECTED_SEGMENTS = new Set(['.git', '.ssh', '.aws', '.config']);

export function getWorkspaceRoot(): string {
  return path.resolve(process.cwd());
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveWorkspacePath(input: string, options: { allowProtected?: boolean } = {}): string {
  if (!input || typeof input !== 'string') {
    throw new Error('A valid workspace path is required.');
  }

  const root = getWorkspaceRoot();
  const candidate = path.resolve(root, input);

  if (!isInside(root, candidate)) {
    throw new Error(`Path is outside the workspace: ${input}`);
  }

  // Resolve existing symlinks before allowing access. A link inside the
  // workspace must not provide an escape hatch to files outside it.
  if (fs.existsSync(candidate)) {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(candidate);
    if (!isInside(realRoot, realCandidate)) {
      throw new Error(`Path resolves outside the workspace: ${input}`);
    }
  }

  if (!options.allowProtected) {
    const relative = path.relative(root, candidate);
    const segments = relative.split(path.sep).filter(Boolean);
    const basename = path.basename(candidate).toLowerCase();
    if (PROTECTED_NAMES.has(basename) || segments.some((segment) => PROTECTED_SEGMENTS.has(segment.toLowerCase()))) {
      throw new Error(`Access to protected path is blocked: ${input}`);
    }
  }

  return candidate;
}

export function resolveWorkspaceDirectory(input?: string): string {
  return resolveWorkspacePath(input || '.', { allowProtected: true });
}

export function assertCommandCwd(input?: string): string {
  const cwd = resolveWorkspaceDirectory(input);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Command directory does not exist: ${input || '.'}`);
  }
  return cwd;
}
