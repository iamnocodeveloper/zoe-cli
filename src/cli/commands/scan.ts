import { Command } from 'commander';
import { scanProject, getProjectSummary } from '../../core/intelligence.js';
import { requireAuth } from '../../core/auth.js';
import { success, error, info, checkmark } from '../../ui/styles.js';

export async function scan() {
  try {
    const authResult = await requireAuth();
    if (!authResult.success) {
      console.error(error(`Authentication failed: ${authResult.error}`));
      process.exit(1);
    }

    console.log(info('Scanning project...'));
    console.log();

    const intelligence = await scanProject();

    console.log();
    console.log(`${checkmark()} ${success('Scan complete!')}`);
    console.log();
    console.log(getProjectSummary(intelligence));
    console.log();
    console.log(`  Results saved to .zoe/project-intelligence.json`);
    console.log();
  } catch (err: any) {
    console.error(error(`Error: ${err.message}`));
    process.exit(1);
  }
}

export const scanCommand = new Command('scan')
  .description('Scan project structure and dependencies')
  .action(scan);
