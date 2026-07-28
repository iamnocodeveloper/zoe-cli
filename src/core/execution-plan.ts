import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { detectPackageManager, resolvePlannedFile } from './execution-runtime.js';
import type { UserConstraints } from './user-intent.js';
import type { WorkspaceContext } from './workspace-intelligence.js';

const fileActionSchema = z.object({
  path: z.string().min(1),
  action: z.enum(['create', 'modify']),
  purpose: z.string().min(1),
});

const commandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1),
  purpose: z.string().min(1),
  required: z.boolean(),
});

const requirementSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  verification: z.discriminatedUnion('type', [
    z.object({ type: z.literal('file_exists'), path: z.string().min(1) }),
    z.object({ type: z.literal('file_contains'), path: z.string().min(1), patterns: z.array(z.string().min(1)).min(1) }),
    z.object({ type: z.literal('command_succeeds'), command: z.string().min(1), cwd: z.string().min(1) }),
  ]),
});

const requestedChangeSchema = z.object({
  file: z.string().min(1),
  operation: z.literal('replace_headline'),
  exactValue: z.string().min(1),
});

export const executionPlanSchema = z.object({
  summary: z.string().min(1),
  framework: z.string().nullable(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']).nullable(),
  files: z.array(fileActionSchema),
  commands: z.array(commandSchema),
  requirements: z.array(requirementSchema),
  requestedChanges: z.array(requestedChangeSchema).default([]),
  validationCommands: z.array(commandSchema),
  userConstraints: z.object({
    allowedFiles: z.array(z.string()),
    forbiddenFiles: z.array(z.string()),
    allowDependencyInstall: z.boolean(),
    allowNewFiles: z.boolean(),
  }),
  risks: z.array(z.string()),
  estimatedMinutes: z.number().nonnegative(),
});

export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export type RuntimeStatus = 'IDLE' | 'ANALYZING' | 'PLANNING' | 'EXECUTING' | 'VERIFYING' | 'REPAIRING' | 'SUCCESS' | 'FAILED' | 'NEEDS_USER_INPUT' | 'CANCELLED';

export type ValidationResult = {
  name: string;
  passed: boolean;
  output?: string;
  error?: string;
};

export type ExecutionState = {
  currentPlan: ExecutionPlan | null;
  completedSteps: string[];
  pendingSteps: string[];
  filesCreated: string[];
  filesModified: string[];
  validationResults: ValidationResult[];
  repairAttempts: number;
  status: RuntimeStatus;
};

export type ProjectSnapshot = {
  root: string;
  framework: string | null;
  language: 'typescript' | 'javascript' | null;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
  sourceDir: string | null;
  entryFile: string | null;
  appFile: string | null;
  styleFile: string | null;
  scripts: Record<string, string>;
  configFiles: string[];
  hasPackageJson: boolean;
  isEmpty: boolean;
};

export function parseExecutionPlan(raw: string, authoritativeConstraints?: UserConstraints): { success: true; plan: ExecutionPlan } | { success: false; error: string } {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return { success: false, error: 'Planner response must contain JSON only.' };
  try {
    const candidate = JSON.parse(trimmed);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      if (typeof candidate.risks === 'string') candidate.risks = [candidate.risks];
      else if (!Object.hasOwn(candidate, 'risks')) candidate.risks = [];
    }
    const parsed = executionPlanSchema.parse(candidate);
    const plan = authoritativeConstraints ? {
      ...parsed,
      userConstraints: {
        allowedFiles: authoritativeConstraints.allowedFiles,
        forbiddenFiles: authoritativeConstraints.forbiddenFiles,
        allowDependencyInstall: authoritativeConstraints.allowDependencyInstall,
        allowNewFiles: authoritativeConstraints.allowNewFiles,
      },
    } : parsed;
    return { success: true, plan };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invalid execution plan.' };
  }
}

export function validateExecutionPlan(plan: ExecutionPlan, snapshot: ProjectSnapshot): string[] {
  const errors: string[] = [];
  const allowed = new Set(plan.userConstraints.allowedFiles.map(normalizePlanPath));
  const forbidden = new Set(plan.userConstraints.forbiddenFiles.map(normalizePlanPath));
  for (const file of plan.files) {
    const normalized = normalizePlanPath(file.path);
    if (normalized.startsWith('..')) errors.push(`File outside workspace: ${file.path}`);
    if (forbidden.has(normalized)) errors.push(`Forbidden file: ${file.path}`);
    if (!plan.userConstraints.allowNewFiles && file.action === 'create') errors.push(`New file not allowed: ${file.path}`);
    if (allowed.size > 0 && !allowed.has(normalized)) errors.push(`File is not allowed: ${file.path}`);
    if (snapshot.language === 'typescript' && /\.jsx?$/.test(normalized) && !/\.tsx?$/.test(normalized)) {
      errors.push(`Plan changes JavaScript in a TypeScript project: ${file.path}`);
    }
  }
  for (const command of [...plan.commands, ...plan.validationCommands]) {
    if (!plan.userConstraints.allowDependencyInstall && /\b(npm|pnpm|yarn|bun)\s+(install|add|remove)\b/.test(command.command)) {
      errors.push(`Dependency installation is not allowed: ${command.command}`);
    }
  }
  if (snapshot.hasPackageJson && plan.commands.some((command) => /\bnpm\s+init\b/.test(command.command))) errors.push('Cannot run npm init in an existing project.');
  return [...new Set(errors)];
}

export function validateRuntimeConstraints(plan: ExecutionPlan, constraints: UserConstraints): string[] {
  const errors: string[] = [];
  const required = new Set(constraints.requiredValidationCommands.map((command) => command.trim().toLowerCase()));
  const planned = new Set(plan.validationCommands.map((command) => command.command.trim().toLowerCase()));
  for (const command of required) if (!planned.has(command)) errors.push(`Missing required validation command: ${command}`);
  if (!constraints.allowCommands && [...plan.commands, ...plan.validationCommands].length > 0) errors.push('Commands are not allowed by the user.');
  return errors;
}

export function createProjectSnapshot(root = process.cwd()): ProjectSnapshot {
  const packagePath = path.join(root, 'package.json');
  let pkg: any = {};
  try { pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')); } catch { /* empty project */ }
  const files = walk(root);
  const source = files.find((file) => /(^|[\\/])src$/.test(path.dirname(file))) ?? files.find((file) => file.includes(`${path.sep}src${path.sep}`));
  const ts = files.some((file) => /\.(ts|tsx)$/.test(file));
  const appFile = files.find((file) => /(^|[\\/])App\.(tsx?|jsx?)$/.test(file));
  const entryFile = files.find((file) => /(^|[\\/])(main|index)\.(tsx?|jsx?)$/.test(file));
  const styleFile = files.find((file) => /(^|[\\/])App\.css$/.test(file));
  const configFiles = files.filter((file) => /(vite|tsconfig|eslint|tailwind|webpack|next)\./i.test(path.basename(file)));
  const framework = pkg.dependencies?.vite || pkg.devDependencies?.vite ? 'react-vite' : pkg.dependencies?.next ? 'next' : null;
  return {
    root, framework, language: ts ? 'typescript' : files.some((file) => /\.jsx?$/.test(file)) ? 'javascript' : null,
    packageManager: fs.existsSync(path.join(root, 'package.json')) ? detectPackageManager(root) : null,
    sourceDir: source ? path.relative(root, path.dirname(source)) : null,
    entryFile: entryFile ? path.relative(root, entryFile) : null,
    appFile: appFile ? path.relative(root, appFile) : null,
    styleFile: styleFile ? path.relative(root, styleFile) : null,
    scripts: pkg.scripts ?? {}, configFiles: configFiles.map((file) => path.relative(root, file)),
    hasPackageJson: fs.existsSync(packagePath), isEmpty: files.length === 0,
  };
}

/** Adapts the canonical workspace inventory without triggering another scan. */
export function createProjectSnapshotFromWorkspace(workspace: WorkspaceContext): ProjectSnapshot {
  const files = workspace.files.map((file) => file.relativePath);
  const source = files.find((file) => /(^|\/)src\//.test(file));
  const appFile = files.find((file) => /(^|\/)App\.(tsx?|jsx?)$/.test(file));
  const entryFile = workspace.entryPoints[0] || null;
  const styleFile = files.find((file) => /(^|\/)App\.css$/.test(file));
  let scripts: Record<string, string> = {};
  try { scripts = JSON.parse(fs.readFileSync(path.join(workspace.workspaceRoot, 'package.json'), 'utf8')).scripts ?? {}; } catch { /* no package manifest */ }
  return {
    root: workspace.workspaceRoot, framework: workspace.framework,
    language: workspace.language === 'TypeScript' ? 'typescript' : workspace.language === 'JavaScript' ? 'javascript' : null,
    packageManager: workspace.packageManager, sourceDir: source ? path.posix.dirname(source) : null,
    entryFile, appFile: appFile || null, styleFile: styleFile || null, scripts,
    configFiles: [...workspace.configFiles], hasPackageJson: files.includes('package.json'), isEmpty: files.length === 0,
  };
}

function normalizePlanPath(value: string): string { return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''); }
function walk(root: string): string[] {
  const result: string[] = [];
  const visit = (directory: string): void => {
    let entries: fs.Dirent[]; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name); if (entry.isDirectory()) visit(file); else result.push(file);
    }
  };
  visit(root); return result;
}
