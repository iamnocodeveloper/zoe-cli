import { checkpointStorage, type CheckpointPersistenceError } from './checkpoint-storage.js';
import { WorkspaceIntelligence, type WorkspaceContext } from './workspace-intelligence.js';
import { analyzeWorkspaceDrift, type WorkspaceDriftStatus } from './workspace-drift.js';
import { transitionCheckpoint, type CheckpointPipelineStage, type TaskCheckpoint } from './task-checkpoint.js';

export type ResumeStatus = 'RESUMED' | 'RESUME_REJECTED';
export type ResumeStage = 'Validation' | 'Reviewer' | 'Rendering' | 'Cleanup' | 'Completed';
export type ResumePermissionStatus = 'REVALIDATED' | 'DENIED';
export type ResumeValidationStatus = 'REUSED' | 'PASSED' | 'FAILED' | 'NOT_RUN';
export type ResumeReviewStatus = 'REUSED' | 'PASSED' | 'BLOCKED' | 'NOT_RUN';
export type ResumeErrorCode =
  | 'CheckpointLoadFailed' | 'CheckpointStateIneligible' | 'WorkspaceIncompatible'
  | 'WorkspaceUnknown' | 'PermissionRevalidationFailed' | 'UnsafeResumeBoundary'
  | 'StageExecutorUnavailable' | 'StageExecutionFailed';

export interface ResumeOutcome {
  readonly status: ResumeStatus;
  readonly checkpointId: string | null;
  readonly taskId: string;
  readonly runtimeId: string | null;
  readonly resumeStage: ResumeStage | null;
  readonly workspaceStatus: WorkspaceDriftStatus | 'NOT_RUN';
  readonly permissionStatus: ResumePermissionStatus | 'NOT_RUN';
  readonly validationStatus: ResumeValidationStatus;
  readonly reviewStatus: ResumeReviewStatus;
  readonly errorCode: ResumeErrorCode | null;
  readonly message: string;
}

export interface ResumeStageContext {
  readonly checkpoint: Readonly<TaskCheckpoint>;
  readonly workspace: Readonly<WorkspaceContext>;
  readonly runtimeId: string;
}

export interface SafeResumeDependencies {
  storage?: Pick<typeof checkpointStorage, 'load' | 'save'>;
  workspace?: () => WorkspaceContext;
  createRuntimeId?: () => string;
  now?: () => number;
  revalidatePermissions: (context: ResumeStageContext, nextStage: ResumeStage) => Promise<ResumePermissionStatus>;
  runValidation?: (context: ResumeStageContext) => Promise<'PASSED' | 'FAILED'>;
  runReviewer?: (context: ResumeStageContext) => Promise<'PASSED' | 'BLOCKED'>;
  runRendering?: (context: ResumeStageContext) => Promise<void>;
  runCleanup?: (context: ResumeStageContext) => Promise<void>;
  debug?: (message: string) => void;
}

const POST_TOOL_STAGES: readonly ResumeStage[] = ['Validation', 'Reviewer', 'Rendering', 'Cleanup'];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function defaultDebug(message: string): void {
  if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe resume] ${message}`);
}

function rejected(taskId: string, detail: Partial<ResumeOutcome>): ResumeOutcome {
  return deepFreeze({
    status: 'RESUME_REJECTED', checkpointId: detail.checkpointId ?? null, taskId,
    runtimeId: detail.runtimeId ?? null, resumeStage: detail.resumeStage ?? null,
    workspaceStatus: detail.workspaceStatus ?? 'NOT_RUN', permissionStatus: detail.permissionStatus ?? 'NOT_RUN',
    validationStatus: detail.validationStatus ?? 'NOT_RUN', reviewStatus: detail.reviewStatus ?? 'NOT_RUN',
    errorCode: detail.errorCode ?? 'StageExecutionFailed', message: detail.message ?? 'Resume was rejected.',
  });
}

function nextStage(checkpoint: TaskCheckpoint): ResumeStage | null {
  if (!checkpoint.completedStages.includes('ToolExecution')) return null;
  if (!checkpoint.completedStages.includes('Validation') || checkpoint.validationState.status !== 'PASSED') return 'Validation';
  if (!checkpoint.completedStages.includes('Reviewer') || checkpoint.reviewState.status !== 'PASSED') return 'Reviewer';
  return POST_TOOL_STAGES.find((stage) => !checkpoint.completedStages.includes(stage as CheckpointPipelineStage)) || 'Completed';
}

function updateResumedCheckpoint(
  checkpoint: TaskCheckpoint,
  stage: CheckpointPipelineStage,
  now: number,
  detail: { validation?: 'PASSED' | 'FAILED'; review?: 'PASSED' | 'BLOCKED' } = {},
): TaskCheckpoint {
  const completedStages = detail.validation === 'FAILED' || detail.review === 'BLOCKED'
    ? checkpoint.completedStages
    : [...new Set([...checkpoint.completedStages, stage])];
  return deepFreeze({
    ...checkpoint,
    checkpointState: 'RESUMED' as const,
    taskState: 'RUNNING' as const,
    pipelineStage: stage,
    completedStages,
    remainingStages: checkpoint.remainingStages.filter((item) => !completedStages.includes(item)),
    updatedAt: now,
    duration: Math.max(0, now - checkpoint.startedAt),
    permissionState: { approvalsPreviouslyGranted: false, revalidationRequired: true, validUntil: null },
    validationState: detail.validation
      ? { ...checkpoint.validationState, status: detail.validation }
      : checkpoint.validationState,
    reviewState: detail.review ? { ...checkpoint.reviewState, status: detail.review } : checkpoint.reviewState,
  });
}

export function createSafeResumeCoordinator(dependencies: SafeResumeDependencies) {
  const storage = dependencies.storage || checkpointStorage;
  const workspace = dependencies.workspace || (() => new WorkspaceIntelligence(process.cwd()).getContext());
  const now = dependencies.now || Date.now;
  const createRuntimeId = dependencies.createRuntimeId || (() => `resume-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const debug = dependencies.debug || defaultDebug;

  return {
    async resume(taskId: string): Promise<ResumeOutcome> {
      debug(`resume=requested taskId=${taskId}`);
      let checkpoint: TaskCheckpoint;
      try {
        checkpoint = await storage.load(taskId);
        debug(`checkpoint=loaded taskId=${taskId} checkpointId=${checkpoint.checkpointId}`);
      } catch (error) {
        const code = (error as CheckpointPersistenceError)?.code || 'unknown';
        debug(`resume=rejected taskId=${taskId} reason=CheckpointLoadFailed storage=${code}`);
        return rejected(taskId, { errorCode: 'CheckpointLoadFailed', message: 'Checkpoint could not be loaded.' });
      }

      const base = { checkpointId: checkpoint.checkpointId };
      if (checkpoint.checkpointState !== 'READY') {
        debug(`resume=rejected taskId=${taskId} reason=CheckpointStateIneligible state=${checkpoint.checkpointState}`);
        return rejected(taskId, { ...base, errorCode: 'CheckpointStateIneligible', message: `Checkpoint state ${checkpoint.checkpointState} cannot resume.` });
      }

      const currentWorkspace = workspace();
      const drift = analyzeWorkspaceDrift(checkpoint, currentWorkspace);
      debug(`workspace=validated taskId=${taskId} status=${drift.status}`);
      if (drift.status !== 'COMPATIBLE') {
        const errorCode = drift.status === 'UNKNOWN' ? 'WorkspaceUnknown' : 'WorkspaceIncompatible';
        debug(`resume=rejected taskId=${taskId} reason=${errorCode}`);
        return rejected(taskId, { ...base, workspaceStatus: drift.status, errorCode, message: 'Workspace is not compatible with this checkpoint.' });
      }

      const stage = nextStage(checkpoint);
      if (!stage) {
        debug(`resume=rejected taskId=${taskId} reason=UnsafeResumeBoundary`);
        return rejected(taskId, { ...base, workspaceStatus: drift.status, errorCode: 'UnsafeResumeBoundary', message: 'Checkpoint would require replaying unfinished tool work.' });
      }
      if (stage === 'Completed') {
        return rejected(taskId, { ...base, workspaceStatus: drift.status, resumeStage: stage, errorCode: 'CheckpointStateIneligible', message: 'Checkpoint has no unfinished safe stage.' });
      }

      const runtimeId = createRuntimeId();
      const executionCheckpoint = deepFreeze({
        ...checkpoint,
        permissionState: { approvalsPreviouslyGranted: false, revalidationRequired: true as const, validUntil: null },
      });
      const context: ResumeStageContext = deepFreeze({ checkpoint: executionCheckpoint, workspace: currentWorkspace, runtimeId });
      let permissionStatus: ResumePermissionStatus;
      try { permissionStatus = await dependencies.revalidatePermissions(context, stage); }
      catch { permissionStatus = 'DENIED'; }
      debug(`permission=validated taskId=${taskId} status=${permissionStatus}`);
      if (permissionStatus !== 'REVALIDATED') {
        debug(`resume=rejected taskId=${taskId} reason=PermissionRevalidationFailed`);
        return rejected(taskId, { ...base, runtimeId, resumeStage: stage, workspaceStatus: drift.status, permissionStatus, errorCode: 'PermissionRevalidationFailed', message: 'Permissions must be approved again before resume.' });
      }

      let current = transitionCheckpoint(executionCheckpoint, 'RESUMED', now());
      debug(`resume=accepted taskId=${taskId} runtimeId=${runtimeId} stage=${stage}`);
      let validationStatus: ResumeValidationStatus = checkpoint.validationState.status === 'PASSED' ? 'REUSED' : 'NOT_RUN';
      let reviewStatus: ResumeReviewStatus = checkpoint.reviewState.status === 'PASSED' ? 'REUSED' : 'NOT_RUN';

      try {
        let currentStage: ResumeStage = stage;
        if (currentStage === 'Validation') {
          if (!dependencies.runValidation) throw new Error('Validation executor unavailable');
          debug(`stage=current taskId=${taskId} stage=Validation`);
          validationStatus = await dependencies.runValidation(deepFreeze({ ...context, checkpoint: current }));
          current = updateResumedCheckpoint(current, 'Validation', now(), { validation: validationStatus });
          if (validationStatus === 'FAILED') throw new Error('Validation failed');
          currentStage = 'Reviewer';
        }
        if (currentStage === 'Reviewer') {
          if (!dependencies.runReviewer) throw new Error('Reviewer executor unavailable');
          debug(`stage=current taskId=${taskId} stage=Reviewer`);
          reviewStatus = await dependencies.runReviewer(deepFreeze({ ...context, checkpoint: current }));
          current = updateResumedCheckpoint(current, 'Reviewer', now(), { review: reviewStatus });
          if (reviewStatus === 'BLOCKED') throw new Error('Reviewer blocked');
          currentStage = 'Rendering';
        }
        if (currentStage === 'Rendering') {
          if (!dependencies.runRendering) throw new Error('Rendering executor unavailable');
          debug(`stage=current taskId=${taskId} stage=Rendering`);
          await dependencies.runRendering(deepFreeze({ ...context, checkpoint: current }));
          current = updateResumedCheckpoint(current, 'Rendering', now());
          currentStage = 'Cleanup';
        }
        if (currentStage === 'Cleanup') {
          if (!dependencies.runCleanup) throw new Error('Cleanup executor unavailable');
          debug(`stage=current taskId=${taskId} stage=Cleanup`);
          await dependencies.runCleanup(deepFreeze({ ...context, checkpoint: current }));
          current = updateResumedCheckpoint(current, 'Cleanup', now());
        }
        current = transitionCheckpoint(current, 'COMPLETED', now());
        await storage.save(current);
        debug(`resume=completed taskId=${taskId} runtimeId=${runtimeId}`);
        return deepFreeze({ status: 'RESUMED', checkpointId: checkpoint.checkpointId, taskId, runtimeId, resumeStage: stage, workspaceStatus: drift.status, permissionStatus, validationStatus, reviewStatus, errorCode: null, message: 'Checkpoint resumed and completed.' });
      } catch (error) {
        const unavailable = error instanceof Error && /executor unavailable/.test(error.message);
        debug(`resume=rejected taskId=${taskId} reason=${unavailable ? 'StageExecutorUnavailable' : 'StageExecutionFailed'} stage=${current.pipelineStage}`);
        return rejected(taskId, { ...base, runtimeId, resumeStage: stage, workspaceStatus: drift.status, permissionStatus, validationStatus, reviewStatus, errorCode: unavailable ? 'StageExecutorUnavailable' : 'StageExecutionFailed', message: error instanceof Error ? error.message : 'Resume stage failed.' });
      }
    },
  };
}
