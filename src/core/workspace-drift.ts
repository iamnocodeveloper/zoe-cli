import { CHECKPOINT_SCHEMA_VERSION, createGitCheckpointSnapshot, createWorkspaceFingerprint, workspaceFingerprintsMatch, type GitCheckpointSnapshot, type TaskCheckpoint, type WorkspaceFingerprint } from './task-checkpoint.js';
import type { WorkspaceContext } from './workspace-intelligence.js';

export type WorkspaceDriftStatus = 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';
export type WorkspaceDriftReason = 'WorkspaceRootChanged' | 'WorkspaceVersionChanged' | 'FingerprintMismatch' | 'ProjectStructureChanged' | 'PackageManifestChanged' | 'LockfileChanged' | 'FileRemoved' | 'FileAdded' | 'CriticalFileModified' | 'SchemaMismatch' | 'UnknownWorkspace' | 'GitRepositoryChanged' | 'GitRepositoryRootChanged' | 'GitHeadChanged' | 'GitBranchChanged' | 'GitDetachedHeadChanged' | 'GitWorkingTreeChanged' | 'GitConflictDetected' | 'GitContextUnavailable';
export interface WorkspaceRename { readonly from: string; readonly to: string; }
export interface WorkspaceDriftResult {
  readonly status: WorkspaceDriftStatus; readonly resumePossible: boolean; readonly reasons: readonly WorkspaceDriftReason[];
  readonly addedFiles: readonly string[]; readonly removedFiles: readonly string[]; readonly modifiedFiles: readonly string[];
  readonly renamedFiles: readonly WorkspaceRename[]; readonly criticalFiles: readonly string[]; readonly fingerprintMatches: boolean | null;
  readonly gitCompatible: boolean | null;
}

const PACKAGE_MANIFESTS = new Set(['package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'composer.json', 'requirements.txt']);
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'cargo.lock', 'go.sum', 'composer.lock', 'poetry.lock']);
const CRITICAL = new Set([...PACKAGE_MANIFESTS, ...LOCKFILES, 'tsconfig.json']);

function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; }
function result(status: WorkspaceDriftStatus, reasons: WorkspaceDriftReason[], detail: Partial<WorkspaceDriftResult> = {}): WorkspaceDriftResult {
  return freeze({ status, resumePossible: status === 'COMPATIBLE', reasons: [...new Set(reasons)], addedFiles: detail.addedFiles || [], removedFiles: detail.removedFiles || [], modifiedFiles: detail.modifiedFiles || [], renamedFiles: detail.renamedFiles || [], criticalFiles: detail.criticalFiles || [], fingerprintMatches: detail.fingerprintMatches ?? null, gitCompatible: detail.gitCompatible ?? null });
}
function debug(value: WorkspaceDriftResult): void { if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe workspace drift] comparison=complete fingerprint=${value.fingerprintMatches === null ? 'unknown' : value.fingerprintMatches ? 'match' : 'changed'} git=${value.gitCompatible === null ? 'unknown' : value.gitCompatible ? 'compatible' : 'changed'} critical=${value.criticalFiles.length ? 'changed' : 'unchanged'} result=${value.status} reason=${value.reasons.join(',') || 'none'}`); }
function fileMap(fingerprint: WorkspaceFingerprint): Map<string, { hash: string; size: number }> { return new Map(fingerprint.files.map((file) => [file.path, { hash: file.hash, size: file.size }])); }
function sameFile(left: { hash: string; size: number }, right: { hash: string; size: number }): boolean { return left.hash === right.hash && left.size === right.size; }
function gitComparison(before: GitCheckpointSnapshot, current: GitCheckpointSnapshot): { unknown: boolean; reasons: WorkspaceDriftReason[] } {
  if (current.workingTreeState === 'UNAVAILABLE' || current.workingTreeState === 'UNKNOWN') return { unknown: true, reasons: ['GitContextUnavailable'] };
  const reasons: WorkspaceDriftReason[] = [];
  if (before.repositoryDetected !== current.repositoryDetected) reasons.push('GitRepositoryChanged');
  if (before.workspaceInsideRepository !== current.workspaceInsideRepository || before.workspaceRelativePath !== current.workspaceRelativePath) reasons.push('GitRepositoryRootChanged');
  if (before.repositoryDetected && current.repositoryDetected) {
    if (before.headCommit !== current.headCommit) reasons.push('GitHeadChanged');
    if (before.branch !== current.branch) reasons.push('GitBranchChanged');
    if (before.detachedHead !== current.detachedHead) reasons.push('GitDetachedHeadChanged');
    if (current.workingTreeState === 'CONFLICTED' || current.conflictedCount > 0) reasons.push('GitConflictDetected');
    if (before.workingTreeState !== current.workingTreeState
      || before.stagedCount !== current.stagedCount || before.unstagedCount !== current.unstagedCount
      || before.untrackedCount !== current.untrackedCount || before.conflictedCount !== current.conflictedCount
      || JSON.stringify(before.changedPaths) !== JSON.stringify(current.changedPaths)) reasons.push('GitWorkingTreeChanged');
  }
  return { unknown: false, reasons };
}

export function analyzeWorkspaceDrift(checkpoint: Readonly<TaskCheckpoint>, workspace: Readonly<WorkspaceContext>): WorkspaceDriftResult {
  try {
    if (!checkpoint || !workspace || !workspace.workspaceRoot || !Array.isArray(workspace.files) || !checkpoint.workspaceFingerprint?.files) {
      const unknown = result('UNKNOWN', ['UnknownWorkspace']); debug(unknown); return unknown;
    }
    if (checkpoint.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION) { const incompatible = result('INCOMPATIBLE', ['SchemaMismatch']); debug(incompatible); return incompatible; }
    if (checkpoint.workspaceId !== workspace.workspaceRoot || checkpoint.workspaceFingerprint.workspaceRoot !== workspace.workspaceRoot) { const incompatible = result('INCOMPATIBLE', ['WorkspaceRootChanged']); debug(incompatible); return incompatible; }
    if (checkpoint.workspaceVersion !== workspace.contextVersion || checkpoint.workspaceFingerprint.contextVersion !== workspace.contextVersion) { const incompatible = result('INCOMPATIBLE', ['WorkspaceVersionChanged']); debug(incompatible); return incompatible; }

    const currentFingerprint = createWorkspaceFingerprint(workspace); const fingerprintMatches = workspaceFingerprintsMatch(checkpoint.workspaceFingerprint, currentFingerprint);
    const git = gitComparison(checkpoint.gitSnapshot, createGitCheckpointSnapshot(workspace));
    if (git.unknown) { const unknown = result('UNKNOWN', git.reasons, { fingerprintMatches, gitCompatible: null }); debug(unknown); return unknown; }
    if (fingerprintMatches && git.reasons.length === 0) { const compatible = result('COMPATIBLE', [], { fingerprintMatches: true, gitCompatible: true }); debug(compatible); return compatible; }
    if (fingerprintMatches) { const incompatible = result('INCOMPATIBLE', git.reasons, { fingerprintMatches: true, gitCompatible: false }); debug(incompatible); return incompatible; }

    const before = fileMap(checkpoint.workspaceFingerprint); const current = fileMap(currentFingerprint);
    let removed = [...before.keys()].filter((file) => !current.has(file)); let added = [...current.keys()].filter((file) => !before.has(file));
    const renamed: WorkspaceRename[] = [];
    for (const oldPath of [...removed]) {
      const oldFile = before.get(oldPath)!; const candidate = added.find((newPath) => sameFile(oldFile, current.get(newPath)!));
      if (candidate) { renamed.push({ from: oldPath, to: candidate }); removed = removed.filter((file) => file !== oldPath); added = added.filter((file) => file !== candidate); }
    }
    const modified = [...before.keys()].filter((file) => current.has(file) && !sameFile(before.get(file)!, current.get(file)!));
    const criticalFiles = [...new Set([...modified, ...removed, ...added, ...renamed.flatMap((item) => [item.from, item.to])].filter((file) => CRITICAL.has(file.toLowerCase())))].sort();
    const reasons: WorkspaceDriftReason[] = ['FingerprintMismatch', ...git.reasons];
    if (added.length || removed.length || renamed.length) reasons.push('ProjectStructureChanged');
    if (added.length) reasons.push('FileAdded'); if (removed.length) reasons.push('FileRemoved');
    if (criticalFiles.some((file) => PACKAGE_MANIFESTS.has(file.toLowerCase()))) reasons.push('PackageManifestChanged');
    if (criticalFiles.some((file) => LOCKFILES.has(file.toLowerCase()))) reasons.push('LockfileChanged');
    if (criticalFiles.length) reasons.push('CriticalFileModified');
    const incompatible = result('INCOMPATIBLE', reasons, { addedFiles: added.sort(), removedFiles: removed.sort(), modifiedFiles: modified.sort(), renamedFiles: renamed.sort((a, b) => a.from.localeCompare(b.from)), criticalFiles, fingerprintMatches: false, gitCompatible: git.reasons.length === 0 });
    debug(incompatible); return incompatible;
  } catch {
    const unknown = result('UNKNOWN', ['UnknownWorkspace']); debug(unknown); return unknown;
  }
}
