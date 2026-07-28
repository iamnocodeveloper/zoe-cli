import type { ExecutionPlan, ExecutionState, ProjectSnapshot, RuntimeStatus, ValidationResult } from './execution-plan.js';

export type ExecutionPhase = 'EXPLORE' | 'PLAN' | 'BUILD' | 'REVIEW' | 'VERIFY' | 'REPAIR' | 'FINAL STATE';
export type ExecutionEvent = {
  type: 'phase' | 'tool_request' | 'permission' | 'file_hash' | 'command' | 'verification';
  phase: ExecutionPhase;
  detail: Record<string, unknown>;
  at: number;
};

const transitions: Record<RuntimeStatus, RuntimeStatus[]> = {
  IDLE: ['ANALYZING'],
  ANALYZING: ['PLANNING', 'NEEDS_USER_INPUT', 'CANCELLED'],
  PLANNING: ['EXECUTING', 'NEEDS_USER_INPUT', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'FAILED', 'CANCELLED'],
  VERIFYING: ['EXECUTING', 'REPAIRING', 'SUCCESS', 'FAILED', 'NEEDS_USER_INPUT'],
  REPAIRING: ['EXECUTING', 'VERIFYING', 'FAILED', 'NEEDS_USER_INPUT'],
  SUCCESS: [],
  FAILED: [],
  NEEDS_USER_INPUT: [],
  CANCELLED: [],
};

export class RuntimeController {
  phase: ExecutionPhase = 'EXPLORE';
  readonly events: ExecutionEvent[] = [];
  readonly state: ExecutionState = {
    currentPlan: null,
    completedSteps: [],
    pendingSteps: [],
    filesCreated: [],
    filesModified: [],
    validationResults: [],
    repairAttempts: 0,
    status: 'IDLE',
  };

  snapshot: ProjectSnapshot | null = null;

  setPhase(phase: ExecutionPhase): void {
    this.phase = phase;
    this.events.push({ type: 'phase', phase, detail: {}, at: Date.now() });
  }

  recordEvent(type: ExecutionEvent['type'], detail: Record<string, unknown>): void {
    this.events.push({ type, phase: this.phase, detail, at: Date.now() });
  }

  transition(next: RuntimeStatus): void {
    if (!transitions[this.state.status].includes(next)) {
      throw new Error(`Invalid runtime transition: ${this.state.status} -> ${next}`);
    }
    this.state.status = next;
  }

  setSnapshot(snapshot: ProjectSnapshot): void { this.snapshot = snapshot; }

  setPlan(plan: ExecutionPlan): void {
    this.state.currentPlan = plan;
    this.state.pendingSteps = [
      ...plan.files.map((file) => `${file.action}:${file.path}`),
      ...plan.commands.filter((command) => command.required).map((command) => `command:${command.command}`),
      ...plan.requirements.map((requirement) => `requirement:${requirement.id}`),
      ...plan.validationCommands.filter((command) => command.required).map((command) => `validation:${command.command}`),
    ];
  }

  recordStep(step: string): void {
    if (!this.state.completedSteps.includes(step)) this.state.completedSteps.push(step);
    this.state.pendingSteps = this.state.pendingSteps.filter((pending) => pending !== step);
  }

  recordFile(path: string, action: 'create' | 'modify'): void {
    const target = action === 'create' ? this.state.filesCreated : this.state.filesModified;
    if (!target.includes(path)) target.push(path);
    this.recordStep(`${action}:${path}`);
  }

  recordValidation(result: ValidationResult): void { this.state.validationResults.push(result); }

  beginRepair(): boolean {
    if (this.state.repairAttempts >= 3) return false;
    this.state.repairAttempts += 1;
    return true;
  }

  finish(status: Extract<RuntimeStatus, 'SUCCESS' | 'FAILED' | 'NEEDS_USER_INPUT' | 'CANCELLED'>): void {
    if (!['SUCCESS', 'FAILED', 'NEEDS_USER_INPUT', 'CANCELLED'].includes(status)) throw new Error(`Invalid final status: ${status}`);
    if (status === 'SUCCESS' && (this.state.pendingSteps.length > 0 || this.state.validationResults.some((result) => !result.passed))) {
      throw new Error('Cannot finish SUCCESS while work is pending or validation has failed.');
    }
    this.state.status = status;
  }
}
