import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type RuntimeStatus = 'SUCCESS' | 'FAILED' | 'NEEDS_USER_INPUT' | 'CANCELLED';

export type ExecutionPlan = {
  filesToCreate: string[];
  filesToModify: string[];
  requirements: string[];
  validationCommands: string[];
  successCriteria: string[];
};

export type ValidationResult = {
  command: string;
  passed: boolean;
  output: string;
};

export type ExecutionRuntimeState = {
  currentPlan: ExecutionPlan;
  completedSteps: string[];
  pendingSteps: string[];
  filesCreated: string[];
  filesModified: string[];
  plannedRequirements: string[];
  implementedRequirements: string[];
  validationResults: ValidationResult[];
  repairAttempts: number;
  status: RuntimeStatus;
};

export type RuntimeInspection = {
  filesCreated?: string[];
  filesModified?: string[];
  implementedRequirements?: string[];
};

export function createExecutionRuntime(plan: ExecutionPlan): ExecutionRuntime {
  const pendingSteps = [
    ...plan.filesToCreate.map((file) => `create:${file}`),
    ...plan.filesToModify.map((file) => `modify:${file}`),
    ...plan.requirements.map((requirement) => `requirement:${requirement}`),
  ];
  return new ExecutionRuntime({
    currentPlan: plan,
    completedSteps: [],
    pendingSteps,
    filesCreated: [],
    filesModified: [],
    plannedRequirements: [...plan.requirements],
    implementedRequirements: [],
    validationResults: [],
    repairAttempts: 0,
    status: 'NEEDS_USER_INPUT',
  });
}

export class ExecutionRuntime {
  constructor(public readonly state: ExecutionRuntimeState) {}

  inspect(inspection: RuntimeInspection): void {
    for (const file of inspection.filesCreated ?? []) this.addUnique(this.state.filesCreated, file);
    for (const file of inspection.filesModified ?? []) this.addUnique(this.state.filesModified, file);
    for (const requirement of inspection.implementedRequirements ?? []) {
      this.addUnique(this.state.implementedRequirements, requirement);
    }
    this.reconcilePendingSteps();
  }

  completeStep(step: string): void {
    this.addUnique(this.state.completedSteps, step);
    this.state.pendingSteps = this.state.pendingSteps.filter((candidate) => candidate !== step);
  }

  recordValidation(result: ValidationResult): void {
    this.state.validationResults.push(result);
  }

  beginRepair(): boolean {
    if (this.state.repairAttempts >= 3) return false;
    this.state.repairAttempts += 1;
    return true;
  }

  finish(): RuntimeStatus {
    this.reconcilePendingSteps();
    const filesExist = [...this.state.currentPlan.filesToCreate, ...this.state.currentPlan.filesToModify]
      .every((file) => resolvePlannedFile(file) !== undefined);
    const requirementsComplete = this.state.plannedRequirements.every((requirement) =>
      this.state.implementedRequirements.includes(requirement),
    );
    const validationsPass = this.state.validationResults.every((result) => result.passed);
    if (this.state.pendingSteps.length === 0 && filesExist && requirementsComplete && validationsPass) {
      this.state.status = 'SUCCESS';
    } else if (this.state.status !== 'CANCELLED' && this.state.status !== 'NEEDS_USER_INPUT') {
      this.state.status = 'FAILED';
    }
    return this.state.status;
  }

  markFailed(): void { this.state.status = 'FAILED'; }
  markCancelled(): void { this.state.status = 'CANCELLED'; }
  markNeedsUserInput(): void { this.state.status = 'NEEDS_USER_INPUT'; }

  private reconcilePendingSteps(): void {
    const existingFiles = new Set([...this.state.filesCreated, ...this.state.filesModified]);
    this.state.pendingSteps = this.state.pendingSteps.filter((step) => {
      if (step.startsWith('create:') || step.startsWith('modify:')) return !existingFiles.has(step.slice(step.indexOf(':') + 1));
      if (step.startsWith('requirement:')) return !this.state.implementedRequirements.includes(step.slice('requirement:'.length));
      return true;
    });
  }

  private addUnique(list: string[], value: string): void { if (value && !list.includes(value)) list.push(value); }
}

/** Resolves plan paths without assuming the plan's cwd is the CLI cwd. */
export function resolvePlannedFile(file: string, cwd = process.cwd()): string | undefined {
  const normalized = file.replace(/^\.\//, '').replace(/\\/g, '/');
  const direct = path.resolve(cwd, normalized);
  if (fs.existsSync(direct)) return direct;
  const matches: string[] = [];
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile() && (candidate.endsWith(normalized) || entry.name === path.basename(normalized))) matches.push(candidate);
    }
  };
  walk(cwd);
  return matches.length === 1 ? matches[0] : undefined;
}

export function detectPackageManager(cwd = process.cwd()): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) return 'bun';
  return 'npm';
}

export function availableValidationCommands(cwd = process.cwd()): string[] {
  const packageFile = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageFile)) return [];
  try {
    const scripts = JSON.parse(fs.readFileSync(packageFile, 'utf8')).scripts ?? {};
    const manager = detectPackageManager(cwd);
    return ['build', 'typecheck', 'lint', 'test']
      .filter((name) => typeof scripts[name] === 'string' && !/watch|dev|start/.test(scripts[name]))
      .map((name) => `${manager} run ${name}`);
  } catch { return []; }
}

export async function runValidationCommand(command: string, cwd = process.cwd()): Promise<ValidationResult> {
  const [program, ...args] = command.split(' ');
  try {
    const result = await execFileAsync(program, args, { cwd, timeout: 120_000, maxBuffer: 512 * 1024 });
    return { command, passed: true, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim() };
  } catch (error: any) {
    return { command, passed: false, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message ?? ''}`.trim() };
  }
}
