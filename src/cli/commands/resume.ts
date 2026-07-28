import { Command } from 'commander';
import { checkpointStorage } from '../../core/checkpoint-storage.js';
import { availableValidationCommands, runValidationCommand } from '../../core/execution-runtime.js';
import { createSafeResumeCoordinator, type ResumeOutcome } from '../../core/safe-resume.js';

export function renderResumeOutcome(outcome: ResumeOutcome): void {
  console.log(`Resume: ${outcome.status}`);
  console.log(`Task: ${outcome.taskId}`);
  if (outcome.checkpointId) console.log(`Checkpoint: ${outcome.checkpointId}`);
  if (outcome.resumeStage) console.log(`Stage: ${outcome.resumeStage}`);
  console.log(`Workspace: ${outcome.workspaceStatus}`);
  console.log(`Permissions: ${outcome.permissionStatus}`);
  console.log(`Validation: ${outcome.validationStatus}`);
  if (outcome.errorCode) console.log(`Reason: ${outcome.errorCode}`);
}

export const resumeCommand = new Command('resume')
  .description('Explicitly resume one eligible local checkpoint')
  .argument('<taskId>', 'Task ID whose checkpoint should resume')
  .option('--approve-validation', 'Approve re-running stored validation commands')
  .action(async (taskId: string, options: { approveValidation?: boolean }) => {
    const coordinator = createSafeResumeCoordinator({
      storage: checkpointStorage,
      revalidatePermissions: async (context, stage) => {
        const needsCommands = stage === 'Validation' && context.checkpoint.validationState.resultNames.length > 0;
        return needsCommands && !options.approveValidation ? 'DENIED' : 'REVALIDATED';
      },
      runValidation: async (context) => {
        const allowed = new Set(availableValidationCommands(context.workspace.workspaceRoot));
        const commands = context.checkpoint.validationState.resultNames;
        if (commands.length === 0 || commands.some((command) => !allowed.has(command))) return 'FAILED';
        const results = await Promise.all(commands.map((command) => runValidationCommand(command, context.workspace.workspaceRoot)));
        return results.every((result) => result.passed) ? 'PASSED' : 'FAILED';
      },
      // Reviewer inputs are intentionally absent from checkpoint metadata. A pending reviewer
      // cannot be reconstructed safely without runtime replay, so the CLI rejects that boundary.
      runRendering: async () => undefined,
      runCleanup: async () => undefined,
    });
    const outcome = await coordinator.resume(taskId);
    renderResumeOutcome(outcome);
    if (outcome.status === 'RESUME_REJECTED') process.exitCode = 1;
  });
