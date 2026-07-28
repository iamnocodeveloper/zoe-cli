import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { resolveWorkspacePath } from '../src/core/workspace.js';
import { executeTool, tools } from '../src/core/tools.js';
import { createExecutionRuntime, detectPackageManager, type ExecutionPlan } from '../src/core/execution-runtime.js';
import { createProjectSnapshot, executionPlanSchema, parseExecutionPlan, validateExecutionPlan, validateRuntimeConstraints } from '../src/core/execution-plan.js';
import { extractUserIntent } from '../src/core/user-intent.js';
import { ZOE_STRUCTURED_PLAN_PROMPT } from '../src/core/prompt.js';
import { RuntimeController } from '../src/core/runtime-controller.js';
import { parsePermissionDecision, requestPermissionDecision } from '../src/core/permissions.js';
import { classifyTask } from '../src/core/task-mode.js';
import { createAuthenticatedRequestHelper, createAuthSessionStore, getAuthSessionStatus, getAuthErrorMessage, isZoeAuthError, logoutWithServices, type AuthSessionStore } from '../src/core/insforge.js';
import { createBuilderToolPolicy, enforceBuilderToolPolicy, enforceRequestedChanges, hasBlockingReview, verifySemanticRequestedChanges } from '../src/core/agent.js';
import { buildPastedPrompt, createInputLineQueue } from '../src/cli/commands/chat.js';
import { createTaskOrchestrator } from '../src/core/task-orchestrator.js';
import { WorkspaceIntelligence } from '../src/core/workspace-intelligence.js';
import { classifyDirectCommand } from '../src/core/command-permission-policy.js';
import { createTaskPreview } from '../src/core/task-preview.js';
import { pauseForHighComplexity, renderTaskPreview } from '../src/cli/task-preview-renderer.js';
import type { TaskContext } from '../src/core/task-orchestrator.js';
import { activateTaskCancellation, clearTaskCancellation, createTaskCancellationToken, getActiveTaskCancellation, handleCancellationInterrupt, TaskCancelledError, type TaskCancellationToken } from '../src/core/task-cancellation.js';
import { renderTaskOutcome } from '../src/cli/task-result-renderer.js';
import { CHECKPOINT_SCHEMA_VERSION, createTaskCheckpoint, evaluateResumeEligibility, invalidateCheckpoint, transitionCheckpoint, workspaceFingerprintsMatch } from '../src/core/task-checkpoint.js';
import type { WorkspaceContext } from '../src/core/workspace-intelligence.js';
import { CheckpointPersistenceError, CheckpointStorage } from '../src/core/checkpoint-storage.js';
import { CheckpointLifecycleCapture } from '../src/core/checkpoint-lifecycle.js';
import type { TaskCheckpoint } from '../src/core/task-checkpoint.js';
import { analyzeWorkspaceDrift } from '../src/core/workspace-drift.js';
import { createSafeResumeCoordinator } from '../src/core/safe-resume.js';
import { inspectGitRepository, type GitCommandResult, type GitCommandRunner, type GitRepositoryContext } from '../src/core/git-awareness.js';
import { EmptyModelResponseError, StreamingResponseController } from '../src/ui/streaming-response.js';
import { getProjectDescription } from '../src/core/context.js';
import { getZoePackageMetadata } from '../src/core/package-metadata.js';
import { inspectToolProtocolMessage } from '../src/core/tool-protocol.js';
import { createModelAuthGate, runAuthenticatedModelRequest } from '../src/core/model-auth-flow.js';
import { ExclusiveLineInput, TerminalInputCoordinator, TerminalInputOwnershipError } from '../src/ui/terminal-input.js';

const singleLinePrompt = buildPastedPrompt(['Explain src/App.tsx.']);
assert.equal(singleLinePrompt, 'Explain src/App.tsx.');
const pastedAcceptancePrompt = buildPastedPrompt([
  'Change only the main headline in src/App.tsx to:',
  '',
  'Build with confidence.',
  '',
  'Do not modify any other file.',
  'Run npm run build.',
]);
assert.equal(pastedAcceptancePrompt, 'Change only the main headline in src/App.tsx to:\n\nBuild with confidence.\n\nDo not modify any other file.\nRun npm run build.');
assert.equal(buildPastedPrompt(['first', '', 'second']).split('\n')[2], 'second');
const inputQueue = createInputLineQueue();
for (const line of ['/paste', 'first', '', 'second', '.done', 'exit']) inputQueue.push(line);
assert.deepEqual([await inputQueue.read(), await inputQueue.read(), await inputQueue.read(), await inputQueue.read(), await inputQueue.read(), await inputQueue.read()], ['/paste', 'first', '', 'second', '.done', 'exit']);
const pastedIntent = extractUserIntent(pastedAcceptancePrompt, process.cwd());
assert.equal(pastedIntent.originalUserPrompt.raw, pastedAcceptancePrompt);
assert.equal(pastedIntent.requestedChanges[0].exactValue, 'Build with confidence.');
assert.deepEqual(pastedIntent.constraints.requiredValidationCommands, ['npm run build']);
assert.equal(classifyTask('/paste'), 'CHAT_MODE');
console.log('multiline terminal input capture tests passed');

const headlineChange = [{ operation: 'replace_headline' as const, exactValue: 'Build with confidence.' }];
assert.match(verifySemanticRequestedChanges('export default () => <main />', headlineChange).join(' '), /Visible main headline/);
assert.match(verifySemanticRequestedChanges('// <h1>Build with confidence.</h1>', headlineChange).join(' '), /Visible main headline/);
assert.match(verifySemanticRequestedChanges('const copy = "Build with confidence.";', headlineChange).join(' '), /Visible main headline/);
assert.deepEqual(verifySemanticRequestedChanges('<h1>Build with confidence.</h1>', headlineChange), []);
assert.match(verifySemanticRequestedChanges('<h1 hidden>Build with confidence.</h1>', headlineChange).join(' '), /Visible main headline/);
assert.equal(hasBlockingReview('BLOCKING_ISSUES: none'), false);
assert.equal(hasBlockingReview('BLOCKING_ISSUES: headline was not changed'), true);
assert.equal(hasBlockingReview('Headline was not changed'), true);
console.log('runtime semantic honesty tests passed');

const tokenWithExpiry = (expiryMs: number) => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(expiryMs / 1000) })).toString('base64url')}.signature`;
const createMemoryAuthStore = (session: any): AuthSessionStore & { saved: any[] } => ({
  saved: [],
  load: () => session,
  save: (next) => { session = next; },
});
const makeAuthClient = (refresh: () => Promise<any>) => ({
  auth: { refreshSession: refresh },
  setAccessToken: () => {},
});

let refreshes = 0;
let requests = 0;
const validStore = createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() + 3_600_000), refreshToken: 'refresh-secret' });
const validRequest = createAuthenticatedRequestHelper(() => makeAuthClient(async () => { refreshes++; return { data: {} }; }), validStore);
assert.equal(await validRequest(async () => { requests++; return 'ok'; }), 'ok');
assert.equal(refreshes, 0);
assert.equal(requests, 1);

const refreshedToken = tokenWithExpiry(Date.now() + 3_600_000);
const expiredStore = createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() - 60_000), refreshToken: 'refresh-secret' });
let expiredRefreshes = 0;
const expiredRequest = createAuthenticatedRequestHelper(() => makeAuthClient(async () => ({ data: { accessToken: refreshedToken, refreshToken: 'next-refresh' } })), expiredStore);
assert.equal(await expiredRequest(async () => 'refreshed'), 'refreshed');
assert.equal(expiredStore.load()?.accessToken, refreshedToken);
assert.equal(expiredStore.load()?.refreshToken, 'next-refresh');

const nearStore = createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() + 30_000), refreshToken: 'refresh-secret' });
const nearRequest = createAuthenticatedRequestHelper(() => makeAuthClient(async () => { expiredRefreshes++; return { data: { accessToken: refreshedToken } }; }), nearStore);
await nearRequest(async () => 'near-expiry');
assert.equal(expiredRefreshes, 1);

const unauthorizedStore = createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() + 3_600_000), refreshToken: 'refresh-secret' });
let unauthorizedRefreshes = 0;
let unauthorizedAttempts = 0;
const unauthorizedRequest = createAuthenticatedRequestHelper(() => makeAuthClient(async () => {
  unauthorizedRefreshes++;
  return { data: { accessToken: refreshedToken, refreshToken: 'next-refresh' } };
}), unauthorizedStore);
assert.equal(await unauthorizedRequest(async () => {
  unauthorizedAttempts++;
  if (unauthorizedAttempts === 1) throw new Error('AUTH_UNAUTHORIZED');
  return 'retried';
}), 'retried');
assert.equal(unauthorizedRefreshes, 1);
assert.equal(unauthorizedAttempts, 2);

const rejectedStore = createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() + 3_600_000), refreshToken: 'refresh-secret' });
let invalidSessionCleanups = 0;
const rejectedRequest = createAuthenticatedRequestHelper(() => makeAuthClient(async () => ({ data: { accessToken: refreshedToken } })), rejectedStore, () => { invalidSessionCleanups++; });
await assert.rejects(() => rejectedRequest(async () => { throw new Error('AUTH_UNAUTHORIZED'); }), (error: unknown) => isZoeAuthError(error) && error.code === 'SESSION_EXPIRED');
assert.equal(invalidSessionCleanups, 1);

const sharedStore = createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() - 60_000), refreshToken: 'refresh-secret' });
let sharedRefreshes = 0;
const sharedRequest = createAuthenticatedRequestHelper(() => makeAuthClient(async () => {
  sharedRefreshes++;
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { data: { accessToken: refreshedToken } };
}), sharedStore);
await Promise.all([sharedRequest(async () => 'one'), sharedRequest(async () => 'two')]);
assert.equal(sharedRefreshes, 1);

const missingRefresh = createAuthenticatedRequestHelper(() => makeAuthClient(async () => ({ data: {} })), createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() - 60_000) }));
await assert.rejects(() => missingRefresh(async () => 'never'), (error: unknown) => isZoeAuthError(error) && error.code === 'SESSION_EXPIRED');

const malformedRefresh = createAuthenticatedRequestHelper(
  () => makeAuthClient(async () => ({ data: { refreshToken: 'rotated-without-access-token' } })),
  createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() - 60_000), refreshToken: 'refresh-secret' }),
);
await assert.rejects(() => malformedRefresh(async () => 'never'), (error: unknown) => isZoeAuthError(error) && error.code === 'MALFORMED_AUTH_RESPONSE');

const refreshNetworkFailure = createAuthenticatedRequestHelper(
  () => makeAuthClient(async () => { throw new Error('network timeout'); }),
  createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() - 60_000), refreshToken: 'refresh-secret' }),
);
await assert.rejects(() => refreshNetworkFailure(async () => 'never'), (error: unknown) => isZoeAuthError(error) && error.code === 'NETWORK_TIMEOUT');

let callbackAfterRefresh = 0;
const activeCallbackRequest = createAuthenticatedRequestHelper(
  () => makeAuthClient(async () => ({ data: { accessToken: refreshedToken, refreshToken: 'next-refresh' } })),
  createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() - 60_000), refreshToken: 'refresh-secret' }),
);
assert.equal(await activeCallbackRequest(async () => { callbackAfterRefresh++; return 'active-task-continued'; }), 'active-task-continued');
assert.equal(callbackAfterRefresh, 1);

let writes = 0;
const completedWriteRequest = createAuthenticatedRequestHelper(() => makeAuthClient(async () => ({ data: {} })), validStore);
await completedWriteRequest(async () => { writes++; return 'completed'; });
assert.equal(writes, 1);

const originalError = console.error;
const authLogs: string[] = [];
process.env.ZOE_DEBUG = 'true';
console.error = ((message: string) => authLogs.push(message)) as typeof console.error;
try {
  const debugStore = createMemoryAuthStore({ accessToken: tokenWithExpiry(Date.now() - 60_000), refreshToken: 'refresh-secret' });
  await createAuthenticatedRequestHelper(() => makeAuthClient(async () => ({ data: { accessToken: refreshedToken, refreshToken: 'next-refresh' } })), debugStore)(async () => 'ok');
} finally {
  console.error = originalError;
  delete process.env.ZOE_DEBUG;
}
assert.equal(authLogs.join('\n').includes('refresh-secret'), false);
assert.equal(authLogs.join('\n').includes(refreshedToken), false);

const authFixtureDir = fs.mkdtempSync(path.join(process.cwd(), 'test', '.auth-session-'));
const authFixturePath = path.join(authFixtureDir, 'auth.json');
try {
  const fileStore = createAuthSessionStore(authFixturePath);
  // Legacy config metadata is intentionally not an input to the credential status API.
  assert.equal(getAuthSessionStatus(fileStore, false).authenticated, false);
  fs.writeFileSync(authFixturePath, '{invalid-json', 'utf8');
  assert.equal(getAuthSessionStatus(fileStore, true).code, 'MALFORMED_LOCAL_SESSION');
  fileStore.save({ accessToken: refreshedToken, refreshToken: 'refresh-secret' });
  assert.equal(getAuthSessionStatus(fileStore, true).authenticated, true);
  assert.equal(fs.existsSync(`${authFixturePath}.${process.pid}.${Date.now()}.tmp`), false);

  let legacyClears = 0;
  const cloudFailure = await logoutWithServices({
    getClient: () => ({ auth: { signOut: async () => { throw new Error('network offline'); }, clearCredentials: async () => {} } }),
    store: fileStore,
    clearLegacy: () => { legacyClears++; },
  });
  assert.equal(cloudFailure.cloudRevocationFailed, true);
  assert.equal(fs.existsSync(authFixturePath), false);
  assert.equal(legacyClears, 1);
  const secondLogout = await logoutWithServices({ getClient: () => ({ auth: { clearCredentials: async () => {} } }), store: fileStore, clearLegacy: () => { legacyClears++; } });
  assert.equal(secondLogout.cloudRevocationFailed, false);
  assert.equal(legacyClears, 2);
} finally {
  fs.rmSync(authFixtureDir, { recursive: true, force: true });
}
assert.deepEqual(getAuthErrorMessage({}), null);
console.log('authenticated Zoe Cloud request tests passed');

let nextTaskId = 0;
let classifications = 0;
const taskOutcomes: string[] = [];
const testOrchestrator = createTaskOrchestrator({
  checkpointStorage: false,
  createId: () => `task-${++nextTaskId}`,
  now: () => 1000,
  classify: (input) => { classifications++; return input.startsWith('build') ? 'TASK_MODE' : 'CHAT_MODE'; },
  conversational: async () => 'explanation',
  plan: async () => ({ plan: JSON.stringify({}), isDestructive: false }),
  structured: async () => ({ filesCreated: 1, filesModified: 0, warnings: [], status: 'SUCCESS', missingFiles: [], missingRequirements: [], elapsedMs: 1 }),
  debug: (message) => taskOutcomes.push(message),
});
const conversationalOutcome = await testOrchestrator.run('explain this', 'chat');
const structuredOutcome = await testOrchestrator.run('build this', 'direct-cli');
assert.equal(conversationalOutcome.code, 'COMPLETED_UNVERIFIED');
assert.equal(conversationalOutcome.verified, false);
assert.equal(structuredOutcome.code, 'COMPLETED');
assert.notEqual(conversationalOutcome.taskId, structuredOutcome.taskId);
assert.equal(classifications, 2);
assert.match(taskOutcomes.join('\n'), /task-1.*CHAT_MODE/);
console.log('task orchestrator tests passed');

const workspaceFixture = fs.mkdtempSync(path.join(process.cwd(), 'test', '.workspace-intelligence-'));
try {
  fs.mkdirSync(path.join(workspaceFixture, 'src'), { recursive: true });
  fs.mkdirSync(path.join(workspaceFixture, 'node_modules', 'ignored'), { recursive: true });
  fs.mkdirSync(path.join(workspaceFixture, '.next'), { recursive: true });
  fs.writeFileSync(path.join(workspaceFixture, '.gitignore'), 'custom-ignore\n*.tmp\n');
  fs.writeFileSync(path.join(workspaceFixture, 'package.json'), JSON.stringify({ name: 'fixture-app', dependencies: { react: '1', next: '1', express: '1', '@insforge/sdk': '1' }, devDependencies: { typescript: '1' } }));
  fs.writeFileSync(path.join(workspaceFixture, 'tsconfig.json'), '{}');
  fs.writeFileSync(path.join(workspaceFixture, 'Dockerfile'), 'FROM node');
  fs.writeFileSync(path.join(workspaceFixture, 'src', 'main.tsx'), 'export {}');
  fs.writeFileSync(path.join(workspaceFixture, 'custom-ignore'), 'skip');
  fs.writeFileSync(path.join(workspaceFixture, 'scratch.tmp'), 'skip');
  fs.writeFileSync(path.join(workspaceFixture, 'node_modules', 'ignored', 'x.js'), 'skip');
  const intelligence = new WorkspaceIntelligence(workspaceFixture, () => 1234);
  const firstWorkspace = intelligence.getContext();
  assert.equal(firstWorkspace.projectName, 'fixture-app');
  assert.deepEqual(firstWorkspace.detectedLanguages, ['TypeScript']);
  assert.equal(firstWorkspace.detectedFrameworks.includes('React'), true);
  assert.equal(firstWorkspace.detectedFrameworks.includes('Next.js'), true);
  assert.equal(firstWorkspace.detectedFrameworks.includes('Express'), true);
  assert.equal(firstWorkspace.detectedFrameworks.includes('InsForge'), true);
  assert.equal(firstWorkspace.detectedFrameworks.includes('Docker'), true);
  assert.equal(firstWorkspace.packageManager, 'npm');
  assert.equal(firstWorkspace.files.some((file) => file.relativePath === 'node_modules/ignored/x.js'), false);
  assert.equal(firstWorkspace.ignoredDirectories.includes('node_modules'), true);
  assert.equal(firstWorkspace.ignoredFiles.includes('custom-ignore'), true);
  assert.equal(firstWorkspace.importantFiles.includes('package.json'), true);
  assert.equal(firstWorkspace.importantFiles.includes('tsconfig.json'), true);
  assert.equal(firstWorkspace.entryPoints.includes('src/main.tsx'), true);
  assert.equal(Object.isFrozen(firstWorkspace), true);
  assert.equal(intelligence.getContext(), firstWorkspace);
  assert.equal(intelligence.scans, 1);
  fs.writeFileSync(path.join(workspaceFixture, 'src', 'main.tsx'), 'export const version = 2');
  const refreshedWorkspace = intelligence.refresh(['src/main.tsx']);
  assert.equal(refreshedWorkspace.contextVersion, firstWorkspace.contextVersion + 1);
  assert.equal(intelligence.scans, 1);
  assert.notEqual(refreshedWorkspace.files.find((file) => file.relativePath === 'src/main.tsx')?.hash, firstWorkspace.files.find((file) => file.relativePath === 'src/main.tsx')?.hash);
  let receivedPlannerContext: unknown; let receivedRuntimeContext: unknown;
  const contextOrchestrator = createTaskOrchestrator({
    checkpointStorage: false,
    workspace: () => refreshedWorkspace, classify: () => 'TASK_MODE', createId: () => 'workspace-task',
    plan: async (_input, workspace) => { receivedPlannerContext = workspace; return { plan: '{}', isDestructive: false }; },
    structured: async (_input, _plan, workspace) => { receivedRuntimeContext = workspace; return { filesCreated: 0, filesModified: 0, warnings: [], status: 'SUCCESS', missingFiles: [], missingRequirements: [], elapsedMs: 0 }; },
  });
  await contextOrchestrator.run('change fixture', 'chat');
  assert.equal(receivedPlannerContext, refreshedWorkspace);
  assert.equal(receivedRuntimeContext, refreshedWorkspace);
console.log('workspace intelligence tests passed');
} finally { fs.rmSync(workspaceFixture, { recursive: true, force: true }); }

const gitFixtureRoot = fs.mkdtempSync(path.join(process.cwd(), 'test', '.git-awareness-'));
try {
  const nestedWorkspace = path.join(gitFixtureRoot, 'packages', 'app');
  fs.mkdirSync(nestedWorkspace, { recursive: true });
  const gitCalls: string[][] = [];
  const fakeGit = (overrides: Record<string, GitCommandResult> = {}): GitCommandRunner => (args) => {
    gitCalls.push([...args]);
    const key = args.join(' ');
    return overrides[key] || ({
      '--version': { ok: true, stdout: 'git version 2.50.1\n' },
      'rev-parse --show-toplevel': { ok: true, stdout: `${gitFixtureRoot}\n` },
      'rev-parse --is-inside-work-tree': { ok: true, stdout: 'true\n' },
      'rev-parse HEAD': { ok: true, stdout: '0123456789abcdef\n' },
      'symbolic-ref --short HEAD': { ok: true, stdout: 'main\n' },
      'status --porcelain=v1 -z --untracked-files=all': { ok: true, stdout: '' },
      'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { ok: true, stdout: 'origin/main\n' },
      'rev-list --left-right --count HEAD...@{upstream}': { ok: true, stdout: '2\t3\n' },
    }[key] || { ok: false, stdout: '', failureReason: 'UnknownGitFailure' }) as GitCommandResult;
  };
  const cleanGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit(), now: () => 10, timeoutMs: 25 });
  assert.equal(cleanGit.repositoryDetected, true);
  assert.equal(cleanGit.repositoryRoot, path.resolve(gitFixtureRoot));
  assert.equal(cleanGit.workspaceInsideRepository, true);
  assert.equal(cleanGit.workingTreeState, 'CLEAN');
  assert.equal(cleanGit.currentBranch, 'main');
  assert.equal(cleanGit.headCommit, '0123456789abcdef');
  assert.equal(cleanGit.upstreamConfigured, true);
  assert.equal(cleanGit.aheadCount, 2);
  assert.equal(cleanGit.behindCount, 3);
  assert.equal(cleanGit.inspectionTimestamp, 10);
  assert.equal(Object.isFrozen(cleanGit), true);
  assert.equal(Object.isFrozen(cleanGit.changedPaths), true);

  const dirtyGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    'status --porcelain=v1 -z --untracked-files=all': { ok: true, stdout: 'M  staged.ts\0 M unstaged.ts\0?? new.ts\0R  src/new-name.ts\0src/old-name.ts\0D  removed.ts\0' },
  }) });
  assert.equal(dirtyGit.workingTreeState, 'DIRTY');
  assert.deepEqual(dirtyGit.stagedFiles, ['removed.ts', 'src/new-name.ts', 'staged.ts']);
  assert.deepEqual(dirtyGit.unstagedFiles, ['unstaged.ts']);
  assert.deepEqual(dirtyGit.untrackedFiles, ['new.ts']);
  assert.equal(dirtyGit.changedPaths.find((item) => item.path === 'src/new-name.ts')?.statuses.includes('RENAMED'), true);
  assert.equal(dirtyGit.changedPaths.find((item) => item.path === 'removed.ts')?.statuses.includes('DELETED'), true);

  const conflictedGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    'status --porcelain=v1 -z --untracked-files=all': { ok: true, stdout: 'UU conflict.ts\0' },
  }) });
  assert.equal(conflictedGit.workingTreeState, 'CONFLICTED');
  assert.deepEqual(conflictedGit.conflictedFiles, ['conflict.ts']);

  const detachedGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    'symbolic-ref --short HEAD': { ok: false, stdout: '', failureReason: 'DetachedHead' },
  }) });
  assert.equal(detachedGit.detachedHead, true);
  assert.equal(detachedGit.currentBranch, null);
  assert.equal(detachedGit.workingTreeState, 'DETACHED_HEAD');

  const noUpstreamGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': { ok: false, stdout: '', failureReason: 'UpstreamUnavailable' },
  }) });
  assert.equal(noUpstreamGit.upstreamConfigured, false);
  assert.equal(noUpstreamGit.failureReason, 'UpstreamUnavailable');

  const noRepository = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    'rev-parse --show-toplevel': { ok: false, stdout: '', failureReason: 'NotARepository' },
  }) });
  assert.equal(noRepository.repositoryDetected, false);
  assert.equal(noRepository.workingTreeState, 'NOT_A_REPOSITORY');
  assert.equal(noRepository.inspectionStatus, 'SUCCESS');

  const unavailableGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    '--version': { ok: false, stdout: '', failureReason: 'GitExecutableNotFound' },
  }) });
  assert.equal(unavailableGit.workingTreeState, 'UNAVAILABLE');
  assert.equal(unavailableGit.failureReason, 'GitExecutableNotFound');
  const timedOutGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    '--version': { ok: false, stdout: '', failureReason: 'InspectionTimedOut' },
  }) });
  assert.equal(timedOutGit.failureReason, 'InspectionTimedOut');
  const malformedGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    'status --porcelain=v1 -z --untracked-files=all': { ok: true, stdout: 'malformed\0' },
  }) });
  assert.equal(malformedGit.workingTreeState, 'UNKNOWN');
  assert.equal(malformedGit.failureReason, 'StatusParseFailed');

  const normalizedGit = inspectGitRepository(nestedWorkspace, { runner: fakeGit({
    'status --porcelain=v1 -z --untracked-files=all': { ok: true, stdout: ' M src\\nested\\file.ts\0' },
  }) });
  assert.deepEqual(normalizedGit.unstagedFiles, ['src/nested/file.ts']);
  const approvedReadOnly = new Set([
    '--version', 'rev-parse --show-toplevel', 'rev-parse --is-inside-work-tree', 'rev-parse HEAD',
    'symbolic-ref --short HEAD', 'status --porcelain=v1 -z --untracked-files=all',
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}', 'rev-list --left-right --count HEAD...@{upstream}',
  ]);
  assert.equal(gitCalls.every((args) => approvedReadOnly.has(args.join(' '))), true);
  assert.equal(gitCalls.some((args) => /\b(add|commit|push|pull|fetch|checkout|reset|clean|stash|merge|rebase)\b/.test(args.join(' '))), false);

  let sharedInspections = 0;
  const sharedGit = cleanGit;
  const sharedIntelligence = new WorkspaceIntelligence(nestedWorkspace, () => 20, () => { sharedInspections++; return sharedGit; });
  const sharedWorkspace = sharedIntelligence.getContext();
  assert.equal(sharedWorkspace.gitContext, sharedGit);
  assert.equal(sharedWorkspace.gitRepository, true);
  assert.equal(sharedInspections, 1);
  assert.equal(sharedIntelligence.getContext().gitContext, sharedWorkspace.gitContext);
  const sharedTaskContext = {
    taskId: 'git-preview', rawInput: 'inspect', normalizedInput: 'inspect', mode: 'TASK_MODE' as const, entryPoint: 'chat' as const,
    workspaceRoot: sharedWorkspace.workspaceRoot, workspaceContext: sharedWorkspace,
    cancellationToken: createTaskCancellationToken('git-preview'), startedAt: 0, metadata: {},
  };
  const sharedPreview = createTaskPreview(sharedTaskContext);
  assert.equal(sharedPreview.git, sharedWorkspace.gitContext);
  const gitPreviewLines: string[] = []; const originalLog = console.log;
  console.log = ((line = '') => gitPreviewLines.push(String(line))) as typeof console.log;
  try { renderTaskPreview(sharedPreview); } finally { console.log = originalLog; }
  assert.match(gitPreviewLines.join('\n'), /Git:.*main.*CLEAN/i);
  const dirtyPreview = createTaskPreview({ ...sharedTaskContext, workspaceContext: Object.freeze({ ...sharedWorkspace, gitContext: dirtyGit }) });
  const dirtyPreviewLines: string[] = [];
  console.log = ((line = '') => dirtyPreviewLines.push(String(line))) as typeof console.log;
  try { renderTaskPreview(dirtyPreview); } finally { console.log = originalLog; }
  assert.match(dirtyPreviewLines.join('\n'), /staged.*unstaged.*untracked/i);
  const nonGitPreview = createTaskPreview({ ...sharedTaskContext, workspaceContext: Object.freeze({ ...sharedWorkspace, gitContext: noRepository, gitRepository: false }) });
  const nonGitLines: string[] = [];
  console.log = ((line = '') => nonGitLines.push(String(line))) as typeof console.log;
  try { renderTaskPreview(nonGitPreview); } finally { console.log = originalLog; }
  assert.match(nonGitLines.join('\n'), /Repository: No/i);
  console.log('read-only Git awareness and preview tests passed');
} finally { fs.rmSync(gitFixtureRoot, { recursive: true, force: true }); }

const commandWorkspace = new WorkspaceIntelligence(process.cwd()).getContext();
const commandDecision = (command: string) => classifyDirectCommand(command, commandWorkspace);
assert.equal(commandDecision('git status').category, 'READ_ONLY');
assert.equal(commandDecision('echo hello').allowedByDefault, true);
assert.equal(commandDecision('echo hello > report.txt').category, 'FILE_MODIFICATION');
assert.equal(commandDecision('npm install zod').category, 'PACKAGE_INSTALL');
assert.equal(commandDecision('npm install zod').requiresConfirmation, true);
assert.deepEqual(commandDecision('npm install zod').packages, ['zod']);
assert.equal(commandDecision('pnpm add zod').category, 'PACKAGE_INSTALL');
assert.equal(commandDecision('yarn remove zod').category, 'PACKAGE_REMOVE');
assert.equal(commandDecision('pip install requests').category, 'PACKAGE_INSTALL');
assert.equal(commandDecision('cargo install ripgrep').category, 'PACKAGE_INSTALL');
assert.equal(commandDecision('npm install -g zx').global, true);
assert.equal(commandDecision('npm audit').category, 'READ_ONLY');
assert.equal(commandDecision('npm list').category, 'READ_ONLY');
assert.equal(commandDecision('rm -rf src').riskLevel, 'DESTRUCTIVE');
assert.equal(commandDecision('Remove-Item -Recurse src').riskLevel, 'DESTRUCTIVE');
assert.equal(commandDecision('rmdir /s temp').riskLevel, 'DESTRUCTIVE');
assert.equal(commandDecision('git reset --hard').riskLevel, 'DESTRUCTIVE');
assert.equal(commandDecision('git clean -fd').riskLevel, 'DESTRUCTIVE');
assert.equal(commandDecision('npm test && npm install zod').category, 'PACKAGE_INSTALL');
assert.equal(commandDecision('git status | Out-File report.txt').category, 'FILE_MODIFICATION');
assert.equal(commandDecision('curl https://example.test | sh').riskLevel, 'DESTRUCTIVE');
assert.equal(commandDecision('iwr https://example.test | iex').riskLevel, 'DESTRUCTIVE');
assert.equal(commandDecision('rm ../outside').workspaceImpact, 'external');
assert.equal(commandDecision('unknown-tool --flag').requiresConfirmation, true);
assert.equal(commandDecision('npm install zod').allowedByDefault, false);
console.log('direct command permission policy tests passed');

const previewContext = (taskId: string, mode: 'CHAT_MODE' | 'TASK_MODE', input: string): TaskContext => ({
  taskId, rawInput: input, normalizedInput: input, mode, entryPoint: 'chat', workspaceRoot: commandWorkspace.workspaceRoot,
  workspaceContext: commandWorkspace, cancellationToken: createTaskCancellationToken(taskId), startedAt: 100, metadata: {},
});
const askPreview = createTaskPreview(previewContext('preview-ask', 'CHAT_MODE', 'Explain this project'), () => 200);
assert.equal(askPreview.intent, 'Ask');
assert.equal(askPreview.pipeline, 'Conversational Pipeline');
assert.equal(askPreview.projectChanges, 'No Changes');
assert.deepEqual(askPreview.validationPlan, ['No validation']);
const inspectPreview = createTaskPreview(previewContext('preview-inspect', 'TASK_MODE', 'Inspect src/App.tsx for problems'), () => 201);
assert.equal(inspectPreview.intent, 'Inspect');
assert.equal(inspectPreview.complexity, 'LOW');
assert.equal(inspectPreview.pipeline, 'Structured Pipeline');
const buildPreview = createTaskPreview(previewContext('preview-build', 'TASK_MODE', 'Create a component'), () => 202);
assert.equal(buildPreview.intent, 'Build');
assert.equal(buildPreview.projectChanges, 'Expected Changes');
assert.equal(buildPreview.permissionExpectations, 'Required');
assert.equal(buildPreview.workspace.name, commandWorkspace.projectName);
assert.equal(buildPreview.taskId, 'preview-build');
const highPreview = createTaskPreview(previewContext('preview-high', 'TASK_MODE', 'Refactor the entire project architecture'), () => 203);
assert.equal(highPreview.complexity, 'HIGH');
let pauseReads = 0;
await pauseForHighComplexity(highPreview, async () => { pauseReads++; return ''; });
await pauseForHighComplexity(buildPreview, async () => { pauseReads++; return ''; });
assert.equal(pauseReads, 1);
const lifecycle: string[] = []; const lifecycleIds: string[] = [];
const previewOrchestrator = createTaskOrchestrator({
  checkpointStorage: false,
  createId: () => `lifecycle-${lifecycleIds.length + 1}`, now: () => 300, workspace: () => commandWorkspace,
  classify: (input) => input.includes('create') ? 'TASK_MODE' : 'CHAT_MODE',
  conversational: async () => { lifecycle.push('conversational'); return 'answer'; },
  plan: async () => { lifecycle.push('planner'); return { plan: '{}', isDestructive: false }; },
  structured: async () => { lifecycle.push('runtime'); return { filesCreated: 0, filesModified: 0, warnings: [], status: 'SUCCESS', missingFiles: [], missingRequirements: [], elapsedMs: 0 }; },
});
const previewHook = (context: Readonly<TaskContext>) => { lifecycle.push('preview'); lifecycleIds.push(context.taskId); assert.equal(Object.isFrozen(context), true); assert.equal(context.workspaceContext, commandWorkspace); };
const lifecycleBuild = await previewOrchestrator.run('create feature', 'chat', { onPreview: previewHook });
assert.deepEqual(lifecycle, ['preview', 'planner', 'runtime']);
assert.equal(lifecycleIds[0], lifecycleBuild.taskId);
lifecycle.length = 0;
const lifecycleAsk = await previewOrchestrator.run('hello there', 'chat', { onPreview: previewHook });
assert.deepEqual(lifecycle, ['preview', 'conversational']);
assert.notEqual(lifecycleAsk.taskId, lifecycleBuild.taskId);
assert.equal(lifecycleIds.length, 2);
console.log('task preview lifecycle tests passed');

const unitToken = createTaskCancellationToken('cancel-unit', () => 500);
assert.equal(unitToken.taskId(), 'cancel-unit');
assert.equal(unitToken.state(), 'CREATED');
unitToken.enter('Planner');
assert.equal(unitToken.cancel('test cancellation'), true);
assert.equal(unitToken.cancel('duplicate'), false);
assert.equal(unitToken.isCancelled(), true);
assert.equal(unitToken.reason(), 'test cancellation');
assert.equal(unitToken.timestamp(), 500);
assert.throws(() => unitToken.throwIfCancelled(), TaskCancelledError);
unitToken.finish('CANCELLED');
assert.equal(unitToken.state(), 'CANCELLED');
unitToken.finish('COMPLETED');
assert.equal(unitToken.state(), 'CANCELLED');

const cancellationTokens: TaskCancellationToken[] = []; const cancellationStages: string[] = [];
const cancellationOrchestrator = createTaskOrchestrator({
  checkpointStorage: false,
  createId: () => `cancel-${cancellationTokens.length + 1}`, now: () => 1000, workspace: () => commandWorkspace,
  cancellation: (id) => { const token = createTaskCancellationToken(id, () => 1010); cancellationTokens.push(token); return token; },
  classify: () => 'TASK_MODE',
  plan: async (_input, _workspace, token) => { cancellationStages.push('planner'); token.cancel(); return { plan: '{}', isDestructive: false }; },
  structured: async () => { cancellationStages.push('runtime'); return { filesCreated: 0, filesModified: 0, warnings: [], status: 'SUCCESS', missingFiles: [], missingRequirements: [], elapsedMs: 0 }; },
});
const cancelledBeforeRuntime = await cancellationOrchestrator.run('cancel after planner', 'chat');
assert.equal(cancelledBeforeRuntime.code, 'CANCELLED_BY_USER');
assert.deepEqual(cancellationStages, ['planner']);
assert.equal(cancelledBeforeRuntime.metadata?.cancelledStage, 'Planner');
assert.equal(cancelledBeforeRuntime.metadata?.rollback, false);
assert.equal(getActiveTaskCancellation(), null);

const beforePlannerOrchestrator = createTaskOrchestrator({
  checkpointStorage: false,
  createId: () => 'cancel-preview', now: () => 1100, workspace: () => commandWorkspace, classify: () => 'TASK_MODE',
  plan: async () => { throw new Error('planner must be skipped'); },
});
const cancelledBeforePlanner = await beforePlannerOrchestrator.run('cancel now', 'chat', { onPreview: (context) => context.cancellationToken.cancel() });
assert.equal(cancelledBeforePlanner.code, 'CANCELLED_BY_USER');
assert.equal(cancelledBeforePlanner.metadata?.cancelledStage, 'Preview');

let runtimeTokenSeen: TaskCancellationToken | undefined;
const duringRuntimeOrchestrator = createTaskOrchestrator({
  checkpointStorage: false,
  createId: () => 'cancel-runtime', now: () => 1200, workspace: () => commandWorkspace, classify: () => 'TASK_MODE',
  plan: async () => ({ plan: '{}', isDestructive: false }),
  structured: async (_input, _plan, _workspace, token) => { runtimeTokenSeen = token; token.cancel(); return { filesCreated: 1, filesModified: 0, warnings: [], status: 'SUCCESS', missingFiles: [], missingRequirements: [], elapsedMs: 0 }; },
});
const cancelledDuringRuntime = await duringRuntimeOrchestrator.run('cancel runtime', 'chat');
assert.equal(cancelledDuringRuntime.code, 'CANCELLED_BY_USER');
assert.equal(runtimeTokenSeen?.taskId(), cancelledDuringRuntime.taskId);
assert.notEqual(cancellationTokens[0], runtimeTokenSeen);

const boundaryToken = createTaskCancellationToken('boundaries');
for (const stage of ['Tool execution', 'Validation', 'Reviewer'] as const) { boundaryToken.enter(stage); }
boundaryToken.cancel();
assert.throws(() => boundaryToken.throwIfCancelled(), TaskCancelledError);
assert.equal(handleCancellationInterrupt(), 'EXIT');
const interruptToken = createTaskCancellationToken('interrupt');
activateTaskCancellation(interruptToken);
assert.equal(handleCancellationInterrupt(), 'CANCEL_REQUESTED');
assert.equal(handleCancellationInterrupt(), 'CANCELLATION_ALREADY_IN_PROGRESS');
clearTaskCancellation(interruptToken);
assert.equal(handleCancellationInterrupt(), 'EXIT');

const rendererLogs: string[] = []; const savedConsoleLog = console.log;
console.log = ((message = '') => rendererLogs.push(String(message))) as typeof console.log;
try { renderTaskOutcome(cancelledDuringRuntime); } finally { console.log = savedConsoleLog; }
assert.match(rendererLogs.join('\n'), /Task cancelled/);
assert.match(rendererLogs.join('\n'), /Runtime/);
assert.match(rendererLogs.join('\n'), /Rollback:.*Not implemented/);
console.log('cooperative task cancellation tests passed');

const checkpoint = createTaskCheckpoint({
  checkpointId: 'checkpoint-1', taskId: 'task-checkpoint', taskState: 'RUNNING', pipelineStage: 'Runtime',
  completedStages: ['Preview', 'Planning'], startedAt: 1000, updatedAt: 1100, workspace: commandWorkspace,
  validationState: { status: 'PASSED', resultNames: ['typecheck'] }, reviewState: { status: 'PASSED' },
  toolExecutionState: { completedBatches: 2, completedToolNames: ['read_file'], elapsedMs: 25 },
  permissionState: { approvalsPreviouslyGranted: true, validUntil: 5000 }, metadata: { source: 'test' },
});
assert.equal(checkpoint.checkpointState, 'CREATED');
assert.equal(checkpoint.checkpointSchemaVersion, CHECKPOINT_SCHEMA_VERSION);
assert.equal(checkpoint.permissionState.revalidationRequired, true);
assert.equal(Object.isFrozen(checkpoint), true);
assert.equal(Object.isFrozen(checkpoint.workspaceFingerprint.files), true);
assert.equal(checkpoint.gitSnapshot.contextVersion, 1);
assert.equal(checkpoint.gitSnapshot.repositoryDetected, commandWorkspace.gitContext.repositoryDetected);
assert.equal(Object.isFrozen(checkpoint.gitSnapshot), true);
assert.equal(Object.isFrozen(checkpoint.gitSnapshot.changedPaths), true);
assert.equal('upstreamName' in checkpoint.gitSnapshot, false);
assert.deepEqual(checkpoint.completedStages, ['Preview', 'Planning']);
assert.equal(checkpoint.remainingStages.includes('Runtime'), true);
const readyCheckpoint = transitionCheckpoint(checkpoint, 'READY', 1200);
assert.equal(readyCheckpoint.resumeEligible, true);
assert.equal(checkpoint.checkpointState, 'CREATED');
assert.throws(() => transitionCheckpoint(checkpoint, 'RESUMED', 1200), /Invalid checkpoint transition/);
assert.throws(() => transitionCheckpoint(checkpoint, 'INVALID', 1200), /invalidation reason/);
const compatible = evaluateResumeEligibility(readyCheckpoint, { workspace: commandWorkspace, now: 2000 });
assert.equal(compatible.eligible, true);
assert.equal(compatible.permissionsMustBeReevaluated, true);
assert.equal(compatible.validationReusable, true);
assert.equal(compatible.reviewReusable, true);
assert.equal(workspaceFingerprintsMatch(checkpoint.workspaceFingerprint, readyCheckpoint.workspaceFingerprint), true);
assert.equal(evaluateResumeEligibility(readyCheckpoint, { workspace: commandWorkspace, checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION + 1, now: 2000 }).reason, 'SCHEMA_VERSION_MISMATCH');
assert.equal(evaluateResumeEligibility(readyCheckpoint, { workspace: commandWorkspace, plannerVersion: 2, now: 2000 }).reason, 'PLANNER_VERSION_MISMATCH');
assert.equal(evaluateResumeEligibility(readyCheckpoint, { workspace: commandWorkspace, runtimeVersion: 2, now: 2000 }).reason, 'RUNTIME_VERSION_MISMATCH');
assert.equal(evaluateResumeEligibility(readyCheckpoint, { workspace: commandWorkspace, now: 6000 }).reason, 'PERMISSION_STATE_EXPIRED');
const versionChangedWorkspace = Object.freeze({ ...commandWorkspace, contextVersion: commandWorkspace.contextVersion + 1 }) as WorkspaceContext;
assert.equal(evaluateResumeEligibility(readyCheckpoint, { workspace: versionChangedWorkspace, now: 2000 }).reason, 'WORKSPACE_VERSION_INCOMPATIBLE');
const changedFiles = commandWorkspace.files.map((file, index) => index === 0 ? Object.freeze({ ...file, hash: `${file.hash}-changed` }) : file);
const fingerprintChangedWorkspace = Object.freeze({ ...commandWorkspace, files: Object.freeze(changedFiles) }) as WorkspaceContext;
assert.equal(evaluateResumeEligibility(readyCheckpoint, { workspace: fingerprintChangedWorkspace, now: 2000 }).reason, 'WORKSPACE_FINGERPRINT_CHANGED');
const invalidCheckpoint = invalidateCheckpoint(readyCheckpoint, { workspace: fingerprintChangedWorkspace, now: 2100 });
assert.equal(invalidCheckpoint.checkpointState, 'INVALID');
assert.equal(invalidCheckpoint.resumeEligible, false);
assert.equal(invalidCheckpoint.invalidReason, 'WORKSPACE_FINGERPRINT_CHANGED');
const obsoleteCheckpoint = transitionCheckpoint(readyCheckpoint, 'OBSOLETE', 2200);
assert.equal(evaluateResumeEligibility(obsoleteCheckpoint, { workspace: commandWorkspace, now: 2300 }).reason, 'CHECKPOINT_OBSOLETE');
assert.throws(() => createTaskCheckpoint({ checkpointId: 'bad', taskId: 'bad', taskState: 'RUNNING', pipelineStage: 'Runtime', startedAt: 0, updatedAt: 1, workspace: commandWorkspace, metadata: { accessToken: 'forbidden' } }), /sensitive field/);
console.log('task checkpoint model tests passed');

const checkpointStorageFixture = fs.mkdtempSync(path.join(process.cwd(), 'test', '.checkpoint-storage-'));
try {
  const storage = new CheckpointStorage(checkpointStorageFixture);
  await storage.save(readyCheckpoint);
  const checkpointFile = path.join(checkpointStorageFixture, `${readyCheckpoint.taskId}.checkpoint.json`);
  assert.equal(fs.existsSync(checkpointFile), true);
  assert.equal(fs.readdirSync(checkpointStorageFixture).some((name) => name.endsWith('.tmp')), false);
  const loadedCheckpoint = await storage.load(readyCheckpoint.taskId);
  assert.deepEqual(loadedCheckpoint, readyCheckpoint);
  assert.equal(Object.isFrozen(loadedCheckpoint), true);
  const listedCheckpoints = await storage.list();
  assert.equal(listedCheckpoints.length, 1);
  assert.equal(listedCheckpoints[0].taskId, readyCheckpoint.taskId);
  assert.equal(listedCheckpoints[0].workspace, readyCheckpoint.workspaceId);
  assert.equal(Object.isFrozen(listedCheckpoints), true);

  const concurrentResults = await Promise.allSettled([storage.save(readyCheckpoint), storage.save(readyCheckpoint)]);
  assert.equal(concurrentResults.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1);

  const corruptedTaskId = 'corrupted-task';
  fs.writeFileSync(path.join(checkpointStorageFixture, `${corruptedTaskId}.checkpoint.json`), '{invalid-json', 'utf8');
  await assert.rejects(() => storage.load(corruptedTaskId), (error: unknown) => error instanceof CheckpointPersistenceError && error.code === 'CheckpointCorrupted');

  const incompatibleTaskId = 'incompatible-task';
  const incompatible = { ...readyCheckpoint, taskId: incompatibleTaskId, checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION + 1 };
  fs.writeFileSync(path.join(checkpointStorageFixture, `${incompatibleTaskId}.checkpoint.json`), JSON.stringify(incompatible), 'utf8');
  await assert.rejects(() => storage.load(incompatibleTaskId), (error: unknown) => error instanceof CheckpointPersistenceError && error.code === 'CheckpointVersionMismatch');
  const legacyTaskId = 'legacy-v1-task';
  fs.writeFileSync(path.join(checkpointStorageFixture, `${legacyTaskId}.checkpoint.json`), JSON.stringify({ ...readyCheckpoint, taskId: legacyTaskId, checkpointSchemaVersion: 1 }), 'utf8');
  await assert.rejects(() => storage.load(legacyTaskId), (error: unknown) => error instanceof CheckpointPersistenceError && error.code === 'CheckpointVersionMismatch');
  await assert.rejects(() => storage.load('missing-task'), (error: unknown) => error instanceof CheckpointPersistenceError && error.code === 'CheckpointNotFound');

  const unsafeCheckpoint = { ...readyCheckpoint, unsafe: () => 'not serializable' } as typeof readyCheckpoint;
  await assert.rejects(() => storage.save(unsafeCheckpoint), (error: unknown) => error instanceof CheckpointPersistenceError && error.code === 'CheckpointSerializationFailed');
  const promiseCheckpoint = { ...readyCheckpoint, runtimeObject: Promise.resolve('forbidden') } as typeof readyCheckpoint;
  await assert.rejects(() => storage.save(promiseCheckpoint), (error: unknown) => error instanceof CheckpointPersistenceError && error.code === 'CheckpointSerializationFailed');
  const sensitiveGitCheckpoint = { ...readyCheckpoint, gitSnapshot: { ...readyCheckpoint.gitSnapshot, remoteUrl: 'https://token@example.test/repo' } } as typeof readyCheckpoint;
  await assert.rejects(() => storage.save(sensitiveGitCheckpoint), (error: unknown) => error instanceof CheckpointPersistenceError && error.code === 'CheckpointCorrupted');

  assert.equal(await storage.delete(corruptedTaskId), true);
  assert.equal(await storage.delete(corruptedTaskId), false);
  assert.equal(await storage.delete(incompatibleTaskId), true);
  assert.equal(await storage.delete(legacyTaskId), true);

  const completedCheckpoint = transitionCheckpoint(readyCheckpoint, 'COMPLETED', 1300);
  await storage.save(completedCheckpoint);
  const cleanupResult = await storage.cleanup(100, 2000);
  assert.deepEqual(cleanupResult.removed, [completedCheckpoint.taskId]);
  assert.equal(await storage.delete(completedCheckpoint.taskId), false);
  console.log('checkpoint persistence tests passed');
} finally { fs.rmSync(checkpointStorageFixture, { recursive: true, force: true }); }

const lifecycleWrites: TaskCheckpoint[] = [];
const lifecycleCapture = new CheckpointLifecycleCapture({ checkpointId: 'capture-checkpoint', taskId: 'capture-task', startedAt: 100, workspace: commandWorkspace, storage: { save: async (value) => { lifecycleWrites.push(value); } }, now: (() => { let value = 200; return () => ++value; })() });
await lifecycleCapture.create();
assert.equal(lifecycleWrites[0].checkpointState, 'CREATED');
const initialCapturedCheckpoint = lifecycleWrites[0];
await lifecycleCapture.stage('Preview');
await lifecycleCapture.stage('Preview');
assert.equal(lifecycleWrites.length, 2);
assert.equal(lifecycleWrites[1].checkpointState, 'READY');
assert.equal(lifecycleWrites[1].pipelineStage, 'Preview');
assert.equal(initialCapturedCheckpoint.checkpointState, 'CREATED');
for (const stage of ['Planning', 'Runtime', 'ToolExecution', 'Validation', 'Reviewer', 'Rendering', 'Cleanup'] as const) await lifecycleCapture.stage(stage);
await lifecycleCapture.completedFinal();
assert.equal(lifecycleWrites.at(-1)?.checkpointState, 'COMPLETED');
assert.equal(lifecycleWrites.at(-1)?.completedStages.includes('Reviewer'), true);
assert.equal(new Set(lifecycleWrites.map((value) => value)).size, lifecycleWrites.length);

const cancelledWrites: TaskCheckpoint[] = [];
const cancelledCapture = new CheckpointLifecycleCapture({ checkpointId: 'cancelled-checkpoint', taskId: 'cancelled-capture', startedAt: 0, workspace: commandWorkspace, storage: { save: async (value) => { cancelledWrites.push(value); } }, now: () => 500 });
await cancelledCapture.create(); await cancelledCapture.stage('Preview'); await cancelledCapture.cancelled('Planning', 'User requested cancellation.', 50);
assert.equal(cancelledWrites.at(-1)?.checkpointState, 'DISCARDED');
assert.equal(cancelledWrites.at(-1)?.metadata.cancelledStage, 'Planning');

const failedWrites: TaskCheckpoint[] = [];
const failedCapture = new CheckpointLifecycleCapture({ checkpointId: 'failed-checkpoint', taskId: 'failed-capture', startedAt: 0, workspace: commandWorkspace, storage: { save: async (value) => { failedWrites.push(value); } }, now: () => 600 });
await failedCapture.create(); await failedCapture.failed('Runtime', 'INTERNAL_ERROR', 'The task could not be completed.');
assert.equal(failedWrites.at(-1)?.checkpointState, 'INVALID');
assert.equal(failedWrites.at(-1)?.metadata.failureCategory, 'INTERNAL_ERROR');
assert.equal(String(failedWrites.at(-1)?.metadata.failureReason).includes('Error:'), false);

const isolatedCapture = new CheckpointLifecycleCapture({ checkpointId: 'isolated', taskId: 'isolated', startedAt: 0, workspace: commandWorkspace, storage: { save: async () => { throw new Error('disk unavailable'); } }, now: () => 700 });
await isolatedCapture.create(); await isolatedCapture.stage('Preview');
assert.equal(isolatedCapture.warnings.length, 2);

const automaticWrites: TaskCheckpoint[] = [];
const automaticOrchestrator = createTaskOrchestrator({
  createId: () => 'automatic-checkpoint-task', now: (() => { let value = 800; return () => ++value; })(), workspace: () => commandWorkspace,
  checkpointStorage: { save: async (value) => { automaticWrites.push(value); } }, classify: () => 'TASK_MODE',
  plan: async () => ({ plan: '{}', isDestructive: false }),
  structured: async (_input, _plan, _workspace, _token, stage) => { await stage?.('ToolExecution'); await stage?.('Validation'); await stage?.('Reviewer'); return { filesCreated: 1, filesModified: 0, warnings: [], status: 'SUCCESS', missingFiles: [], missingRequirements: [], elapsedMs: 0 }; },
});
const automaticOutcome = await automaticOrchestrator.run('create fixture', 'chat', { onPreview: () => undefined });
assert.equal(automaticOutcome.code, 'COMPLETED');
assert.equal(automaticWrites[0].checkpointState, 'CREATED');
assert.equal(automaticWrites.at(-1)?.checkpointState, 'COMPLETED');
assert.equal(automaticWrites.filter((value) => value.pipelineStage === 'Preview').length, 2);

const storageFailureOrchestrator = createTaskOrchestrator({ checkpointStorage: { save: async () => { throw new Error('storage offline'); } }, createId: () => 'storage-failure-task', workspace: () => commandWorkspace, classify: () => 'CHAT_MODE', conversational: async () => 'answer' });
const storageFailureOutcome = await storageFailureOrchestrator.run('hello', 'chat');
assert.equal(storageFailureOutcome.code, 'COMPLETED_UNVERIFIED');
assert.equal(storageFailureOutcome.warnings?.some((warning) => warning.includes('Checkpoint persistence warning')), true);
const automaticCancelledWrites: TaskCheckpoint[] = [];
const automaticCancelledOrchestrator = createTaskOrchestrator({ checkpointStorage: { save: async (value) => { automaticCancelledWrites.push(value); } }, createId: () => 'automatic-cancelled', workspace: () => commandWorkspace, classify: () => 'TASK_MODE', plan: async () => { throw new Error('planner should not start'); } });
const automaticCancelledOutcome = await automaticCancelledOrchestrator.run('cancel before planner', 'chat', { onPreview: (context) => context.cancellationToken.cancel() });
assert.equal(automaticCancelledOutcome.code, 'CANCELLED_BY_USER');
assert.equal(automaticCancelledWrites.at(-1)?.checkpointState, 'DISCARDED');
const automaticFailedWrites: TaskCheckpoint[] = [];
const automaticFailedOrchestrator = createTaskOrchestrator({ checkpointStorage: { save: async (value) => { automaticFailedWrites.push(value); } }, createId: () => 'automatic-failed', workspace: () => commandWorkspace, classify: () => 'TASK_MODE', plan: async () => { throw new Error('safe failure'); } });
const automaticFailedOutcome = await automaticFailedOrchestrator.run('fail planner', 'chat');
assert.equal(automaticFailedOutcome.code, 'INTERNAL_ERROR');
assert.equal(automaticFailedWrites.at(-1)?.checkpointState, 'INVALID');
console.log('checkpoint lifecycle integration tests passed');

const checkpointBeforeDrift = JSON.stringify(readyCheckpoint);
const compatibleDrift = analyzeWorkspaceDrift(readyCheckpoint, commandWorkspace);
assert.equal(compatibleDrift.status, 'COMPATIBLE');
assert.equal(compatibleDrift.resumePossible, true);
assert.equal(compatibleDrift.fingerprintMatches, true);
assert.equal(Object.isFrozen(compatibleDrift), true);
assert.equal(JSON.stringify(readyCheckpoint), checkpointBeforeDrift);

const driftVersionWorkspace = Object.freeze({ ...commandWorkspace, contextVersion: commandWorkspace.contextVersion + 1 }) as WorkspaceContext;
const versionDrift = analyzeWorkspaceDrift(readyCheckpoint, driftVersionWorkspace);
assert.equal(versionDrift.status, 'INCOMPATIBLE');
assert.deepEqual(versionDrift.reasons, ['WorkspaceVersionChanged']);

const packageIndex = commandWorkspace.files.findIndex((file) => file.relativePath.toLowerCase() === 'package.json');
assert.notEqual(packageIndex, -1);
const criticalFilesForDrift = commandWorkspace.files.map((file, index) => index === packageIndex ? Object.freeze({ ...file, hash: `${file.hash}-modified` }) : file);
const criticalWorkspace = Object.freeze({ ...commandWorkspace, files: Object.freeze(criticalFilesForDrift) }) as WorkspaceContext;
const criticalDrift = analyzeWorkspaceDrift(readyCheckpoint, criticalWorkspace);
assert.equal(criticalDrift.status, 'INCOMPATIBLE');
assert.equal(criticalDrift.reasons.includes('FingerprintMismatch'), true);
assert.equal(criticalDrift.reasons.includes('PackageManifestChanged'), true);
assert.equal(criticalDrift.reasons.includes('CriticalFileModified'), true);
assert.equal(criticalDrift.modifiedFiles.includes('package.json'), true);

const addedWorkspaceFile = Object.freeze({ relativePath: 'src/new-file.ts', extension: '.ts', language: 'TypeScript' as const, size: 1, hash: 'new-hash', lastModified: 1, ignored: false, important: false });
const addedWorkspace = Object.freeze({ ...commandWorkspace, files: Object.freeze([...commandWorkspace.files, addedWorkspaceFile]) }) as WorkspaceContext;
const addedDrift = analyzeWorkspaceDrift(readyCheckpoint, addedWorkspace);
assert.equal(addedDrift.reasons.includes('FileAdded'), true);
assert.deepEqual(addedDrift.addedFiles, ['src/new-file.ts']);

const removableFile = commandWorkspace.files.find((file) => file.relativePath !== 'package.json');
assert.ok(removableFile);
const removedWorkspace = Object.freeze({ ...commandWorkspace, files: Object.freeze(commandWorkspace.files.filter((file) => file.relativePath !== removableFile.relativePath)) }) as WorkspaceContext;
const removedDrift = analyzeWorkspaceDrift(readyCheckpoint, removedWorkspace);
assert.equal(removedDrift.reasons.includes('FileRemoved'), true);
assert.equal(removedDrift.removedFiles.includes(removableFile.relativePath), true);

const renamedWorkspace = Object.freeze({ ...commandWorkspace, files: Object.freeze(commandWorkspace.files.map((file) => file.relativePath === removableFile.relativePath ? Object.freeze({ ...file, relativePath: `${file.relativePath}.renamed` }) : file)) }) as WorkspaceContext;
const renameDrift = analyzeWorkspaceDrift(readyCheckpoint, renamedWorkspace);
assert.deepEqual(renameDrift.renamedFiles, [{ from: removableFile.relativePath, to: `${removableFile.relativePath}.renamed` }]);

const ignoredOnlyWorkspace = Object.freeze({ ...commandWorkspace, ignoredFiles: Object.freeze([...commandWorkspace.ignoredFiles, 'ignored.tmp']) }) as WorkspaceContext;
assert.equal(analyzeWorkspaceDrift(readyCheckpoint, ignoredOnlyWorkspace).status, 'COMPATIBLE');
const schemaDriftCheckpoint = Object.freeze({ ...readyCheckpoint, checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION + 1 }) as TaskCheckpoint;
assert.deepEqual(analyzeWorkspaceDrift(schemaDriftCheckpoint, commandWorkspace).reasons, ['SchemaMismatch']);
const unknownDrift = analyzeWorkspaceDrift(readyCheckpoint, Object.freeze({ ...commandWorkspace, workspaceRoot: '', files: Object.freeze([]) }) as WorkspaceContext);
assert.equal(unknownDrift.status, 'UNKNOWN');
assert.equal(unknownDrift.resumePossible, false);
assert.deepEqual(unknownDrift.reasons, ['UnknownWorkspace']);
console.log('workspace drift detection tests passed');

const gitContextVariant = (detail: Partial<GitRepositoryContext> = {}): GitRepositoryContext => Object.freeze({
  ...commandWorkspace.gitContext,
  repositoryDetected: true,
  repositoryRoot: commandWorkspace.workspaceRoot,
  workspaceRoot: commandWorkspace.workspaceRoot,
  workspaceInsideRepository: true,
  currentBranch: 'main',
  detachedHead: false,
  headCommit: 'aaaaaaaaaaaaaaaa',
  workingTreeState: 'CLEAN',
  stagedFiles: Object.freeze([]),
  unstagedFiles: Object.freeze([]),
  untrackedFiles: Object.freeze([]),
  conflictedFiles: Object.freeze([]),
  changedPaths: Object.freeze([]),
  upstreamConfigured: false,
  upstreamName: null,
  aheadCount: null,
  behindCount: null,
  inspectionStatus: 'SUCCESS',
  failureReason: null,
  ...detail,
}) as GitRepositoryContext;
const gitBaselineWorkspace = Object.freeze({ ...commandWorkspace, gitRepository: true, gitContext: gitContextVariant() }) as WorkspaceContext;
const gitBaselineCreated = createTaskCheckpoint({
  checkpointId: 'git-checkpoint', taskId: 'git-task', taskState: 'RUNNING', pipelineStage: 'ToolExecution',
  completedStages: ['Preview', 'Planning', 'Runtime', 'ToolExecution'], startedAt: 1, updatedAt: 2, workspace: gitBaselineWorkspace,
  toolExecutionState: { completedBatches: 4, completedToolNames: ['write_file'], elapsedMs: 10 },
});
const gitBaselineCheckpoint = transitionCheckpoint(gitBaselineCreated, 'READY', 3);
assert.equal(analyzeWorkspaceDrift(gitBaselineCheckpoint, gitBaselineWorkspace).status, 'COMPATIBLE');

const gitDrift = (gitContext: GitRepositoryContext) => analyzeWorkspaceDrift(gitBaselineCheckpoint, Object.freeze({ ...gitBaselineWorkspace, gitContext, gitRepository: gitContext.repositoryDetected }) as WorkspaceContext);
const nonGitContext = gitContextVariant({
  repositoryDetected: false, repositoryRoot: null, workspaceInsideRepository: false, currentBranch: null,
  headCommit: null, workingTreeState: 'NOT_A_REPOSITORY', inspectionStatus: 'SUCCESS', failureReason: 'NotARepository',
});
assert.equal(gitDrift(nonGitContext).reasons.includes('GitRepositoryChanged'), true);
assert.equal(gitDrift(gitContextVariant({ repositoryRoot: path.dirname(commandWorkspace.workspaceRoot) })).reasons.includes('GitRepositoryRootChanged'), true);
assert.equal(gitDrift(gitContextVariant({ headCommit: 'bbbbbbbbbbbbbbbb' })).reasons.includes('GitHeadChanged'), true);
assert.equal(gitDrift(gitContextVariant({ currentBranch: 'feature/safe' })).reasons.includes('GitBranchChanged'), true);
assert.equal(gitDrift(gitContextVariant({ detachedHead: true, currentBranch: null, workingTreeState: 'DETACHED_HEAD', failureReason: 'DetachedHead', inspectionStatus: 'PARTIAL' })).reasons.includes('GitDetachedHeadChanged'), true);
const dirtyChangedPath = Object.freeze({ path: 'untracked.txt', originalPath: null, statuses: Object.freeze(['UNTRACKED'] as const) });
const dirtyGitContext = gitContextVariant({ workingTreeState: 'DIRTY', untrackedFiles: Object.freeze(['untracked.txt']), changedPaths: Object.freeze([dirtyChangedPath]) });
assert.equal(gitDrift(dirtyGitContext).reasons.includes('GitWorkingTreeChanged'), true);
const conflictChangedPath = Object.freeze({ path: 'conflict.ts', originalPath: null, statuses: Object.freeze(['CONFLICTED'] as const) });
const conflictGitContext = gitContextVariant({ workingTreeState: 'CONFLICTED', conflictedFiles: Object.freeze(['conflict.ts']), changedPaths: Object.freeze([conflictChangedPath]) });
assert.equal(gitDrift(conflictGitContext).reasons.includes('GitConflictDetected'), true);
const unavailableGitContext = gitContextVariant({ workingTreeState: 'UNAVAILABLE', inspectionStatus: 'FAILED', failureReason: 'InspectionTimedOut' });
const unavailableGitDrift = gitDrift(unavailableGitContext);
assert.equal(unavailableGitDrift.status, 'UNKNOWN');
assert.deepEqual(unavailableGitDrift.reasons, ['GitContextUnavailable']);

const nonGitWorkspace = Object.freeze({ ...commandWorkspace, gitRepository: false, gitContext: nonGitContext }) as WorkspaceContext;
const nonGitCheckpoint = transitionCheckpoint(createTaskCheckpoint({
  checkpointId: 'non-git-checkpoint', taskId: 'non-git-task', taskState: 'RUNNING', pipelineStage: 'ToolExecution',
  completedStages: ['ToolExecution'], startedAt: 1, updatedAt: 2, workspace: nonGitWorkspace,
}), 'READY', 3);
assert.equal(analyzeWorkspaceDrift(nonGitCheckpoint, nonGitWorkspace).status, 'COMPATIBLE');
assert.equal(analyzeWorkspaceDrift(nonGitCheckpoint, gitBaselineWorkspace).reasons.includes('GitRepositoryChanged'), true);
const fingerprintAndGit = analyzeWorkspaceDrift(gitBaselineCheckpoint, Object.freeze({ ...gitBaselineWorkspace, files: fingerprintChangedWorkspace.files }) as WorkspaceContext);
assert.equal(fingerprintAndGit.reasons.includes('FingerprintMismatch'), true);

let gitResumePermissions = 0; let gitResumeWrites = 0;
const gitResumeRejected = await createSafeResumeCoordinator({
  storage: { load: async () => gitBaselineCheckpoint, save: async () => { gitResumeWrites++; } },
  workspace: () => Object.freeze({ ...gitBaselineWorkspace, gitContext: gitContextVariant({ headCommit: 'cccccccccccccccc' }) }) as WorkspaceContext,
  revalidatePermissions: async () => { gitResumePermissions++; return 'REVALIDATED'; },
}).resume(gitBaselineCheckpoint.taskId);
assert.equal(gitResumeRejected.status, 'RESUME_REJECTED');
assert.equal(gitResumeRejected.workspaceStatus, 'INCOMPATIBLE');
assert.equal(gitResumePermissions, 0);
assert.equal(gitResumeWrites, 0);
assert.equal(gitBaselineCheckpoint.toolExecutionState.completedBatches, 4);
console.log('Git checkpoint, drift, and safe resume integration tests passed');

const resumeCheckpoint = Object.freeze({
  ...readyCheckpoint,
  completedStages: Object.freeze(['Preview', 'Planning', 'Runtime', 'ToolExecution']),
  remainingStages: Object.freeze(['Validation', 'Reviewer', 'Rendering', 'Cleanup']),
  pipelineStage: 'ToolExecution',
  validationState: Object.freeze({ ...readyCheckpoint.validationState, status: 'NOT_RUN', resultNames: Object.freeze(['npm run build']) }),
  reviewState: Object.freeze({ ...readyCheckpoint.reviewState, status: 'NOT_RUN' }),
  toolExecutionState: Object.freeze({ completedBatches: 3, completedToolNames: Object.freeze(['write_file']), elapsedMs: 25 }),
}) as TaskCheckpoint;
const resumeCheckpointBefore = JSON.stringify(resumeCheckpoint);
const resumedWrites: TaskCheckpoint[] = [];
const resumedStages: string[] = [];
let resumeNow = 3000;
const resumed = await createSafeResumeCoordinator({
  storage: { load: async () => resumeCheckpoint, save: async (value) => { resumedWrites.push(value); } },
  workspace: () => commandWorkspace,
  createRuntimeId: () => 'resume-runtime-1',
  now: () => ++resumeNow,
  revalidatePermissions: async (_context, stage) => { resumedStages.push(`permission:${stage}`); return 'REVALIDATED'; },
  runValidation: async () => { resumedStages.push('Validation'); return 'PASSED'; },
  runReviewer: async () => { resumedStages.push('Reviewer'); return 'PASSED'; },
  runRendering: async () => { resumedStages.push('Rendering'); },
  runCleanup: async () => { resumedStages.push('Cleanup'); },
}).resume(resumeCheckpoint.taskId);
assert.equal(resumed.status, 'RESUMED');
assert.equal(resumed.runtimeId, 'resume-runtime-1');
assert.equal(resumed.resumeStage, 'Validation');
assert.equal(resumed.workspaceStatus, 'COMPATIBLE');
assert.equal(resumed.permissionStatus, 'REVALIDATED');
assert.equal(resumed.validationStatus, 'PASSED');
assert.deepEqual(resumedStages, ['permission:Validation', 'Validation', 'Reviewer', 'Rendering', 'Cleanup']);
assert.equal(resumedWrites.at(-1)?.checkpointState, 'COMPLETED');
assert.equal(resumedWrites.every((value) => value.taskId === resumeCheckpoint.taskId && value.checkpointId === resumeCheckpoint.checkpointId), true);
assert.equal(resumedWrites.every((value) => value.toolExecutionState.completedBatches === 3), true);
assert.equal(JSON.stringify(resumeCheckpoint), resumeCheckpointBefore);
assert.equal(Object.isFrozen(resumed), true);

async function resumeFrom(checkpointValue: TaskCheckpoint): Promise<{ outcome: Awaited<ReturnType<ReturnType<typeof createSafeResumeCoordinator>['resume']>>; stages: string[] }> {
  const stages: string[] = [];
  const outcome = await createSafeResumeCoordinator({
    storage: { load: async () => checkpointValue, save: async () => undefined },
    workspace: () => commandWorkspace,
    createRuntimeId: () => 'resume-boundary',
    now: () => 4000,
    revalidatePermissions: async (_context, stage) => { stages.push(`permission:${stage}`); return 'REVALIDATED'; },
    runValidation: async () => { stages.push('Validation'); return 'PASSED'; },
    runReviewer: async () => { stages.push('Reviewer'); return 'PASSED'; },
    runRendering: async () => { stages.push('Rendering'); },
    runCleanup: async () => { stages.push('Cleanup'); },
  }).resume(checkpointValue.taskId);
  return { outcome, stages };
}

const reviewerResumeCheckpoint = Object.freeze({
  ...resumeCheckpoint,
  completedStages: Object.freeze([...resumeCheckpoint.completedStages, 'Validation']),
  remainingStages: Object.freeze(['Reviewer', 'Rendering', 'Cleanup']),
  pipelineStage: 'Validation',
  validationState: Object.freeze({ ...resumeCheckpoint.validationState, status: 'PASSED' }),
}) as TaskCheckpoint;
const reviewerResume = await resumeFrom(reviewerResumeCheckpoint);
assert.equal(reviewerResume.outcome.resumeStage, 'Reviewer');
assert.equal(reviewerResume.outcome.validationStatus, 'REUSED');
assert.deepEqual(reviewerResume.stages, ['permission:Reviewer', 'Reviewer', 'Rendering', 'Cleanup']);

const renderingResumeCheckpoint = Object.freeze({
  ...reviewerResumeCheckpoint,
  completedStages: Object.freeze([...reviewerResumeCheckpoint.completedStages, 'Reviewer']),
  remainingStages: Object.freeze(['Rendering', 'Cleanup']),
  pipelineStage: 'Reviewer',
  reviewState: Object.freeze({ ...reviewerResumeCheckpoint.reviewState, status: 'PASSED' }),
}) as TaskCheckpoint;
const renderingResume = await resumeFrom(renderingResumeCheckpoint);
assert.equal(renderingResume.outcome.resumeStage, 'Rendering');
assert.equal(renderingResume.outcome.reviewStatus, 'REUSED');
assert.deepEqual(renderingResume.stages, ['permission:Rendering', 'Rendering', 'Cleanup']);

for (const terminal of [
  transitionCheckpoint(resumeCheckpoint, 'COMPLETED', 5000),
  transitionCheckpoint(resumeCheckpoint, 'INVALID', 5000, 'CORRUPTED_CHECKPOINT'),
  transitionCheckpoint(resumeCheckpoint, 'OBSOLETE', 5000),
]) {
  let rejectedWrites = 0;
  const terminalBefore = JSON.stringify(terminal);
  const outcome = await createSafeResumeCoordinator({
    storage: { load: async () => terminal, save: async () => { rejectedWrites++; } },
    workspace: () => commandWorkspace,
    revalidatePermissions: async () => 'REVALIDATED',
  }).resume(terminal.taskId);
  assert.equal(outcome.status, 'RESUME_REJECTED');
  assert.equal(outcome.errorCode, 'CheckpointStateIneligible');
  assert.equal(rejectedWrites, 0);
  assert.equal(JSON.stringify(terminal), terminalBefore);
}

let incompatiblePermissionChecks = 0;
const incompatibleResume = await createSafeResumeCoordinator({
  storage: { load: async () => resumeCheckpoint, save: async () => { throw new Error('must not save'); } },
  workspace: () => driftVersionWorkspace,
  revalidatePermissions: async () => { incompatiblePermissionChecks++; return 'REVALIDATED'; },
}).resume(resumeCheckpoint.taskId);
assert.equal(incompatibleResume.errorCode, 'WorkspaceIncompatible');
assert.equal(incompatiblePermissionChecks, 0);

const unknownResume = await createSafeResumeCoordinator({
  storage: { load: async () => resumeCheckpoint, save: async () => { throw new Error('must not save'); } },
  workspace: () => Object.freeze({ ...commandWorkspace, workspaceRoot: '', files: Object.freeze([]) }) as WorkspaceContext,
  revalidatePermissions: async () => 'REVALIDATED',
}).resume(resumeCheckpoint.taskId);
assert.equal(unknownResume.errorCode, 'WorkspaceUnknown');

let deniedWrites = 0;
const deniedResume = await createSafeResumeCoordinator({
  storage: { load: async () => resumeCheckpoint, save: async () => { deniedWrites++; } },
  workspace: () => commandWorkspace,
  revalidatePermissions: async () => 'DENIED',
}).resume(resumeCheckpoint.taskId);
assert.equal(deniedResume.errorCode, 'PermissionRevalidationFailed');
assert.equal(deniedResume.permissionStatus, 'DENIED');
assert.equal(deniedWrites, 0);

let failedResumeWrites = 0;
const failedResumeBefore = JSON.stringify(resumeCheckpoint);
const failedResume = await createSafeResumeCoordinator({
  storage: { load: async () => resumeCheckpoint, save: async () => { failedResumeWrites++; } },
  workspace: () => commandWorkspace,
  revalidatePermissions: async (context) => {
    assert.equal(context.checkpoint.permissionState.approvalsPreviouslyGranted, false);
    assert.equal(context.checkpoint.permissionState.validUntil, null);
    return 'REVALIDATED';
  },
  runValidation: async () => 'FAILED',
  runReviewer: async () => 'PASSED',
  runRendering: async () => undefined,
  runCleanup: async () => undefined,
}).resume(resumeCheckpoint.taskId);
assert.equal(failedResume.status, 'RESUME_REJECTED');
assert.equal(failedResume.validationStatus, 'FAILED');
assert.equal(failedResumeWrites, 0);
assert.equal(JSON.stringify(resumeCheckpoint), failedResumeBefore);

const unsafeResume = await createSafeResumeCoordinator({
  storage: { load: async () => readyCheckpoint, save: async () => { throw new Error('must not save'); } },
  workspace: () => commandWorkspace,
  revalidatePermissions: async () => 'REVALIDATED',
}).resume(readyCheckpoint.taskId);
assert.equal(unsafeResume.errorCode, 'UnsafeResumeBoundary');
console.log('safe operator-controlled resume tests passed');

const builderPolicy = createBuilderToolPolicy();
assert.equal(enforceBuilderToolPolicy(builderPolicy, 'read_file', { path: 'src/App.tsx' }), null);
assert.equal(builderPolicy.forceWrite, true);
assert.match(enforceBuilderToolPolicy(builderPolicy, 'read_file', { path: 'src/App.tsx' }) || '', /already read|write/i);
assert.match(enforceBuilderToolPolicy(builderPolicy, 'run_command', { command: 'grep headline src/App.tsx' }) || '', /write/i);
assert.equal(enforceBuilderToolPolicy(builderPolicy, 'edit_file', { path: 'src/App.tsx' }), null);
assert.equal(builderPolicy.writes, 1);

const boundedExploration = createBuilderToolPolicy();
assert.equal(enforceBuilderToolPolicy(boundedExploration, 'read_file', { path: 'src/App.tsx' }), null);
assert.match(enforceBuilderToolPolicy(boundedExploration, 'read_file', { path: 'src/main.tsx' }) || '', /write/i);
assert.equal(enforceBuilderToolPolicy(boundedExploration, 'write_file', { path: 'src/App.tsx' }), null);
console.log('builder mandatory-write policy tests passed');

assert.equal(resolveWorkspacePath('src').startsWith(process.cwd()), true);
assert.throws(() => resolveWorkspacePath('../outside-workspace.txt'), /outside the workspace/);
assert.throws(() => resolveWorkspacePath('.env'), /protected path/);

const result = await executeTool('read_file', { path: '../outside-workspace.txt' });
assert.match(result, /outside the workspace/);

console.log('workspace and tool safety tests passed');

const executorTestPath = 'test/.runtime-tool-executor.tmp.txt';
const executorTestFullPath = path.resolve(process.cwd(), executorTestPath);
const writeTool = tools.find((tool) => tool.name === 'write_file');
const editTool = tools.find((tool) => tool.name === 'edit_file');
assert.ok(writeTool);
assert.ok(editTool);
const writeResult = await writeTool.execute({ path: executorTestPath, content: 'before' });
assert.match(writeResult, /^File written:/);
assert.equal(fs.readFileSync(executorTestFullPath, 'utf8'), 'before');
const editResult = await editTool.execute({ path: executorTestPath, old_text: 'before', new_text: 'after' });
assert.match(editResult, /^File edited:/);
assert.equal(fs.readFileSync(executorTestFullPath, 'utf8'), 'after');
fs.writeFileSync(executorTestFullPath, 'latest', 'utf8');
const staleEditResult = await editTool.execute({ path: executorTestPath, old_text: 'after', new_text: 'stale overwrite' });
assert.match(staleEditResult, /old_text was not found/);
assert.equal(fs.readFileSync(executorTestFullPath, 'utf8'), 'latest');
fs.rmSync(executorTestFullPath, { force: true });
console.log('tool executor fresh-file-state tests passed');

const runtimePlan: ExecutionPlan = {
  filesToCreate: [],
  filesToModify: [],
  requirements: ['Navbar'],
  validationCommands: [],
  successCriteria: ['No pending requirements'],
};
const runtime = createExecutionRuntime(runtimePlan);
assert.equal(runtime.state.status, 'NEEDS_USER_INPUT');
assert.equal(runtime.beginRepair(), true);
assert.equal(runtime.beginRepair(), true);
assert.equal(runtime.beginRepair(), true);
assert.equal(runtime.beginRepair(), false);
runtime.inspect({ implementedRequirements: ['Navbar'] });
runtime.completeStep('requirement:Navbar');
assert.equal(runtime.finish(), 'SUCCESS');
assert.ok(['npm', 'pnpm', 'yarn', 'bun'].includes(detectPackageManager()));
console.log('execution runtime contract tests passed');

const pendingModifyRuntime = createExecutionRuntime({
  filesToCreate: [],
  filesToModify: ['src/App.tsx'],
  requirements: [],
  validationCommands: ['npm run build'],
  successCriteria: [],
});
assert.deepEqual(pendingModifyRuntime.state.pendingSteps, ['modify:src/App.tsx']);
// A read-only or prose model response does not call inspect, so the modify action remains pending.
assert.equal(pendingModifyRuntime.state.pendingSteps.includes('modify:src/App.tsx'), true);
// A verified edit/write result is the only event that completes the planned action.
pendingModifyRuntime.inspect({ filesModified: ['src/App.tsx'] });
assert.equal(pendingModifyRuntime.state.pendingSteps.includes('modify:src/App.tsx'), false);
assert.deepEqual(pendingModifyRuntime.state.filesModified, ['src/App.tsx']);
console.log('runtime pending file-action tests passed');

assert.equal(parseExecutionPlan('{"files":[]}').success, false);
assert.equal(parseExecutionPlan('prose {"files":[]}').success, false);
const snapshot = createProjectSnapshot();
const structured = parseExecutionPlan(JSON.stringify({
  summary: 'test', framework: null, packageManager: 'npm', files: [], commands: [], requirements: [], validationCommands: [],
  userConstraints: { allowedFiles: ['src/App.tsx'], forbiddenFiles: [], allowDependencyInstall: false, allowNewFiles: false }, risks: [], estimatedMinutes: 1,
}));
assert.equal(structured.success, true);
if (structured.success) assert.deepEqual(validateExecutionPlan(structured.plan, snapshot), []);
const plannerSchemaBase = {
  summary: 'schema normalization', framework: null, packageManager: 'npm', files: [], commands: [], requirements: [], validationCommands: [],
  userConstraints: { allowedFiles: ['src/App.tsx'], forbiddenFiles: [], allowDependencyInstall: false, allowNewFiles: false }, estimatedMinutes: 1,
};
const risksStringPlan = parseExecutionPlan(JSON.stringify({ ...plannerSchemaBase, risks: 'Low risk.' }));
assert.equal(risksStringPlan.success, true);
if (risksStringPlan.success) assert.deepEqual(risksStringPlan.plan.risks, ['Low risk.']);
const risksMissingPlan = parseExecutionPlan(JSON.stringify(plannerSchemaBase));
assert.equal(risksMissingPlan.success, true);
if (risksMissingPlan.success) assert.deepEqual(risksMissingPlan.plan.risks, []);
const risksArrayPlan = parseExecutionPlan(JSON.stringify({ ...plannerSchemaBase, risks: ['Low risk.', 'Review copy.'] }));
assert.equal(risksArrayPlan.success, true);
if (risksArrayPlan.success) assert.deepEqual(risksArrayPlan.plan.risks, ['Low risk.', 'Review copy.']);
assert.equal(parseExecutionPlan(JSON.stringify({ ...plannerSchemaBase, files: { path: 'src/App.tsx' }, risks: [] })).success, false);
assert.equal(parseExecutionPlan(JSON.stringify({ ...plannerSchemaBase, userConstraints: [], risks: [] })).success, false);
console.log('planner schema normalization tests passed');
console.log('structured execution plan tests passed');

const controller = new RuntimeController();
controller.transition('ANALYZING');
controller.transition('PLANNING');
if (structured.success) {
  controller.setPlan(structured.plan);
  controller.transition('EXECUTING');
  controller.transition('VERIFYING');
  controller.recordValidation({ name: 'build', passed: true });
  controller.finish('SUCCESS');
}
assert.equal(controller.state.status, 'SUCCESS');
assert.throws(() => new RuntimeController().transition('SUCCESS'), /Invalid runtime transition/);
assert.equal(new RuntimeController().beginRepair(), true);
const eventController = new RuntimeController();
eventController.transition('ANALYZING');
eventController.setPhase('EXPLORE');
eventController.recordEvent('tool_request', { name: 'read_file' });
eventController.setPhase('PLAN');
assert.equal(eventController.events.some((event) => event.type === 'tool_request' && event.phase === 'EXPLORE'), true);
assert.equal(eventController.events.some((event) => event.type === 'phase' && event.phase === 'PLAN'), true);
console.log('runtime controller tests passed');

const goldenSnapshot = {
  root: process.cwd(), framework: 'react-vite', language: 'typescript' as const, packageManager: 'npm' as const,
  sourceDir: 'src', entryFile: 'src/main.tsx', appFile: 'src/App.tsx', styleFile: 'src/App.css',
  scripts: { build: 'vite build' }, configFiles: ['vite.config.ts'], hasPackageJson: true, isEmpty: false,
};
const goldenPlan = {
  summary: 'golden path', framework: 'react-vite', packageManager: 'npm' as const, files: [
    { path: 'src/App.tsx', action: 'modify' as const, purpose: 'page' },
    { path: 'src/App.css', action: 'modify' as const, purpose: 'styles' },
  ], commands: [], requirements: [], validationCommands: [{ command: 'npm run build', cwd: '.', purpose: 'build', required: true }],
  userConstraints: { allowedFiles: ['src/App.tsx', 'src/App.css'], forbiddenFiles: [], allowDependencyInstall: false, allowNewFiles: false }, risks: [], estimatedMinutes: 5,
};
console.log('general runtime plan tests passed');

const constrainedPlan = { ...goldenPlan, files: [...goldenPlan.files, { path: 'src/components/Navbar.tsx', action: 'create' as const, purpose: 'navbar' }] };
const constraintErrors = validateExecutionPlan(constrainedPlan, goldenSnapshot);
assert.match(constraintErrors.join(' | '), /not allowed|New file not allowed/);
assert.match(validateExecutionPlan({ ...goldenPlan, files: [{ path: 'src/App.tsx', action: 'create' as const, purpose: 'replacement' }] }, goldenSnapshot).join(' | '), /New file not allowed/);
console.log('planner constraint regression tests passed');

const verificationController = new RuntimeController();
verificationController.transition('ANALYZING');
verificationController.transition('PLANNING');
verificationController.setPlan(goldenPlan);
verificationController.transition('EXECUTING');
verificationController.recordFile('src/App.tsx', 'modify');
verificationController.recordFile('src/App.css', 'modify');
verificationController.transition('VERIFYING');
verificationController.recordValidation({ name: 'npm run build', passed: true, output: 'built' });
verificationController.recordStep('validation:npm run build');
for (const requirement of goldenPlan.requirements) verificationController.recordStep(`requirement:${requirement.id}`);
assert.equal(verificationController.state.validationResults.find((result) => result.name === 'npm run build')?.passed, true);
assert.equal(verificationController.state.pendingSteps.some((step) => step === 'validation:npm run build'), false);
verificationController.finish('SUCCESS');
assert.equal(verificationController.state.status, 'SUCCESS');
console.log('build state regression tests passed');

const plannerSnapshotPlans = Array.from({ length: 10 }, (_, index) => ({
  summary: `planner snapshot ${index + 1}`,
  framework: 'react-vite',
  packageManager: 'npm' as const,
  files: [{ path: 'src/App.tsx', action: 'modify' as const, purpose: 'page' }],
  commands: [],
  requirements: [{
    id: `REQ-${index + 1}`,
    description: 'App exists',
    verification: { type: 'file_exists' as const, path: 'src/App.tsx' },
  }],
  validationCommands: [{ command: 'npm run build', cwd: '.', purpose: 'build', required: true }],
  userConstraints: { allowedFiles: ['src/App.tsx'], forbiddenFiles: [], allowDependencyInstall: false, allowNewFiles: false },
  risks: [],
  estimatedMinutes: 1,
}));

for (const plan of plannerSnapshotPlans) {
  assert.equal(executionPlanSchema.safeParse(plan).success, true);
  assert.equal(parseExecutionPlan(JSON.stringify(plan)).success, true);
}
assert.match(ZOE_STRUCTURED_PLAN_PROMPT, /verification MUST be an object/i);
assert.match(ZOE_STRUCTURED_PLAN_PROMPT, /userConstraints MUST be an object/i);
console.log('planner snapshot tests passed (10/10)');

const intent = extractUserIntent(`Create a landing page.\nModify only:\n- src/App.tsx\n- src/App.css\nDo not create files.\nDo not install dependencies.\nRun npm run build.`, process.cwd());
assert.deepEqual(intent.constraints.allowedFiles.sort(), ['src/App.css', 'src/App.tsx']);
assert.equal(intent.constraints.allowNewFiles, false);
assert.equal(intent.constraints.allowDependencyInstall, false);
assert.deepEqual(intent.constraints.requiredValidationCommands, ['npm run build']);
const exactIntent = extractUserIntent(`Change only the main headline in src/App.tsx to:\n\nBuild with confidence.\n\nDo not modify any other file.\nRun npm run build.`, process.cwd());
assert.deepEqual(exactIntent.requestedChanges, [{ file: 'src/App.tsx', operation: 'replace_headline', exactValue: 'Build with confidence.' }]);
assert.equal(exactIntent.originalRequest.includes('Build with confidence.'), true);
assert.equal(exactIntent.originalUserPrompt.raw, `Change only the main headline in src/App.tsx to:\n\nBuild with confidence.\n\nDo not modify any other file.\nRun npm run build.`);
const quotedPrompt = `Change only the main headline in src/App.tsx to: "Build with confidence."\n\n- preserve this list\n\n\`\`\`tsx\nconst value = 'Build with confidence.';\n\`\`\``;
const quotedIntent = extractUserIntent(quotedPrompt, process.cwd());
assert.equal(quotedIntent.requestedChanges[0].exactValue, 'Build with confidence.');
assert.equal(quotedIntent.originalUserPrompt.raw, quotedPrompt);
const markdownPrompt = `Change only the main headline in src/App.tsx to:\n\n\`\`\`\nBuild with confidence.\n\`\`\`\n\n- item one\n- item two`;
const markdownIntent = extractUserIntent(markdownPrompt, process.cwd());
assert.equal(markdownIntent.requestedChanges[0].exactValue, 'Build with confidence.');
assert.equal(markdownIntent.originalUserPrompt.raw, markdownPrompt);
const exactPlan = enforceRequestedChanges({ requirements: [], requestedChanges: [] }, exactIntent.requestedChanges);
assert.equal(exactPlan.requestedChanges[0].exactValue, 'Build with confidence.');
assert.deepEqual(exactPlan.requirements[0].verification, { type: 'file_contains', path: 'src/App.tsx', patterns: ['Build with confidence.'] });
const weakenedPlan = JSON.stringify({ ...goldenPlan, userConstraints: { allowedFiles: [], forbiddenFiles: [], allowDependencyInstall: true, allowNewFiles: true } });
const authoritativePlan = parseExecutionPlan(weakenedPlan, intent.constraints);
assert.equal(authoritativePlan.success, true);
if (authoritativePlan.success) {
  assert.deepEqual(authoritativePlan.plan.userConstraints.allowedFiles.sort(), ['src/App.css', 'src/App.tsx']);
  assert.equal(authoritativePlan.plan.userConstraints.allowNewFiles, false);
  assert.deepEqual(validateRuntimeConstraints(authoritativePlan.plan, intent.constraints), []);
}
const disallowedPlannerPlan = parseExecutionPlan(JSON.stringify({
  ...goldenPlan,
  files: [...goldenPlan.files, { path: 'src/components/New.tsx', action: 'create', purpose: 'disallowed' }],
  userConstraints: { allowedFiles: ['src/components/New.tsx'], forbiddenFiles: [], allowDependencyInstall: true, allowNewFiles: true },
}), intent.constraints);
assert.equal(disallowedPlannerPlan.success, true);
if (disallowedPlannerPlan.success) assert.match(validateExecutionPlan(disallowedPlannerPlan.plan, goldenSnapshot).join(' | '), /New file not allowed|File is not allowed/);
console.log('deterministic user intent tests passed');

assert.equal(parsePermissionDecision('y'), 'approve');
assert.equal(parsePermissionDecision(' YES '), 'approve');
assert.equal(parsePermissionDecision('n'), 'deny');
assert.equal(parsePermissionDecision('No'), 'deny');
assert.equal(parsePermissionDecision('a'), 'always');
assert.equal(parsePermissionDecision('ALWAYS'), 'always');
assert.equal(parsePermissionDecision('yy'), 'invalid');
assert.equal(parsePermissionDecision('yyy'), 'invalid');
assert.equal(parsePermissionDecision('uu'), 'invalid');
assert.equal(parsePermissionDecision('random text'), 'invalid');
console.log('permission parser tests passed');

assert.equal(classifyTask('hola'), 'CHAT_MODE');
assert.equal(classifyTask('Explícame qué hace este proyecto'), 'CHAT_MODE');
assert.equal(classifyTask('Edita src/App.tsx'), 'TASK_MODE');
assert.equal(classifyTask('Crea un archivo README.md'), 'TASK_MODE');
assert.equal(classifyTask('ejecuta npm run build'), 'TASK_MODE');
console.log('task mode classification tests passed');

const streamingEvents: string[] = [];
let delayedProgressActive = false;
let finishCount = 0;
const streamedChunks: string[] = [];
const streamController = new StreamingResponseController({
  startProgress: () => { streamingEvents.push('progress:start'); delayedProgressActive = true; },
  stopProgress: () => { streamingEvents.push('progress:stop'); delayedProgressActive = false; },
  writeContent: (chunk) => { streamingEvents.push(`content:${chunk}`); streamedChunks.push(chunk); },
  finishContent: () => { streamingEvents.push('content:finish'); finishCount++; },
});
streamController.start();
streamController.chunk('Paragraph one.\n\n');
if (delayedProgressActive) streamingEvents.push('progress:delayed-write');
streamController.chunk('| A | B |\n|---|---|\n| 1 | 2 |\n\n');
streamController.chunk('```ts\nconst greeting = "hola";\n```');
const completeStream = streamController.complete();
streamController.complete();
assert.deepEqual(streamingEvents.slice(0, 3), ['progress:start', 'progress:stop', 'content:Paragraph one.\n\n']);
assert.equal(streamingEvents.some((event) => event === 'progress:delayed-write'), false);
assert.equal(streamingEvents.findIndex((event) => event.startsWith('content:')) > streamingEvents.indexOf('progress:stop'), true);
assert.match(completeStream, /Paragraph one\.\n\n\| A \| B \|/);
assert.match(completeStream, /\|---\|---\|\n\| 1 \| 2 \|/);
assert.match(completeStream, /```ts\nconst greeting = "hola";\n```/);
assert.equal(streamedChunks.join(''), completeStream);
assert.equal(finishCount, 1);

const greetingWrites: string[] = [];
const greetingController = new StreamingResponseController({
  startProgress: () => {},
  stopProgress: () => {},
  writeContent: (chunk) => greetingWrites.push(chunk),
  finishContent: () => {},
});
greetingController.start();
greetingController.chunk('¡Hola! ¿En qué te ayudo?');
assert.equal(greetingController.complete(), '¡Hola! ¿En qué te ayudo?');
assert.equal(greetingWrites.join('').trim().length > 0, true);

for (const emptyValue of ['', ' \r\n\t ']) {
  let stopped = 0;
  const emptyController = new StreamingResponseController({
    startProgress: () => {},
    stopProgress: () => { stopped++; },
    writeContent: () => {},
    finishContent: () => {},
  });
  emptyController.start();
  emptyController.chunk(emptyValue);
  assert.throws(() => emptyController.complete(), EmptyModelResponseError);
  assert.equal(stopped > 0, true);
  assert.equal(emptyController.currentState(), 'FAILED');
}

for (const terminalState of ['fail', 'cancel'] as const) {
  let active = false;
  const cleanupController = new StreamingResponseController({
    startProgress: () => { active = true; },
    stopProgress: () => { active = false; },
    writeContent: () => {},
    finishContent: () => {},
  });
  cleanupController.start();
  cleanupController[terminalState]();
  assert.equal(active, false);
  assert.equal(cleanupController.currentState(), terminalState === 'fail' ? 'FAILED' : 'CANCELLED');
}
console.log('streaming response lifecycle tests passed');

const groundedFixture = fs.mkdtempSync(path.join(process.cwd(), 'test', '.grounded-context-'));
try {
  fs.mkdirSync(path.join(groundedFixture, 'src'));
  fs.mkdirSync(path.join(groundedFixture, 'real-directory'));
  fs.writeFileSync(path.join(groundedFixture, 'package.json'), JSON.stringify({
    name: '@nocodeveloper/zoe-cli',
    version: getZoePackageMetadata().version,
    scripts: { test: 'tsx test/workspace.test.ts', build: 'tsc' },
    devDependencies: { typescript: '6.0.3' },
  }));
  fs.writeFileSync(path.join(groundedFixture, 'src', 'index.ts'), 'export {}');
  const groundedContext = new WorkspaceIntelligence(groundedFixture).getContext();
  const groundedDescription = getProjectDescription(groundedContext);
  assert.equal(groundedContext.packageVersion, '0.4.0-alpha.0');
  assert.match(groundedDescription, /Package version: 0\.4\.0-alpha\.0/);
  assert.match(groundedDescription, /\[directory\] real-directory/);
  assert.doesNotMatch(groundedDescription, /\[directory\] database/);
  assert.doesNotMatch(groundedDescription, /Implemented Zoe capabilities:.*memory/i);
  assert.match(groundedDescription, /Available scripts: build, test/);
} finally {
  fs.rmSync(groundedFixture, { recursive: true, force: true });
}
console.log('project-grounded conversational context tests passed');

let authStatus = { authenticated: false, code: 'UNAUTHENTICATED' as const, tokenNearExpiry: false, refreshTokenAvailable: false };
let oauthStarts = 0;
let taskCreations = 0;
const failedAuthGate = createModelAuthGate({
  status: () => authStatus,
  startOAuth: async () => { oauthStarts++; return 'FAILED'; },
});
const unauthenticatedRequest = await runAuthenticatedModelRequest('hola', failedAuthGate, async () => { taskCreations++; return 'answer'; });
assert.equal(unauthenticatedRequest.auth, 'AUTH_REQUIRED');
assert.equal(unauthenticatedRequest.preservedPrompt, 'hola');
assert.equal(taskCreations, 0);

let finishOAuth!: () => void;
const oauthWait = new Promise<void>((resolve) => { finishOAuth = resolve; });
authStatus = { authenticated: false, code: 'UNAUTHENTICATED', tokenNearExpiry: false, refreshTokenAvailable: false };
oauthStarts = 0;
const sharedOAuthGate = createModelAuthGate({
  status: () => authStatus,
  startOAuth: async () => {
    oauthStarts++;
    await oauthWait;
    authStatus = { authenticated: true, tokenNearExpiry: false, refreshTokenAvailable: true };
    return 'COMPLETED';
  },
});
const concurrentAuthA = sharedOAuthGate.authorize(true);
const concurrentAuthB = sharedOAuthGate.authorize(true);
finishOAuth();
assert.deepEqual(await Promise.all([concurrentAuthA, concurrentAuthB]), ['RESUBMIT_REQUIRED', 'RESUBMIT_REQUIRED']);
assert.equal(oauthStarts, 1);

const expiredAuthGate = createModelAuthGate({
  status: () => ({ authenticated: true, tokenNearExpiry: true, refreshTokenAvailable: false }),
  startOAuth: async () => 'FAILED',
});
assert.equal(await expiredAuthGate.authorize(true), 'SESSION_EXPIRED');
const cancelledAuthGate = createModelAuthGate({
  status: () => ({ authenticated: false, code: 'UNAUTHENTICATED', tokenNearExpiry: false, refreshTokenAvailable: false }),
  startOAuth: async () => 'CANCELLED',
});
assert.equal(await cancelledAuthGate.authorize(true), 'OAUTH_CANCELLED');
const authenticatedGate = createModelAuthGate({
  status: () => ({ authenticated: true, tokenNearExpiry: false, refreshTokenAvailable: true }),
  startOAuth: async () => 'FAILED',
});
const authenticatedRequest = await runAuthenticatedModelRequest('hola', authenticatedGate, async (prompt) => { taskCreations++; return `visible:${prompt}`; });
assert.equal(authenticatedRequest.auth, 'AUTHENTICATED');
assert.equal(authenticatedRequest.task, 'visible:hola');
assert.equal(taskCreations, 1);
console.log('model authentication gate tests passed');

const xmlProtocol = '<function_calls><invoke name="read_file"><parameter name="path">package.json</parameter></invoke></function_calls>';
const structuredProtocol = '<tool_calls>[{"name":"read_file","arguments":{"path":"package.json"}}]</tool_calls>';
const xmlInspection = inspectToolProtocolMessage(`I will inspect this.\n${xmlProtocol}`);
assert.equal(xmlInspection.kind, 'TOOL_REQUEST');
assert.equal(xmlInspection.assistantText, '');
assert.equal(xmlInspection.assistantText.includes('package.json'), false);
const structuredInspection = inspectToolProtocolMessage(structuredProtocol);
assert.equal(structuredInspection.kind, 'TOOL_REQUEST');
assert.equal(structuredInspection.assistantText, '');
assert.equal(inspectToolProtocolMessage('<tool_results>{"secret":"internal"}</tool_results>').kind, 'MALFORMED_TOOL_PROTOCOL');
assert.equal(inspectToolProtocolMessage('<tool_calls>[{"name":"read_file"</tool_calls>').kind, 'MALFORMED_TOOL_PROTOCOL');
const harmlessMarkdown = 'Use `<Component<T>>` and compare `a < b` in normal Markdown.';
assert.deepEqual(inspectToolProtocolMessage(harmlessMarkdown), { kind: 'ASSISTANT_MESSAGE', assistantText: harmlessMarkdown });
const simulatedRounds = [structuredProtocol, xmlProtocol, '# Final answer\n\nVisible once.'].map(inspectToolProtocolMessage);
assert.deepEqual(simulatedRounds.map((round) => round.kind), ['TOOL_REQUEST', 'TOOL_REQUEST', 'ASSISTANT_MESSAGE']);
assert.equal(simulatedRounds.filter((round) => round.kind === 'ASSISTANT_MESSAGE').length, 1);
console.log('internal tool protocol boundary tests passed');

const canonicalFixture = fs.mkdtempSync(path.join(process.cwd(), 'test', '.canonical-context-'));
try {
  fs.mkdirSync(path.join(canonicalFixture, 'src'));
  fs.mkdirSync(path.join(canonicalFixture, 'test'));
  fs.writeFileSync(path.join(canonicalFixture, 'package.json'), JSON.stringify({
    name: '@nocodeveloper/zoe-cli',
    version: '0.4.0-alpha.0',
    bin: { zoe: 'dist/cli/index.js' },
    scripts: { test: 'tsx test/workspace.test.ts', build: 'tsc', typecheck: 'tsc --noEmit' },
  }));
  fs.writeFileSync(path.join(canonicalFixture, 'src', 'index.ts'), 'export {}');
  fs.writeFileSync(path.join(canonicalFixture, 'test', 'workspace.test.ts'), 'export {}');
  const canonicalWorkspace = new WorkspaceIntelligence(canonicalFixture, Date.now, () => gitContextVariant({
    repositoryDetected: true,
    repositoryRoot: canonicalFixture,
    workspaceInsideRepository: true,
    workingTreeState: 'CLEAN',
    currentBranch: 'main',
  })).getContext();
  const canonicalFacts = getProjectDescription(canonicalWorkspace);
  const partialToolRead = 'Partial read: {"name":"@nocodeveloper/zoe-cli"}';
  const mergedModelContext = `${canonicalFacts}\n\nPARTIAL TOOL RESULT\n${partialToolRead}`;
  assert.match(mergedModelContext, /Package version: 0\.4\.0-alpha\.0/);
  assert.match(mergedModelContext, /Package bin: zoe -> dist\/cli\/index\.js/);
  assert.match(mergedModelContext, /Available scripts: build, test, typecheck/);
  assert.match(mergedModelContext, /Tests directory: Detected/);
  assert.match(mergedModelContext, /Verified file count: 3/);
  assert.match(mergedModelContext, /Git: CLEAN on main/);
  assert.match(mergedModelContext, /Never contradict VERIFIED FACTS/);
} finally {
  fs.rmSync(canonicalFixture, { recursive: true, force: true });
}
console.log('canonical verified-facts precedence tests passed');

const fakeReadline = new EventEmitter() as EventEmitter & { close(): void };
fakeReadline.close = () => {};
const terminalWrites: string[] = [];
const coordinatedInput = new TerminalInputCoordinator(
  undefined as any,
  { write: (value: string) => { terminalWrites.push(value); return true; } } as any,
  (() => fakeReadline) as any,
);

const invalidMessages: string[] = [];
const permissionRetry = requestPermissionDecision(coordinatedInput, 'Allow? ', (message) => invalidMessages.push(message));
fakeReadline.emit('line', 'invalid');
await Promise.resolve();
await Promise.resolve();
fakeReadline.emit('line', ' y ');
assert.equal(await permissionRetry, 'approve');
assert.deepEqual(invalidMessages, ['Invalid choice. Enter y, n, or a.']);
assert.equal(terminalWrites.filter((value) => value === 'Allow? ').length, 2);
assert.equal(coordinatedInput.activeOwner(), null);
assert.equal(coordinatedInput.ownedLineListenerCount(), 1);

const exclusiveInput = new ExclusiveLineInput();
const permissionLine = exclusiveInput.read('permission');
assert.equal(exclusiveInput.owner(), 'permission');
assert.throws(() => exclusiveInput.read('main'), TerminalInputOwnershipError);
assert.equal(exclusiveInput.submit('y'), true);
assert.equal(await permissionLine, 'y');
assert.equal(exclusiveInput.restorationCount(), 1);
assert.equal(exclusiveInput.submit('y'), false);
assert.equal(exclusiveInput.owner(), null);

let phantomAskTasks = 0;
const cleanMainLine = exclusiveInput.read('main');
assert.equal(exclusiveInput.submit('next request'), true);
if ((await cleanMainLine) === 'y') phantomAskTasks++;
assert.equal(phantomAskTasks, 0);
assert.equal(exclusiveInput.restorationCount(), 2);

for (const [submitted, expected] of [['yes', 'approve'], ['n', 'deny'], ['a', 'always'], ['Y', 'approve']] as const) {
  const decisionPromise = requestPermissionDecision(coordinatedInput, 'Allow? ');
  fakeReadline.emit('line', submitted);
  assert.equal(await decisionPromise, expected);
  assert.equal(coordinatedInput.activeOwner(), null);
  assert.equal(coordinatedInput.ownedLineListenerCount(), 1);
}

const cancelledPermission = coordinatedInput.readLine('permission', 'Allow? ');
assert.equal(coordinatedInput.cancel('permission', new Error('cancelled')), true);
await assert.rejects(cancelledPermission, /cancelled/);
assert.equal(coordinatedInput.activeOwner(), null);
const failedPermission = coordinatedInput.readLine('permission', 'Allow? ');
assert.equal(coordinatedInput.cancel('permission', new Error('tool failed')), true);
await assert.rejects(failedPermission, /tool failed/);
assert.equal(coordinatedInput.activeOwner(), null);

for (let index = 0; index < 20; index++) {
  const successive = requestPermissionDecision(coordinatedInput, 'Allow? ');
  fakeReadline.emit('line', index % 2 === 0 ? 'y' : 'n');
  assert.equal(await successive, index % 2 === 0 ? 'approve' : 'deny');
  assert.equal(coordinatedInput.ownedLineListenerCount(), 1);
}

const structuredSuccessLogs: string[] = [];
const savedSuccessLog = console.log;
console.log = ((message = '') => structuredSuccessLogs.push(String(message))) as typeof console.log;
try {
  renderTaskOutcome({
    code: 'COMPLETED', taskId: 'build-success', mode: 'TASK_MODE', entryPoint: 'chat',
    success: true, verified: true, message: '{"summary":"internal planner JSON"}',
    changedFiles: { created: 1, modified: 0 }, warnings: [],
  });
} finally {
  console.log = savedSuccessLog;
}
assert.equal(structuredSuccessLogs.filter((line) => line.includes('SUCCESS')).length, 1);
assert.equal(structuredSuccessLogs.some((line) => line.includes('internal planner JSON')), false);
assert.equal(structuredSuccessLogs.some((line) => line.includes('COMPLETED_UNVERIFIED')), false);
assert.equal(coordinatedInput.activeOwner(), null);
const restoredMainPrompt = coordinatedInput.readLine('main', '  > ');
fakeReadline.emit('line', 'clean next prompt');
assert.equal(await restoredMainPrompt, 'clean next prompt');
assert.equal(coordinatedInput.activeOwner(), null);
assert.equal(coordinatedInput.ownedLineListenerCount(), 1);
coordinatedInput.close();
assert.equal(coordinatedInput.ownedLineListenerCount(), 0);
console.log('exclusive terminal input and phantom-task regression tests passed');
