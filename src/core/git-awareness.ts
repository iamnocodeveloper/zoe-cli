import { spawnSync } from 'node:child_process';
import path from 'node:path';

export type GitWorkingTreeState = 'NOT_A_REPOSITORY' | 'CLEAN' | 'DIRTY' | 'CONFLICTED' | 'DETACHED_HEAD' | 'UNAVAILABLE' | 'UNKNOWN';
export type GitInspectionStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
export type GitInspectionFailure =
  | 'GitExecutableNotFound' | 'NotARepository' | 'RepositoryRootUnavailable' | 'HeadUnavailable'
  | 'DetachedHead' | 'StatusUnavailable' | 'StatusParseFailed' | 'UpstreamUnavailable'
  | 'InspectionTimedOut' | 'PermissionDenied' | 'InvalidRepositoryPath'
  | 'UnsupportedGitOutput' | 'UnknownGitFailure';
export type GitFileStatus = 'STAGED' | 'UNSTAGED' | 'UNTRACKED' | 'CONFLICTED' | 'RENAMED' | 'DELETED' | 'ADDED' | 'MODIFIED';

export interface GitChangedPath {
  readonly path: string;
  readonly originalPath: string | null;
  readonly statuses: readonly GitFileStatus[];
}

export interface GitRepositoryContext {
  readonly repositoryDetected: boolean;
  readonly repositoryRoot: string | null;
  readonly workspaceRoot: string;
  readonly workspaceInsideRepository: boolean;
  readonly currentBranch: string | null;
  readonly detachedHead: boolean;
  readonly headCommit: string | null;
  readonly workingTreeState: GitWorkingTreeState;
  readonly stagedFiles: readonly string[];
  readonly unstagedFiles: readonly string[];
  readonly untrackedFiles: readonly string[];
  readonly conflictedFiles: readonly string[];
  readonly changedPaths: readonly GitChangedPath[];
  readonly upstreamConfigured: boolean;
  readonly upstreamName: string | null;
  readonly aheadCount: number | null;
  readonly behindCount: number | null;
  readonly inspectionStatus: GitInspectionStatus;
  readonly inspectionTimestamp: number;
  readonly gitVersion: string | null;
  readonly contextVersion: 1;
  readonly failureReason: GitInspectionFailure | null;
}

export interface GitCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly failureReason?: GitInspectionFailure;
}
export type GitCommandRunner = (args: readonly string[], cwd: string, timeoutMs: number) => GitCommandResult;

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const TIMEOUT_MS = 3000;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
function slash(value: string): string { return value.replace(/\\/g, '/'); }
function normalizeFile(value: string): string { return slash(path.normalize(value)).replace(/^\.\//, ''); }
function debug(message: string): void { if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe git] ${message}`); }

const runGit: GitCommandRunner = (args, cwd, timeoutMs) => {
  const result = spawnSync('git', [...args], {
    cwd, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, shell: false,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
  });
  if (!result.error && result.status === 0) return { ok: true, stdout: result.stdout || '' };
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  const stderr = String(result.stderr || '');
  const failureReason: GitInspectionFailure = code === 'ENOENT' ? 'GitExecutableNotFound'
    : code === 'ETIMEDOUT' || result.signal === 'SIGTERM' ? 'InspectionTimedOut'
    : code === 'EACCES' || code === 'EPERM' ? 'PermissionDenied'
    : /not a git repository/i.test(stderr) ? 'NotARepository'
    : 'UnknownGitFailure';
  return { ok: false, stdout: '', failureReason };
};

function baseContext(workspaceRoot: string, timestamp: number, detail: Partial<GitRepositoryContext>): GitRepositoryContext {
  return deepFreeze({
    repositoryDetected: false, repositoryRoot: null, workspaceRoot, workspaceInsideRepository: false,
    currentBranch: null, detachedHead: false, headCommit: null, workingTreeState: 'UNKNOWN',
    stagedFiles: [], unstagedFiles: [], untrackedFiles: [], conflictedFiles: [], changedPaths: [],
    upstreamConfigured: false, upstreamName: null, aheadCount: null, behindCount: null,
    inspectionStatus: 'FAILED', inspectionTimestamp: timestamp, gitVersion: null, contextVersion: 1,
    failureReason: null, ...detail,
  });
}

function parseStatus(raw: string): {
  staged: string[]; unstaged: string[]; untracked: string[]; conflicted: string[]; changed: GitChangedPath[];
} {
  const records = raw.split('\0'); const staged = new Set<string>(); const unstaged = new Set<string>();
  const untracked = new Set<string>(); const conflicted = new Set<string>(); const changed: GitChangedPath[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]; if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') throw new Error('unsupported porcelain');
    const xy = record.slice(0, 2); const file = normalizeFile(record.slice(3));
    if (!file || file.startsWith('../') || path.isAbsolute(file)) throw new Error('invalid git path');
    const statuses = new Set<GitFileStatus>(); let originalPath: string | null = null;
    if (xy === '??') { untracked.add(file); statuses.add('UNTRACKED'); }
    else {
      if (CONFLICT_CODES.has(xy)) { conflicted.add(file); statuses.add('CONFLICTED'); }
      if (xy[0] !== ' ') { staged.add(file); statuses.add('STAGED'); }
      if (xy[1] !== ' ') { unstaged.add(file); statuses.add('UNSTAGED'); }
      if (xy.includes('R')) {
        statuses.add('RENAMED'); originalPath = normalizeFile(records[++index] || '');
        if (!originalPath || originalPath.startsWith('../') || path.isAbsolute(originalPath)) throw new Error('invalid rename path');
      }
      if (xy.includes('D')) statuses.add('DELETED');
      if (xy.includes('A')) statuses.add('ADDED');
      if (xy.includes('M')) statuses.add('MODIFIED');
    }
    changed.push(deepFreeze({ path: file, originalPath, statuses: [...statuses].sort() }));
  }
  const sorted = (values: Set<string>) => [...values].sort();
  return { staged: sorted(staged), unstaged: sorted(unstaged), untracked: sorted(untracked), conflicted: sorted(conflicted), changed: changed.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
}

export function inspectGitRepository(
  workspacePath: string,
  options: { runner?: GitCommandRunner; now?: () => number; timeoutMs?: number } = {},
): GitRepositoryContext {
  const runner = options.runner || runGit; const now = options.now || Date.now; const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const workspaceRoot = path.resolve(workspacePath); const timestamp = now();
  const command = (args: readonly string[]): GitCommandResult => {
    try { return runner(args, workspaceRoot, timeoutMs); }
    catch { return { ok: false, stdout: '', failureReason: 'UnknownGitFailure' }; }
  };
  debug(`inspection=started workspace=${workspaceRoot}`);
  if (!workspacePath || !path.isAbsolute(workspaceRoot) || timeoutMs <= 0) return baseContext(workspaceRoot, timestamp, { workingTreeState: 'UNKNOWN', failureReason: 'InvalidRepositoryPath' });

  const version = command(['--version']);
  if (!version.ok) return baseContext(workspaceRoot, timestamp, { workingTreeState: 'UNAVAILABLE', failureReason: version.failureReason || 'GitExecutableNotFound' });
  const gitVersion = /^git version\s+(.+)$/i.exec(version.stdout.trim())?.[1] || null;
  if (!gitVersion) return baseContext(workspaceRoot, timestamp, { workingTreeState: 'UNKNOWN', gitVersion: null, failureReason: 'UnsupportedGitOutput' });

  const rootResult = command(['rev-parse', '--show-toplevel']);
  if (!rootResult.ok && rootResult.failureReason === 'NotARepository') {
    debug('repository=not-detected state=NOT_A_REPOSITORY');
    return baseContext(workspaceRoot, timestamp, { workingTreeState: 'NOT_A_REPOSITORY', inspectionStatus: 'SUCCESS', gitVersion, failureReason: 'NotARepository' });
  }
  if (!rootResult.ok) return baseContext(workspaceRoot, timestamp, { workingTreeState: 'UNAVAILABLE', gitVersion, failureReason: rootResult.failureReason || 'RepositoryRootUnavailable' });
  const repositoryRoot = path.resolve(rootResult.stdout.trim());
  if (!rootResult.stdout.trim()) return baseContext(workspaceRoot, timestamp, { workingTreeState: 'UNKNOWN', gitVersion, failureReason: 'RepositoryRootUnavailable' });
  const relativeWorkspace = path.relative(repositoryRoot, workspaceRoot);
  const workspaceInsideRepository = relativeWorkspace === '' || (!relativeWorkspace.startsWith('..') && !path.isAbsolute(relativeWorkspace));
  if (!workspaceInsideRepository) return baseContext(workspaceRoot, timestamp, { workingTreeState: 'UNKNOWN', gitVersion, failureReason: 'InvalidRepositoryPath' });

  const inside = command(['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') return baseContext(workspaceRoot, timestamp, { workingTreeState: 'UNKNOWN', gitVersion, repositoryRoot, failureReason: 'RepositoryRootUnavailable' });
  const head = command(['rev-parse', 'HEAD']);
  const branch = command(['symbolic-ref', '--short', 'HEAD']);
  const detachedHead = !branch.ok && head.ok;
  const status = command(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!status.ok) return baseContext(workspaceRoot, timestamp, { repositoryDetected: true, repositoryRoot, workspaceInsideRepository, gitVersion, workingTreeState: 'UNAVAILABLE', failureReason: status.failureReason || 'StatusUnavailable' });
  let parsed: ReturnType<typeof parseStatus>;
  try { parsed = parseStatus(status.stdout); }
  catch { return baseContext(workspaceRoot, timestamp, { repositoryDetected: true, repositoryRoot, workspaceInsideRepository, gitVersion, workingTreeState: 'UNKNOWN', failureReason: 'StatusParseFailed' }); }

  const upstream = command(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  let aheadCount: number | null = null; let behindCount: number | null = null;
  if (upstream.ok) {
    const counts = command(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
    const match = counts.ok ? /^(\d+)\s+(\d+)$/.exec(counts.stdout.trim()) : null;
    if (match) { aheadCount = Number(match[1]); behindCount = Number(match[2]); }
  }
  const dirty = parsed.changed.length > 0;
  const workingTreeState: GitWorkingTreeState = !head.ok ? 'UNKNOWN' : parsed.conflicted.length ? 'CONFLICTED' : detachedHead ? 'DETACHED_HEAD' : dirty ? 'DIRTY' : 'CLEAN';
  const failureReason: GitInspectionFailure | null = !head.ok ? 'HeadUnavailable' : detachedHead ? 'DetachedHead' : !upstream.ok ? 'UpstreamUnavailable' : null;
  const inspectionStatus: GitInspectionStatus = !head.ok || detachedHead || !upstream.ok ? 'PARTIAL' : 'SUCCESS';
  const context = baseContext(workspaceRoot, timestamp, {
    repositoryDetected: true, repositoryRoot, workspaceInsideRepository, currentBranch: branch.ok ? branch.stdout.trim() || null : null,
    detachedHead, headCommit: head.ok ? head.stdout.trim() || null : null, workingTreeState,
    stagedFiles: parsed.staged, unstagedFiles: parsed.unstaged, untrackedFiles: parsed.untracked,
    conflictedFiles: parsed.conflicted, changedPaths: parsed.changed,
    upstreamConfigured: upstream.ok, upstreamName: upstream.ok ? upstream.stdout.trim() || null : null,
    aheadCount, behindCount, inspectionStatus, gitVersion, failureReason,
  });
  debug(`repository=detected state=${context.workingTreeState} branch=${context.currentBranch ? 'available' : 'unavailable'} detached=${context.detachedHead} head=${context.headCommit ? 'available' : 'unavailable'} staged=${context.stagedFiles.length} unstaged=${context.unstagedFiles.length} untracked=${context.untrackedFiles.length} conflicted=${context.conflictedFiles.length} upstream=${context.upstreamConfigured ? 'available' : 'unavailable'}`);
  return context;
}
