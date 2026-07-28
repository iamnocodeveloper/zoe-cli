import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHECKPOINT_SCHEMA_VERSION, type CheckpointState, type TaskCheckpoint } from './task-checkpoint.js';

export type CheckpointPersistenceErrorCode = 'CheckpointNotFound' | 'CheckpointCorrupted' | 'CheckpointVersionMismatch' | 'CheckpointPermissionDenied' | 'CheckpointWriteFailed' | 'CheckpointReadFailed' | 'CheckpointSerializationFailed' | 'CheckpointDeserializationFailed';

export class CheckpointPersistenceError extends Error {
  constructor(readonly code: CheckpointPersistenceErrorCode, message: string, readonly cause?: unknown) { super(message); this.name = code; }
}

export interface CheckpointSummary {
  readonly taskId: string; readonly createdAt: number; readonly updatedAt: number; readonly workspace: string;
  readonly state: CheckpointState; readonly resumeEligible: boolean; readonly schemaVersion: number;
}

export interface CheckpointCleanupResult { readonly removed: readonly string[]; readonly retained: number; }

const STATES = new Set<CheckpointState>(['NOT_CREATED', 'CREATED', 'READY', 'INVALID', 'OBSOLETE', 'RESUMED', 'COMPLETED', 'DISCARDED']);
const CLEANABLE = new Set<CheckpointState>(['COMPLETED', 'DISCARDED', 'OBSOLETE', 'INVALID']);
const SENSITIVE_KEY = /(api.?key|oauth|access.?token|refresh.?token|password|secret|credential|authorization|environment|conversation|prompt|command.?output|terminal.?history)/i;
const GIT_SNAPSHOT_KEYS = new Set(['contextVersion', 'repositoryDetected', 'workspaceInsideRepository', 'workspaceRelativePath', 'branch', 'detachedHead', 'headCommit', 'workingTreeState', 'stagedCount', 'unstagedCount', 'untrackedCount', 'conflictedCount', 'changedPaths']);
const GIT_PATH_KEYS = new Set(['path', 'originalPath', 'statuses']);

function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); } return value; }
function debug(message: string): void { if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe checkpoint storage] ${message}`); }
function safeTaskId(taskId: string): string { if (!/^[A-Za-z0-9._-]+$/.test(taskId) || taskId === '.' || taskId === '..') throw new CheckpointPersistenceError('CheckpointSerializationFailed', 'Checkpoint task ID contains unsupported characters.'); return taskId; }
function persistenceError(error: unknown, operation: 'read' | 'write'): CheckpointPersistenceError {
  if (error instanceof CheckpointPersistenceError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'EACCES' || code === 'EPERM') return new CheckpointPersistenceError('CheckpointPermissionDenied', `Checkpoint ${operation} permission was denied.`, error);
  return new CheckpointPersistenceError(operation === 'read' ? 'CheckpointReadFailed' : 'CheckpointWriteFailed', `Checkpoint ${operation} failed.`, error);
}

function assertSerializable(value: unknown, seen = new Set<object>(), key = 'checkpoint'): void {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint' || typeof value === 'undefined') throw new CheckpointPersistenceError('CheckpointSerializationFailed', `Checkpoint contains non-serializable value at ${key}.`);
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new CheckpointPersistenceError('CheckpointSerializationFailed', 'Checkpoint contains a circular reference.');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new CheckpointPersistenceError('CheckpointSerializationFailed', `Checkpoint contains a runtime object at ${key}.`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertSerializable(item, seen, `${key}[${index}]`));
  else for (const [childKey, child] of Object.entries(value)) { if (SENSITIVE_KEY.test(childKey)) throw new CheckpointPersistenceError('CheckpointSerializationFailed', `Checkpoint contains forbidden field: ${childKey}.`); assertSerializable(child, seen, childKey); }
  seen.delete(value);
}

function validateCheckpoint(value: unknown): TaskCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CheckpointPersistenceError('CheckpointDeserializationFailed', 'Checkpoint must be a JSON object.');
  const item = value as Record<string, any>;
  const requiredStrings = ['checkpointId', 'taskId', 'workspaceId', 'checkpointState', 'taskState', 'pipelineStage'];
  if (requiredStrings.some((key) => typeof item[key] !== 'string' || !item[key])) throw new CheckpointPersistenceError('CheckpointCorrupted', 'Checkpoint is missing required string metadata.');
  if (!STATES.has(item.checkpointState)) throw new CheckpointPersistenceError('CheckpointCorrupted', 'Checkpoint state is invalid.');
  if (typeof item.checkpointSchemaVersion !== 'number') throw new CheckpointPersistenceError('CheckpointCorrupted', 'Checkpoint schema version is missing.');
  if (item.checkpointSchemaVersion !== CHECKPOINT_SCHEMA_VERSION) throw new CheckpointPersistenceError('CheckpointVersionMismatch', `Checkpoint schema ${item.checkpointSchemaVersion} is incompatible with ${CHECKPOINT_SCHEMA_VERSION}.`);
  for (const key of ['workspaceVersion', 'startedAt', 'updatedAt', 'duration', 'plannerVersion', 'runtimeVersion']) if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) throw new CheckpointPersistenceError('CheckpointCorrupted', `Checkpoint numeric field is invalid: ${key}.`);
  for (const key of ['completedStages', 'remainingStages']) if (!Array.isArray(item[key]) || item[key].some((entry: unknown) => typeof entry !== 'string')) throw new CheckpointPersistenceError('CheckpointCorrupted', `Checkpoint stage list is invalid: ${key}.`);
  if (!item.workspaceFingerprint || !Array.isArray(item.workspaceFingerprint.files) || typeof item.workspaceFingerprint.workspaceRoot !== 'string') throw new CheckpointPersistenceError('CheckpointCorrupted', 'Workspace fingerprint is invalid.');
  if (!item.gitSnapshot || item.gitSnapshot.contextVersion !== 1 || typeof item.gitSnapshot.repositoryDetected !== 'boolean' || !Array.isArray(item.gitSnapshot.changedPaths)) throw new CheckpointPersistenceError('CheckpointCorrupted', 'Git checkpoint metadata is invalid.');
  if (Object.keys(item.gitSnapshot).some((key) => !GIT_SNAPSHOT_KEYS.has(key))
    || item.gitSnapshot.changedPaths.some((entry: unknown) => !entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry as Record<string, unknown>).some((key) => !GIT_PATH_KEYS.has(key)))) {
    throw new CheckpointPersistenceError('CheckpointCorrupted', 'Git checkpoint metadata contains unsupported or sensitive fields.');
  }
  if (!item.permissionState || item.permissionState.revalidationRequired !== true) throw new CheckpointPersistenceError('CheckpointCorrupted', 'Permission revalidation contract is invalid.');
  if (typeof item.resumeEligible !== 'boolean' || !item.validationState || !item.reviewState || !item.toolExecutionState || !item.metadata) throw new CheckpointPersistenceError('CheckpointCorrupted', 'Checkpoint contract metadata is incomplete.');
  assertSerializable(item);
  return deepFreeze(item as TaskCheckpoint);
}

function extractSummary(json: string): CheckpointSummary {
  const stringField = (name: string): string => { const match = new RegExp(`"${name}"\\s*:\\s*("(?:\\\\.|[^"])*")`).exec(json); if (!match) throw new CheckpointPersistenceError('CheckpointCorrupted', `Checkpoint summary field is missing: ${name}.`); return JSON.parse(match[1]); };
  const numberField = (name: string): number => { const match = new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(json); if (!match) throw new CheckpointPersistenceError('CheckpointCorrupted', `Checkpoint summary field is missing: ${name}.`); return Number(match[1]); };
  const booleanField = (name: string): boolean => { const match = new RegExp(`"${name}"\\s*:\\s*(true|false)`).exec(json); if (!match) throw new CheckpointPersistenceError('CheckpointCorrupted', `Checkpoint summary field is missing: ${name}.`); return match[1] === 'true'; };
  const schemaVersion = numberField('checkpointSchemaVersion');
  if (schemaVersion !== CHECKPOINT_SCHEMA_VERSION) throw new CheckpointPersistenceError('CheckpointVersionMismatch', `Checkpoint schema ${schemaVersion} is incompatible with ${CHECKPOINT_SCHEMA_VERSION}.`);
  const state = stringField('checkpointState') as CheckpointState;
  if (!STATES.has(state)) throw new CheckpointPersistenceError('CheckpointCorrupted', 'Checkpoint summary state is invalid.');
  return deepFreeze({ taskId: stringField('taskId'), createdAt: numberField('startedAt'), updatedAt: numberField('updatedAt'), workspace: stringField('workspaceId'), state, resumeEligible: booleanField('resumeEligible'), schemaVersion });
}

export class CheckpointStorage {
  private readonly saving = new Set<string>();
  constructor(readonly storagePath = path.join(os.homedir(), '.zoe', 'checkpoints')) {}
  private file(taskId: string): string { return path.join(this.storagePath, `${safeTaskId(taskId)}.checkpoint.json`); }

  async save(checkpoint: TaskCheckpoint): Promise<void> {
    safeTaskId(checkpoint.taskId); assertSerializable(checkpoint); validateCheckpoint(checkpoint);
    if (this.saving.has(checkpoint.taskId)) throw new CheckpointPersistenceError('CheckpointWriteFailed', 'A checkpoint save is already in progress for this task.');
    this.saving.add(checkpoint.taskId); let temporary = '';
    try {
      await fs.promises.mkdir(this.storagePath, { recursive: true });
      temporary = path.join(this.storagePath, `.${checkpoint.taskId}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
      const handle = await fs.promises.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fs.promises.rename(temporary, this.file(checkpoint.taskId));
      debug(`save taskId=${checkpoint.taskId} path=${this.storagePath} schema=${checkpoint.checkpointSchemaVersion}`);
    } catch (error) {
      if (temporary) await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      throw persistenceError(error, 'write');
    } finally { this.saving.delete(checkpoint.taskId); }
  }

  async load(taskId: string): Promise<TaskCheckpoint> {
    const file = this.file(taskId);
    let text: string;
    try { text = await fs.promises.readFile(file, 'utf8'); }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') throw new CheckpointPersistenceError('CheckpointNotFound', `Checkpoint was not found: ${taskId}.`); throw persistenceError(error, 'read'); }
    try { const checkpoint = validateCheckpoint(JSON.parse(text)); debug(`load taskId=${taskId} path=${this.storagePath} schema=${checkpoint.checkpointSchemaVersion}`); return checkpoint; }
    catch (error) { if (error instanceof SyntaxError) throw new CheckpointPersistenceError('CheckpointCorrupted', `Checkpoint JSON is corrupted: ${taskId}.`, error); if (error instanceof CheckpointPersistenceError) throw error; throw new CheckpointPersistenceError('CheckpointDeserializationFailed', `Checkpoint could not be deserialized: ${taskId}.`, error); }
  }

  async list(): Promise<readonly CheckpointSummary[]> {
    let names: string[]; try { names = await fs.promises.readdir(this.storagePath); } catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return Object.freeze([]); throw persistenceError(error, 'read'); }
    const summaries: CheckpointSummary[] = [];
    for (const name of names.filter((name) => name.endsWith('.checkpoint.json')).sort()) {
      try { summaries.push(extractSummary(await fs.promises.readFile(path.join(this.storagePath, name), 'utf8'))); }
      catch (error) { if (error instanceof SyntaxError) throw new CheckpointPersistenceError('CheckpointCorrupted', `Checkpoint index entry is corrupted: ${name}.`, error); throw error; }
    }
    return Object.freeze(summaries.sort((a, b) => b.updatedAt - a.updatedAt));
  }

  async delete(taskId: string): Promise<boolean> {
    try { await fs.promises.unlink(this.file(taskId)); debug(`delete taskId=${taskId} path=${this.storagePath}`); return true; }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return false; throw persistenceError(error, 'write'); }
  }

  async cleanup(maxAgeMs: number, now = Date.now()): Promise<CheckpointCleanupResult> {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new CheckpointPersistenceError('CheckpointWriteFailed', 'Cleanup age must be a non-negative number.');
    const summaries = await this.list(); const removed: string[] = [];
    for (const summary of summaries) if (CLEANABLE.has(summary.state) && now - summary.updatedAt >= maxAgeMs && await this.delete(summary.taskId)) removed.push(summary.taskId);
    debug(`cleanup path=${this.storagePath} removed=${removed.length}`);
    return deepFreeze({ removed, retained: summaries.length - removed.length });
  }
}

export const checkpointStorage = new CheckpointStorage();
