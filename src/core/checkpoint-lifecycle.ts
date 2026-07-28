import { createTaskCheckpoint, transitionCheckpoint, type CheckpointInvalidReason, type CheckpointPipelineStage, type TaskCheckpoint } from './task-checkpoint.js';
import type { WorkspaceContext } from './workspace-intelligence.js';

export interface CheckpointWriter { save(checkpoint: TaskCheckpoint): Promise<void>; }
export interface CheckpointStageMetadata { validationStatus?: 'NOT_RUN' | 'PASSED' | 'FAILED'; validationResultNames?: readonly string[]; reviewStatus?: 'NOT_RUN' | 'PASSED' | 'BLOCKED'; completedToolBatches?: number; completedToolNames?: readonly string[]; toolElapsedMs?: number; }
export interface CheckpointLifecycleOptions { checkpointId: string; taskId: string; startedAt: number; workspace: WorkspaceContext; storage: CheckpointWriter; now?: () => number; debug?: (message: string) => void; }

export class CheckpointLifecycleCapture {
  private current: TaskCheckpoint | null = null; private readonly completed = new Set<CheckpointPipelineStage>();
  private readonly recorded = new Set<string>(); private readonly warningsList: string[] = []; private chain = Promise.resolve();
  private validationStatus: 'NOT_RUN' | 'PASSED' | 'FAILED' = 'NOT_RUN'; private validationResultNames: string[] = [];
  private reviewStatus: 'NOT_RUN' | 'PASSED' | 'BLOCKED' = 'NOT_RUN'; private completedToolBatches = 0; private completedToolNames: string[] = []; private toolElapsedMs = 0;
  private readonly now: () => number; private readonly log: (message: string) => void;
  constructor(private readonly options: CheckpointLifecycleOptions) { this.now = options.now || Date.now; this.log = options.debug || ((message) => { if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe checkpoint lifecycle] ${message}`); }); }
  get checkpoint(): TaskCheckpoint | null { return this.current; }
  get warnings(): readonly string[] { return Object.freeze([...this.warningsList]); }
  async create(): Promise<void> { await this.enqueue('CREATED', async () => this.persist(this.snapshot('Preview'))); }
  async stage(stage: CheckpointPipelineStage, metadata: CheckpointStageMetadata = {}): Promise<void> {
    await this.enqueue(`READY:${stage}`, async () => { this.completed.add(stage); this.applyStageMetadata(metadata); const created = this.snapshot(stage); this.current = transitionCheckpoint(created, 'READY', this.now()); await this.persist(this.current); });
  }
  async completedFinal(): Promise<void> { await this.final('COMPLETED', 'Cleanup', null, {}); }
  async cancelled(stage: CheckpointPipelineStage, reason: string, duration: number): Promise<void> { await this.final('DISCARDED', stage, null, { cancelledStage: stage, cancellationReason: reason, duration }); }
  async failed(stage: CheckpointPipelineStage, category: string, reason: string): Promise<void> { await this.final('INVALID', stage, 'CORRUPTED_CHECKPOINT', { failureStage: stage, failureCategory: category, failureReason: reason, failureTimestamp: this.now() }); }
  async flush(): Promise<void> { await this.chain; }
  private snapshot(stage: CheckpointPipelineStage, metadata: Record<string, string | number | boolean | null> = {}): TaskCheckpoint {
    return createTaskCheckpoint({ checkpointId: this.options.checkpointId, taskId: this.options.taskId, taskState: 'RUNNING', pipelineStage: stage, completedStages: [...this.completed], startedAt: this.options.startedAt, updatedAt: this.now(), workspace: this.options.workspace, permissionState: { approvalsPreviouslyGranted: false, validUntil: null }, validationState: { status: this.validationStatus, resultNames: this.validationResultNames }, reviewState: { status: this.reviewStatus }, toolExecutionState: { completedBatches: this.completedToolBatches, completedToolNames: this.completedToolNames, elapsedMs: this.toolElapsedMs }, metadata });
  }
  private applyStageMetadata(metadata: CheckpointStageMetadata): void { if (metadata.validationStatus) this.validationStatus = metadata.validationStatus; if (metadata.validationResultNames) this.validationResultNames = [...metadata.validationResultNames]; if (metadata.reviewStatus) this.reviewStatus = metadata.reviewStatus; if (metadata.completedToolBatches !== undefined) this.completedToolBatches = metadata.completedToolBatches; if (metadata.completedToolNames) this.completedToolNames = [...metadata.completedToolNames]; if (metadata.toolElapsedMs !== undefined) this.toolElapsedMs = metadata.toolElapsedMs; }
  private async final(state: 'COMPLETED' | 'DISCARDED' | 'INVALID', stage: CheckpointPipelineStage, reason: CheckpointInvalidReason | null, metadata: Record<string, string | number | boolean | null>): Promise<void> {
    await this.enqueue(state, async () => { this.completed.add(stage); const ready = transitionCheckpoint(this.snapshot(stage, metadata), 'READY', this.now()); this.current = transitionCheckpoint(ready, state, this.now(), reason); await this.persist(this.current); });
  }
  private async persist(checkpoint: TaskCheckpoint): Promise<void> {
    this.current = checkpoint;
    try { await this.options.storage.save(checkpoint); this.log(`checkpoint=${checkpoint.checkpointState} stage=${checkpoint.pipelineStage} taskId=${checkpoint.taskId}`); }
    catch (error) { const warning = `Checkpoint persistence warning (${checkpoint.pipelineStage}): ${error instanceof Error ? error.name : 'write failed'}`; this.warningsList.push(warning); this.log(`checkpoint=warning stage=${checkpoint.pipelineStage} taskId=${checkpoint.taskId}`); }
  }
  private async enqueue(key: string, operation: () => Promise<void>): Promise<void> {
    if (this.recorded.has(key)) { this.log(`checkpoint=skipped duplicate=${key} taskId=${this.options.taskId}`); return; }
    this.recorded.add(key); this.chain = this.chain.then(operation); await this.chain;
  }
}
