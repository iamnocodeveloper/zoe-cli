import chalk from 'chalk';
import { createInterface } from 'node:readline';
import type { TaskPreview } from '../core/task-preview.js';
import { createTaskPreview } from '../core/task-preview.js';
import type { TaskContext } from '../core/task-orchestrator.js';

export function renderTaskPreview(preview: TaskPreview): void {
  const row = (label: string, value: string) => console.log(`  ${chalk.gray(`${label}:`.padEnd(21))}${value}`);
  console.log('');
  console.log(`  ${chalk.cyan('─'.repeat(60))}`);
  row('Task', preview.taskId);
  row('Intent', preview.intent);
  row('Pipeline', preview.pipeline);
  row('Workspace', `${preview.workspace.name} · ${preview.workspace.language} · ${preview.workspace.framework}`);
  if (!preview.git.repositoryDetected && preview.git.workingTreeState === 'NOT_A_REPOSITORY') row('Git', 'Repository: No');
  else if (preview.git.workingTreeState === 'UNAVAILABLE' || preview.git.workingTreeState === 'UNKNOWN') row('Git', `Status: ${preview.git.workingTreeState === 'UNKNOWN' ? 'Unknown' : 'Unavailable'}`);
  else {
    const branch = preview.git.detachedHead ? 'detached HEAD' : (preview.git.currentBranch || 'unknown branch');
    const changes = preview.git.workingTreeState === 'CLEAN' ? '' : ` · ${preview.git.stagedFiles.length} staged, ${preview.git.unstagedFiles.length} unstaged, ${preview.git.untrackedFiles.length} untracked`;
    row('Git', `${branch} · ${preview.git.workingTreeState} · ${(preview.git.headCommit || 'no HEAD').slice(0, 8)}${changes}`);
  }
  row('Project Changes', preview.projectChanges);
  row('Validation', preview.validationPlan.join(', '));
  row('Permission Prompts', preview.permissionExpectations);
  row('Complexity', preview.complexity);
  row('Expected Output', preview.expectedOutput);
  console.log(`  ${chalk.cyan('─'.repeat(60))}`);
  console.log('');
}

export async function pauseForHighComplexity(preview: TaskPreview, read?: () => Promise<string>): Promise<void> {
  if (preview.pipeline !== 'Structured Pipeline' || preview.complexity !== 'HIGH') return;
  if (read) { await read(); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { await new Promise<void>((resolve) => rl.question('  Press ENTER to continue...', () => resolve())); }
  finally { rl.close(); }
}

export async function previewTaskContext(context: Readonly<TaskContext>): Promise<void> {
  const preview = createTaskPreview(context);
  renderTaskPreview(preview);
  await pauseForHighComplexity(preview);
}
