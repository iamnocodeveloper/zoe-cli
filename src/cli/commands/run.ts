import { Command } from 'commander';
import { getCurrentUser } from '../../core/insforge.js';
import { taskOrchestrator } from '../../core/task-orchestrator.js';
import { renderTaskOutcome } from '../task-result-renderer.js';
import { success, info } from '../../ui/styles.js';
import { previewTaskContext } from '../task-preview-renderer.js';

/** Legacy/unregistered command kept as a compatibility adapter for programmatic callers. */
export const runCommand = new Command('run')
  .description('Execute a specific task with Zoe')
  .argument('<prompt>', 'Task description')
  .option('-m, --model <model>', 'Override model for this run')
  .option('-o, --output <file>', 'Save output to file')
  .action(async (prompt: string, options) => {
    const user = await getCurrentUser();
    if (!user) {
      console.log(`\n  ${info('Not logged in.')}\n\n  Run ${success('zoe login')} to sign in first.\n`);
      process.exitCode = 1;
      return;
    }
    const result = await taskOrchestrator.run(prompt, 'run-command', { onPreview: previewTaskContext });
    renderTaskOutcome(result);
    if (options.output) {
      const { writeFileSync } = await import('fs');
      writeFileSync(options.output, result.message, 'utf-8');
      console.log(`${success('Output saved to:')} ${options.output}`);
    }
  });
