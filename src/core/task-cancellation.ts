export type TaskLifecycleState = 'CREATED' | 'PREVIEW' | 'RUNNING' | 'CANCELLING' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
export type CancellationStage = 'Created' | 'Preview' | 'Planner' | 'Runtime' | 'Tool execution' | 'Validation' | 'Reviewer';

export class TaskCancelledError extends Error {
  constructor(readonly token: TaskCancellationToken) { super(token.reason() || 'User requested cancellation.'); this.name = 'TaskCancelledError'; }
}

export interface TaskCancellationToken {
  isCancelled(): boolean;
  throwIfCancelled(): void;
  cancel(reason?: string): boolean;
  reason(): string | null;
  timestamp(): number | null;
  taskId(): string;
  state(): TaskLifecycleState;
  stage(): CancellationStage;
  completedStages(): readonly CancellationStage[];
  skippedStages(): readonly CancellationStage[];
  enter(stage: CancellationStage, state?: TaskLifecycleState): void;
  finish(state: 'CANCELLED' | 'COMPLETED' | 'FAILED'): void;
}

const STAGES: readonly CancellationStage[] = ['Preview', 'Planner', 'Runtime', 'Tool execution', 'Validation', 'Reviewer'];

export function createTaskCancellationToken(id: string, clock: () => number = Date.now): TaskCancellationToken {
  let cancelled = false; let cancellationReason: string | null = null; let cancelledAt: number | null = null;
  let lifecycle: TaskLifecycleState = 'CREATED'; let currentStage: CancellationStage = 'Created'; const completed = new Set<CancellationStage>();
  const token: TaskCancellationToken = {
    isCancelled: () => cancelled,
    throwIfCancelled: () => { if (cancelled) throw new TaskCancelledError(token); },
    cancel: (reason = 'User requested cancellation.') => {
      if (cancelled || ['CANCELLED', 'COMPLETED', 'FAILED'].includes(lifecycle)) return false;
      cancelled = true; cancellationReason = reason; cancelledAt = clock(); lifecycle = 'CANCELLING';
      if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe cancellation] taskId=${id} requested stage=${currentStage}`);
      return true;
    },
    reason: () => cancellationReason,
    timestamp: () => cancelledAt,
    taskId: () => id,
    state: () => lifecycle,
    stage: () => currentStage,
    completedStages: () => Object.freeze([...completed]),
    skippedStages: () => Object.freeze(STAGES.filter((stage) => !completed.has(stage) && stage !== currentStage)),
    enter: (stage, state = 'RUNNING') => { token.throwIfCancelled(); if (currentStage !== 'Created' && currentStage !== stage) completed.add(currentStage); currentStage = stage; lifecycle = state; },
    finish: (state) => { if (['CANCELLED', 'COMPLETED', 'FAILED'].includes(lifecycle)) return; if (currentStage !== 'Created') completed.add(currentStage); lifecycle = state; if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe cancellation] taskId=${id} completion=${state}`); },
  };
  return Object.freeze(token);
}

let activeToken: TaskCancellationToken | null = null;
export function activateTaskCancellation(token: TaskCancellationToken): void { activeToken = token; }
export function clearTaskCancellation(token: TaskCancellationToken): void { if (activeToken === token) activeToken = null; }
export function getActiveTaskCancellation(): TaskCancellationToken | null { return activeToken; }
export function cancelActiveTask(reason = 'User requested cancellation.'): boolean { return activeToken?.cancel(reason) || false; }

export type InterruptDecision = 'CANCEL_REQUESTED' | 'CANCELLATION_ALREADY_IN_PROGRESS' | 'EXIT';
export function handleCancellationInterrupt(reason = 'User requested cancellation.'): InterruptDecision {
  const active = getActiveTaskCancellation();
  if (!active) return 'EXIT';
  return active.cancel(reason) ? 'CANCEL_REQUESTED' : 'CANCELLATION_ALREADY_IN_PROGRESS';
}
