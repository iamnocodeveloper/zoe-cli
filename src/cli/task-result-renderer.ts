import chalk from 'chalk';
import { displayFriendlyError, displaySummary } from '../ui/display.js';
import type { TaskOutcome } from '../core/task-orchestrator.js';

export function renderTaskOutcome(result: TaskOutcome): void {
  if (result.code === 'CANCELLED_BY_USER') {
    const metadata = result.metadata || {};
    console.log(`\n  ${chalk.yellow('■')}  ${chalk.bold('Task cancelled.')}`);
    console.log(`  ${chalk.gray('Task:')} ${result.taskId}`);
    console.log(`  ${chalk.gray('Stage:')} ${String(metadata.cancelledStage || 'Unknown')}`);
    console.log(`  ${chalk.gray('Reason:')} ${String(metadata.cancellationReason || 'User requested cancellation.')}`);
    console.log(`  ${chalk.gray('Rollback:')} Not implemented; completed work remains.\n`);
    return;
  }
  if (result.code === 'COMPLETED') {
    displaySummary({ filesCreated: result.changedFiles?.created || 0, filesModified: result.changedFiles?.modified || 0, warnings: result.warnings || [], status: 'SUCCESS', elapsedMs: 0 });
    return;
  }
  if (result.code === 'COMPLETED_UNVERIFIED') {
    console.log(chalk.gray(`\n  Response completed (unverified) · task ${result.taskId}\n`));
    return;
  }
  displayFriendlyError(result.message, result.suggestedNextAction || 'Review the task details and try again.');
}
