import { createPlan, executeRuntimeV2, runAgent } from './agent.js';
import { isZoeAuthError, type AuthErrorCode } from './insforge.js';
import { classifyTask, type TaskMode } from './task-mode.js';
import { getWorkspaceContext, type WorkspaceContext } from './workspace-intelligence.js';
import { activateTaskCancellation, clearTaskCancellation, createTaskCancellationToken, TaskCancelledError, type TaskCancellationToken } from './task-cancellation.js';
import { checkpointStorage } from './checkpoint-storage.js';
import { CheckpointLifecycleCapture, type CheckpointStageMetadata, type CheckpointWriter } from './checkpoint-lifecycle.js';
import type { CheckpointPipelineStage } from './task-checkpoint.js';

export type TaskEntryPoint = 'chat' | 'direct-cli' | 'run-command';
export type TaskOutcomeCode =
  | 'COMPLETED' | 'COMPLETED_UNVERIFIED' | 'PARTIALLY_COMPLETED' | 'CANCELLED_BY_USER'
  | 'PERMISSION_DENIED' | 'PLANNING_FAILED' | 'EXECUTION_FAILED' | 'TOOL_FAILED'
  | 'VALIDATION_FAILED' | 'REVIEW_FAILED' | 'CLOUD_UNAVAILABLE' | 'AUTH_REQUIRED' | 'INTERNAL_ERROR';

export interface TaskContext {
  taskId: string;
  rawInput: string;
  normalizedInput: string;
  mode: TaskMode;
  entryPoint: TaskEntryPoint;
  workspaceRoot: string;
  workspaceContext: WorkspaceContext;
  cancellationToken: TaskCancellationToken;
  startedAt: number;
  metadata: Record<string, unknown>;
}

export interface TaskOutcome {
  code: TaskOutcomeCode;
  taskId: string;
  mode: TaskMode;
  entryPoint: TaskEntryPoint;
  success: boolean;
  verified: boolean;
  message: string;
  changedFiles?: { created: number; modified: number };
  warnings?: string[];
  validationResults?: unknown[];
  reviewerResult?: string;
  recoverable?: boolean;
  suggestedNextAction?: string;
  metadata?: Record<string, unknown>;
}

type StructuredResult = Awaited<ReturnType<typeof executeRuntimeV2>>;

export interface TaskOrchestratorDependencies {
  createId?: () => string;
  now?: () => number;
  classify?: (input: string) => TaskMode;
  workspace?: () => WorkspaceContext;
  cancellation?: (taskId: string) => TaskCancellationToken;
  conversational?: (input: string, workspace: WorkspaceContext, token: TaskCancellationToken) => Promise<string>;
  plan?: (input: string, workspace: WorkspaceContext, token: TaskCancellationToken) => ReturnType<typeof createPlan>;
  structured?: (input: string, plan: string, workspace: WorkspaceContext, token: TaskCancellationToken, onCheckpointStage?: (stage: CheckpointPipelineStage, metadata?: CheckpointStageMetadata) => Promise<void>) => Promise<StructuredResult>;
  checkpointStorage?: CheckpointWriter | false;
  checkpointLifecycle?: (options: ConstructorParameters<typeof CheckpointLifecycleCapture>[0]) => CheckpointLifecycleCapture;
  debug?: (message: string) => void;
}

export interface TaskRunOptions {
  onPlan?: (planText: string) => void;
  onPreview?: (context: Readonly<TaskContext>) => void | Promise<void>;
}

function defaultDebug(message: string): void {
  if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe task] ${message}`);
}

function authOutcome(error: { code: AuthErrorCode }, context: TaskContext): TaskOutcome {
  const cloud = error.code === 'CLOUD_UNAVAILABLE' || error.code === 'NETWORK_TIMEOUT';
  return outcome(context, cloud ? 'CLOUD_UNAVAILABLE' : 'AUTH_REQUIRED', {
    message: cloud ? 'Zoe Cloud is temporarily unavailable.' : 'Authentication is required to continue.',
    recoverable: true,
    suggestedNextAction: cloud ? 'Your local session was preserved. Try again.' : 'Run: zoe login',
    metadata: { authCode: error.code },
  });
}

function outcome(context: TaskContext, code: TaskOutcomeCode, extra: Partial<TaskOutcome> = {}): TaskOutcome {
  const success = code === 'COMPLETED' || code === 'COMPLETED_UNVERIFIED';
  return {
    code, taskId: context.taskId, mode: context.mode, entryPoint: context.entryPoint,
    success, verified: code === 'COMPLETED', message: extra.message || code,
    ...extra,
  };
}

function mapStructuredResult(context: TaskContext, result: StructuredResult): TaskOutcome {
  if (result.status === 'SUCCESS') return outcome(context, 'COMPLETED', {
    message: 'Task completed and verified.', changedFiles: { created: result.filesCreated, modified: result.filesModified }, warnings: result.warnings,
  });
  const warning = result.warnings.join(' | ');
  const code: TaskOutcomeCode = /permission denied/i.test(warning) ? 'PERMISSION_DENIED'
    : /reviewer blocking/i.test(warning) ? 'REVIEW_FAILED'
    : /validation|\b(build|test|typecheck|lint) failed/i.test(warning) ? 'VALIDATION_FAILED'
    : (result.filesCreated + result.filesModified > 0) ? 'PARTIALLY_COMPLETED' : 'EXECUTION_FAILED';
  return outcome(context, code, {
    message: result.status === 'NEEDS_USER_INPUT' ? (result.warnings[0] || 'More input is required.') : 'Task did not complete successfully.',
    changedFiles: { created: result.filesCreated, modified: result.filesModified }, warnings: result.warnings,
    recoverable: code !== 'EXECUTION_FAILED', suggestedNextAction: result.nextStep,
  });
}

export function createTaskOrchestrator(deps: TaskOrchestratorDependencies = {}) {
  const now = deps.now || Date.now;
  const createId = deps.createId || (() => `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const classify = deps.classify || classifyTask;
  const workspace = deps.workspace || getWorkspaceContext;
  const cancellation = deps.cancellation || createTaskCancellationToken;
  const conversational = deps.conversational || ((input: string, context: WorkspaceContext, token: TaskCancellationToken) => runAgent(input, { workspaceContext: context, cancellationToken: token }));
  const plan = deps.plan || createPlan;
  const structured = deps.structured || executeRuntimeV2;
  const debug = deps.debug || defaultDebug;
  const storage = deps.checkpointStorage === false ? null : (deps.checkpointStorage || checkpointStorage);
  const lifecycleFactory = deps.checkpointLifecycle || ((options: ConstructorParameters<typeof CheckpointLifecycleCapture>[0]) => new CheckpointLifecycleCapture(options));

  return {
    async run(rawInput: string, entryPoint: TaskEntryPoint, options: TaskRunOptions = {}): Promise<TaskOutcome> {
      const normalizedInput = rawInput.trim();
      const workspaceContext = workspace();
      const taskId = createId(); const cancellationToken = cancellation(taskId);
      const context: TaskContext = { taskId, rawInput, normalizedInput, mode: classify(normalizedInput), entryPoint, workspaceRoot: workspaceContext.workspaceRoot, workspaceContext, cancellationToken, startedAt: now(), metadata: {} };
      activateTaskCancellation(cancellationToken);
      const checkpoints = storage ? lifecycleFactory({ checkpointId: `${taskId}-checkpoint`, taskId, startedAt: context.startedAt, workspace: workspaceContext, storage, now, debug }) : null;
      await checkpoints?.create();
      debug(`taskId=${context.taskId} entry=${entryPoint} mode=${context.mode} start`);
      try {
        if (options.onPreview) {
          cancellationToken.enter('Preview', 'PREVIEW');
          try { await options.onPreview(Object.freeze({ ...context, metadata: Object.freeze({ ...context.metadata }) })); }
          catch (error) { debug(`taskId=${context.taskId} preview=failed reason=${error instanceof Error ? error.name : 'unknown'}`); }
          cancellationToken.throwIfCancelled();
          await checkpoints?.stage('Preview');
        }
        let final: TaskOutcome;
        if (context.mode === 'CHAT_MODE') {
          cancellationToken.enter('Runtime');
          const response = await conversational(normalizedInput, workspaceContext, cancellationToken);
          cancellationToken.throwIfCancelled();
          await checkpoints?.stage('Runtime');
          final = outcome(context, 'COMPLETED_UNVERIFIED', { message: response, recoverable: true });
        } else {
          cancellationToken.enter('Planner');
          const planned = await plan(normalizedInput, workspaceContext, cancellationToken);
          cancellationToken.throwIfCancelled();
          await checkpoints?.stage('Planning');
          options.onPlan?.(planned.plan);
          if (planned.status === 'NEEDS_USER_INPUT') {
            final = outcome(context, 'PLANNING_FAILED', { message: planned.plan, recoverable: true });
          } else {
            cancellationToken.enter('Runtime');
            final = mapStructuredResult(context, await structured(normalizedInput, planned.plan, workspaceContext, cancellationToken, (stage, metadata) => checkpoints?.stage(stage, metadata) || Promise.resolve()));
            cancellationToken.throwIfCancelled();
            await checkpoints?.stage('Runtime');
          }
        }
        await checkpoints?.stage('Rendering');
        await checkpoints?.stage('Cleanup');
        if (final.success) await checkpoints?.completedFinal();
        else await checkpoints?.failed(final.code === 'PLANNING_FAILED' ? 'Planning' : 'Runtime', final.code, final.message);
        if (checkpoints?.warnings.length) final = { ...final, warnings: [...(final.warnings || []), ...checkpoints.warnings] };
        cancellationToken.finish(final.success ? 'COMPLETED' : 'FAILED');
        debug(`taskId=${context.taskId} outcome=${final.code} durationMs=${now() - context.startedAt}`);
        return final;
      } catch (error) {
        const final = error instanceof TaskCancelledError
          ? outcome(context, 'CANCELLED_BY_USER', { message: 'Task cancelled.', recoverable: true, metadata: { cancellationReason: cancellationToken.reason(), cancelledStage: cancellationToken.stage(), durationMs: now() - context.startedAt, completedStages: cancellationToken.completedStages(), skippedStages: cancellationToken.skippedStages(), workspace: workspaceContext.projectName, rollback: false } })
          : isZoeAuthError(error)
          ? authOutcome(error, context)
          : outcome(context, 'INTERNAL_ERROR', { message: 'The task could not be completed.', recoverable: true, suggestedNextAction: 'Try again or run: zoe doctor' });
        await checkpoints?.stage('Cleanup');
        if (error instanceof TaskCancelledError) await checkpoints?.cancelled((cancellationToken.stage() === 'Planner' ? 'Planning' : cancellationToken.stage() === 'Reviewer' ? 'Reviewer' : cancellationToken.stage() === 'Validation' ? 'Validation' : cancellationToken.stage() === 'Tool execution' ? 'ToolExecution' : cancellationToken.stage() === 'Preview' ? 'Preview' : 'Runtime'), cancellationToken.reason() || 'User requested cancellation.', now() - context.startedAt);
        else await checkpoints?.failed(cancellationToken.stage() === 'Planner' ? 'Planning' : 'Runtime', final.code, final.message);
        const finalWithWarnings = checkpoints?.warnings.length ? { ...final, warnings: [...(final.warnings || []), ...checkpoints.warnings] } : final;
        debug(`taskId=${context.taskId} outcome=${final.code} durationMs=${now() - context.startedAt}`);
        cancellationToken.finish(error instanceof TaskCancelledError ? 'CANCELLED' : 'FAILED');
        return finalWithWarnings;
      } finally {
        clearTaskCancellation(cancellationToken);
        debug(`taskId=${context.taskId} cleanup=complete`);
      }
    },
  };
}

export const taskOrchestrator = createTaskOrchestrator();
