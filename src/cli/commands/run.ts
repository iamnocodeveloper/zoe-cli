import { Command } from 'commander';
import { getCurrentUser } from '../../core/insforge.js';
import { loadIntelligence, scanProject } from '../../core/intelligence.js';
import { runAgent } from '../../core/agent.js';
import { success, error, info, muted, GRAY, RESET } from '../../ui/styles.js';

export const runCommand = new Command('run')
  .description('Execute a specific task with Zoe')
  .argument('<prompt>', 'Task description')
  .option('-m, --model <model>', 'Override model for this run')
  .option('-o, --output <file>', 'Save output to file')
  .action(async (prompt: string, options) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        console.log();
        console.log(info('Not logged in.'));
        console.log();
        console.log(`  Run ${success('zoe login')} to sign in first.`);
        console.log();
        process.exit(1);
      }

      const intelligence = loadIntelligence();
      if (!intelligence) {
        console.log(info('Scanning project...'));
        await scanProject();
        console.log(success('Scan complete!'));
        console.log();
      }

      console.log();
      console.log(`${info('Task:')} ${prompt}`);
      console.log();

      const result = await runAgent(prompt);

      console.log();
      console.log(`${success('Task completed!')}`);
      console.log();
      console.log(`${muted('Output:')}`);
      console.log(result);
      console.log();

      if (options.output) {
        const { writeFileSync } = await import('fs');
        writeFileSync(options.output, result, 'utf-8');
        console.log(`${success('Output saved to:')} ${options.output}`);
        console.log();
      }
    } catch (err: any) {
      console.error(error(`Error: ${err.message}`));
      process.exit(1);
    }
  });
