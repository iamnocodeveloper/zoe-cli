import type { TaskContext } from './task-orchestrator.js';
import type { GitRepositoryContext } from './git-awareness.js';

export type PreviewIntent = 'Ask' | 'Inspect' | 'Build';
export type PreviewComplexity = 'LOW' | 'MEDIUM' | 'HIGH';
export type ProjectChangePrediction = 'No Changes' | 'Possible Changes' | 'Expected Changes';
export type PermissionExpectation = 'None Expected' | 'Possible' | 'Required';

export interface TaskPreview {
  readonly taskId: string;
  readonly intent: PreviewIntent;
  readonly pipeline: 'Conversational Pipeline' | 'Structured Pipeline';
  readonly workspace: Readonly<{ name: string; language: string; framework: string }>;
  readonly git: GitRepositoryContext;
  readonly projectChanges: ProjectChangePrediction;
  readonly validationPlan: readonly string[];
  readonly permissionExpectations: PermissionExpectation;
  readonly complexity: PreviewComplexity;
  readonly expectedOutput: string;
  readonly timestamp: number;
}

const INSPECTION = /\b(analy[sz]e|inspect|review|explain|describe|find|check|audit|investigate|understand)\b/i;
const MUTATION = /\b(create|add|build|make|implement|fix|change|edit|modify|update|delete|remove|write|generate|install|refactor|migrate|rename|move)\b/i;
const HIGH = /\b(large|entire|whole|all files|across the project|refactor|migrate|rewrite|redesign|architecture|monorepo)\b/i;
const MULTI = /\b(multiple|several|pages|components|files|features|project|application|app)\b/i;
const REQUIRED_PERMISSION = /\b(install|remove|delete|write|edit|modify|create|run|execute|shell|command)\b/i;

export function presentIntent(context: Readonly<TaskContext>): PreviewIntent {
  if (context.mode === 'CHAT_MODE') return 'Ask';
  if (INSPECTION.test(context.normalizedInput) && !MUTATION.test(context.normalizedInput)) return 'Inspect';
  return 'Build';
}

export function estimatePreviewComplexity(context: Readonly<TaskContext>, intent = presentIntent(context)): PreviewComplexity {
  if (intent === 'Ask' || intent === 'Inspect') return 'LOW';
  if (HIGH.test(context.normalizedInput)) return 'HIGH';
  if (MULTI.test(context.normalizedInput) || (context.normalizedInput.match(/\b(?:and|then|also)\b/gi)?.length || 0) >= 2) return 'MEDIUM';
  return 'LOW';
}

export function createTaskPreview(context: Readonly<TaskContext>, now: () => number = Date.now): TaskPreview {
  const started = now();
  const intent = presentIntent(context);
  const complexity = estimatePreviewComplexity(context, intent);
  const structured = context.mode === 'TASK_MODE';
  const projectChanges: ProjectChangePrediction = intent === 'Ask' || intent === 'Inspect' ? 'No Changes' : MUTATION.test(context.normalizedInput) ? 'Expected Changes' : 'Possible Changes';
  const validations: string[] = [];
  if (structured) {
    const files = new Set(context.workspaceContext.files.map((file) => file.relativePath.toLowerCase()));
    if (files.has('package.json')) validations.push('Tests');
    if (files.has('tsconfig.json')) validations.push('Typecheck');
    if (files.has('package.json') || files.has('cargo.toml') || files.has('go.mod') || files.has('pubspec.yaml')) validations.push('Build');
    validations.push('Reviewer');
  }
  const permissionExpectations: PermissionExpectation = projectChanges === 'No Changes' ? 'None Expected' : REQUIRED_PERMISSION.test(context.normalizedInput) ? 'Required' : 'Possible';
  const preview: TaskPreview = {
    taskId: context.taskId,
    intent,
    pipeline: structured ? 'Structured Pipeline' : 'Conversational Pipeline',
    workspace: Object.freeze({ name: context.workspaceContext.projectName, language: context.workspaceContext.language || 'Unknown', framework: context.workspaceContext.framework || context.workspaceContext.detectedFrameworks[0] || 'Unknown' }),
    git: context.workspaceContext.gitContext,
    projectChanges,
    validationPlan: Object.freeze(validations.length ? validations : ['No validation']),
    permissionExpectations,
    complexity,
    expectedOutput: intent === 'Ask' ? 'Answer' : intent === 'Inspect' ? 'Project analysis' : 'Verified project changes',
    timestamp: started,
  };
  if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe preview] generated taskId=${preview.taskId} intent=${preview.intent} pipeline=${preview.pipeline.replace(' Pipeline', '')} complexity=${preview.complexity} durationMs=${now() - started}`);
  return Object.freeze(preview);
}
