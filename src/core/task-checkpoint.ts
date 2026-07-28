import type { TaskLifecycleState } from './task-cancellation.js';
import type { WorkspaceContext } from './workspace-intelligence.js';
import path from 'node:path';
import type { GitFileStatus, GitWorkingTreeState } from './git-awareness.js';

export const CHECKPOINT_SCHEMA_VERSION = 2;
export const PLANNER_CHECKPOINT_VERSION = 1;
export const RUNTIME_CHECKPOINT_VERSION = 1;

export type CheckpointState = 'NOT_CREATED' | 'CREATED' | 'READY' | 'INVALID' | 'OBSOLETE' | 'RESUMED' | 'COMPLETED' | 'DISCARDED';
export type CheckpointPipelineStage = 'Preview' | 'Planning' | 'Runtime' | 'ToolExecution' | 'Validation' | 'Reviewer' | 'Rendering' | 'Cleanup';
export type CheckpointInvalidReason = 'WORKSPACE_FINGERPRINT_CHANGED' | 'WORKSPACE_VERSION_INCOMPATIBLE' | 'SCHEMA_VERSION_MISMATCH' | 'PLANNER_VERSION_MISMATCH' | 'RUNTIME_VERSION_MISMATCH' | 'PERMISSION_STATE_EXPIRED' | 'MISSING_REQUIRED_METADATA' | 'CORRUPTED_CHECKPOINT' | 'CHECKPOINT_OBSOLETE' | 'INVALID_STATE';

export interface WorkspaceFingerprint {
  readonly formatVersion: 1;
  readonly workspaceRoot: string;
  readonly contextVersion: number;
  readonly files: readonly Readonly<{ path: string; hash: string; size: number }>[];
}
export interface CheckpointPermissionState { readonly approvalsPreviouslyGranted: boolean; readonly revalidationRequired: true; readonly validUntil: number | null; }
export interface CheckpointValidationState { readonly status: 'NOT_RUN' | 'PASSED' | 'FAILED'; readonly reusableOnlyWithMatchingWorkspace: true; readonly resultNames: readonly string[]; }
export interface CheckpointReviewState { readonly status: 'NOT_RUN' | 'PASSED' | 'BLOCKED'; readonly reusableOnlyWithMatchingWorkspace: true; }
export interface CheckpointToolExecutionState { readonly completedBatches: number; readonly completedToolNames: readonly string[]; readonly elapsedMs: number; }
export interface GitCheckpointSnapshot {
  readonly contextVersion: 1; readonly repositoryDetected: boolean; readonly workspaceInsideRepository: boolean;
  readonly workspaceRelativePath: string | null; readonly branch: string | null; readonly detachedHead: boolean;
  readonly headCommit: string | null; readonly workingTreeState: GitWorkingTreeState;
  readonly stagedCount: number; readonly unstagedCount: number; readonly untrackedCount: number; readonly conflictedCount: number;
  readonly changedPaths: readonly Readonly<{ path: string; originalPath: string | null; statuses: readonly GitFileStatus[] }>[];
}

export interface TaskCheckpoint {
  readonly checkpointId: string; readonly taskId: string; readonly workspaceId: string; readonly workspaceVersion: number;
  readonly checkpointState: CheckpointState; readonly taskState: TaskLifecycleState; readonly pipelineStage: CheckpointPipelineStage;
  readonly completedStages: readonly CheckpointPipelineStage[]; readonly remainingStages: readonly CheckpointPipelineStage[];
  readonly startedAt: number; readonly updatedAt: number; readonly duration: number;
  readonly plannerVersion: number; readonly runtimeVersion: number; readonly checkpointSchemaVersion: number;
  readonly validationState: Readonly<CheckpointValidationState>; readonly reviewState: Readonly<CheckpointReviewState>;
  readonly toolExecutionState: Readonly<CheckpointToolExecutionState>; readonly permissionState: Readonly<CheckpointPermissionState>;
  readonly workspaceFingerprint: Readonly<WorkspaceFingerprint>; readonly gitSnapshot: Readonly<GitCheckpointSnapshot>; readonly resumeEligible: boolean;
  readonly invalidReason: CheckpointInvalidReason | null; readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CreateCheckpointInput {
  checkpointId: string; taskId: string; taskState: TaskLifecycleState; pipelineStage: CheckpointPipelineStage;
  completedStages?: readonly CheckpointPipelineStage[]; startedAt: number; updatedAt: number; workspace: WorkspaceContext;
  plannerVersion?: number; runtimeVersion?: number; checkpointSchemaVersion?: number;
  validationState?: Partial<CheckpointValidationState>; reviewState?: Partial<CheckpointReviewState>;
  toolExecutionState?: Partial<CheckpointToolExecutionState>; permissionState?: Partial<CheckpointPermissionState>;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CheckpointCompatibilityEnvironment {
  workspace: WorkspaceContext; checkpointSchemaVersion?: number; plannerVersion?: number; runtimeVersion?: number; now?: number;
}

export interface ResumeEligibility { readonly eligible: boolean; readonly reason: CheckpointInvalidReason | null; readonly validationReusable: boolean; readonly reviewReusable: boolean; readonly permissionsMustBeReevaluated: true; }

const STAGES: readonly CheckpointPipelineStage[] = ['Preview', 'Planning', 'Runtime', 'ToolExecution', 'Validation', 'Reviewer', 'Rendering', 'Cleanup'];
const TRANSITIONS: Readonly<Record<CheckpointState, readonly CheckpointState[]>> = {
  NOT_CREATED: ['CREATED'], CREATED: ['READY', 'INVALID', 'DISCARDED'], READY: ['INVALID', 'OBSOLETE', 'RESUMED', 'COMPLETED', 'DISCARDED'],
  INVALID: ['DISCARDED'], OBSOLETE: ['DISCARDED'], RESUMED: ['INVALID', 'COMPLETED', 'DISCARDED'], COMPLETED: [], DISCARDED: [],
};
const SENSITIVE = /(api.?key|token|secret|password|credential|authorization|prompt|environment|env)/i;

function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; }
function uniqueStages(stages: readonly CheckpointPipelineStage[]): CheckpointPipelineStage[] { return [...new Set(stages)].filter((stage) => STAGES.includes(stage)); }
function validateMetadata(metadata: Record<string, string | number | boolean | null>): void { for (const key of Object.keys(metadata)) if (SENSITIVE.test(key)) throw new Error(`Checkpoint metadata cannot contain sensitive field: ${key}`); }

export function createWorkspaceFingerprint(workspace: WorkspaceContext): WorkspaceFingerprint {
  return deepFreeze({ formatVersion: 1, workspaceRoot: workspace.workspaceRoot, contextVersion: workspace.contextVersion, files: workspace.files.map((file) => ({ path: file.relativePath, hash: file.hash, size: file.size })).sort((a, b) => a.path.localeCompare(b.path)) });
}

export function createGitCheckpointSnapshot(workspace: WorkspaceContext): GitCheckpointSnapshot {
  const git = workspace.gitContext;
  const workspaceRelativePath = git.repositoryRoot && git.workspaceInsideRepository
    ? path.relative(git.repositoryRoot, workspace.workspaceRoot).replace(/\\/g, '/') || '.'
    : null;
  return deepFreeze({
    contextVersion: git.contextVersion, repositoryDetected: git.repositoryDetected,
    workspaceInsideRepository: git.workspaceInsideRepository, workspaceRelativePath,
    branch: git.currentBranch, detachedHead: git.detachedHead, headCommit: git.headCommit,
    workingTreeState: git.workingTreeState, stagedCount: git.stagedFiles.length,
    unstagedCount: git.unstagedFiles.length, untrackedCount: git.untrackedFiles.length,
    conflictedCount: git.conflictedFiles.length,
    changedPaths: git.changedPaths.map((item) => ({ path: item.path, originalPath: item.originalPath, statuses: [...item.statuses] })),
  });
}

export function workspaceFingerprintsMatch(left: WorkspaceFingerprint, right: WorkspaceFingerprint): boolean {
  if (left.formatVersion !== right.formatVersion || left.workspaceRoot !== right.workspaceRoot || left.files.length !== right.files.length) return false;
  return left.files.every((file, index) => { const other = right.files[index]; return file.path === other.path && file.hash === other.hash && file.size === other.size; });
}

export function createTaskCheckpoint(input: CreateCheckpointInput): TaskCheckpoint {
  if (!input.checkpointId || !input.taskId || !input.workspace.workspaceRoot) throw new Error('Checkpoint requires checkpointId, taskId and workspace metadata.');
  const metadata = input.metadata || {}; validateMetadata(metadata);
  const completedStages = uniqueStages(input.completedStages || []); const remainingStages = STAGES.filter((stage) => !completedStages.includes(stage));
  const checkpoint: TaskCheckpoint = {
    checkpointId: input.checkpointId, taskId: input.taskId, workspaceId: input.workspace.workspaceRoot, workspaceVersion: input.workspace.contextVersion,
    checkpointState: 'CREATED', taskState: input.taskState, pipelineStage: input.pipelineStage, completedStages, remainingStages,
    startedAt: input.startedAt, updatedAt: input.updatedAt, duration: Math.max(0, input.updatedAt - input.startedAt),
    plannerVersion: input.plannerVersion ?? PLANNER_CHECKPOINT_VERSION, runtimeVersion: input.runtimeVersion ?? RUNTIME_CHECKPOINT_VERSION,
    checkpointSchemaVersion: input.checkpointSchemaVersion ?? CHECKPOINT_SCHEMA_VERSION,
    validationState: { status: input.validationState?.status || 'NOT_RUN', reusableOnlyWithMatchingWorkspace: true, resultNames: [...(input.validationState?.resultNames || [])] },
    reviewState: { status: input.reviewState?.status || 'NOT_RUN', reusableOnlyWithMatchingWorkspace: true },
    toolExecutionState: { completedBatches: input.toolExecutionState?.completedBatches || 0, completedToolNames: [...(input.toolExecutionState?.completedToolNames || [])], elapsedMs: input.toolExecutionState?.elapsedMs || 0 },
    permissionState: { approvalsPreviouslyGranted: input.permissionState?.approvalsPreviouslyGranted || false, revalidationRequired: true, validUntil: input.permissionState?.validUntil ?? null },
    workspaceFingerprint: createWorkspaceFingerprint(input.workspace), gitSnapshot: createGitCheckpointSnapshot(input.workspace), resumeEligible: false, invalidReason: null, metadata: { ...metadata },
  };
  return deepFreeze(checkpoint);
}

export function transitionCheckpoint(checkpoint: TaskCheckpoint, next: CheckpointState, updatedAt: number, invalidReason: CheckpointInvalidReason | null = null): TaskCheckpoint {
  if (!TRANSITIONS[checkpoint.checkpointState].includes(next)) throw new Error(`Invalid checkpoint transition: ${checkpoint.checkpointState} -> ${next}`);
  if (next === 'INVALID' && !invalidReason) throw new Error('Invalid checkpoints require an invalidation reason.');
  const resumeEligible = next === 'READY' && checkpoint.invalidReason === null;
  return deepFreeze({ ...checkpoint, checkpointState: next, updatedAt, duration: Math.max(0, updatedAt - checkpoint.startedAt), resumeEligible, invalidReason: next === 'INVALID' ? invalidReason : checkpoint.invalidReason });
}

export function evaluateResumeEligibility(checkpoint: TaskCheckpoint, environment: CheckpointCompatibilityEnvironment): ResumeEligibility {
  let reason: CheckpointInvalidReason | null = null;
  if (!checkpoint.checkpointId || !checkpoint.taskId || !checkpoint.workspaceId) reason = 'MISSING_REQUIRED_METADATA';
  else if (checkpoint.checkpointState === 'OBSOLETE') reason = 'CHECKPOINT_OBSOLETE';
  else if (!['CREATED', 'READY'].includes(checkpoint.checkpointState)) reason = 'INVALID_STATE';
  else if (checkpoint.checkpointSchemaVersion !== (environment.checkpointSchemaVersion ?? CHECKPOINT_SCHEMA_VERSION)) reason = 'SCHEMA_VERSION_MISMATCH';
  else if (checkpoint.plannerVersion !== (environment.plannerVersion ?? PLANNER_CHECKPOINT_VERSION)) reason = 'PLANNER_VERSION_MISMATCH';
  else if (checkpoint.runtimeVersion !== (environment.runtimeVersion ?? RUNTIME_CHECKPOINT_VERSION)) reason = 'RUNTIME_VERSION_MISMATCH';
  else if (checkpoint.permissionState.validUntil !== null && checkpoint.permissionState.validUntil < (environment.now ?? Date.now())) reason = 'PERMISSION_STATE_EXPIRED';
  else if (checkpoint.workspaceVersion !== environment.workspace.contextVersion) reason = 'WORKSPACE_VERSION_INCOMPATIBLE';
  const fingerprintMatches = workspaceFingerprintsMatch(checkpoint.workspaceFingerprint, createWorkspaceFingerprint(environment.workspace));
  if (!reason && !fingerprintMatches) reason = 'WORKSPACE_FINGERPRINT_CHANGED';
  const result = deepFreeze({ eligible: reason === null, reason, validationReusable: reason === null && fingerprintMatches && checkpoint.validationState.status === 'PASSED', reviewReusable: reason === null && fingerprintMatches && checkpoint.reviewState.status === 'PASSED', permissionsMustBeReevaluated: true as const });
  if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe checkpoint] eligible=${result.eligible} reason=${result.reason || 'none'} schema=${checkpoint.checkpointSchemaVersion} workspaceFingerprint=${fingerprintMatches ? 'match' : 'changed'}`);
  return result;
}

export function invalidateCheckpoint(checkpoint: TaskCheckpoint, environment: CheckpointCompatibilityEnvironment): TaskCheckpoint {
  const eligibility = evaluateResumeEligibility(checkpoint, environment);
  if (eligibility.eligible) return checkpoint;
  if (checkpoint.checkpointState === 'INVALID') return checkpoint;
  return transitionCheckpoint(checkpoint, 'INVALID', environment.now ?? Date.now(), eligibility.reason || 'CORRUPTED_CHECKPOINT');
}
