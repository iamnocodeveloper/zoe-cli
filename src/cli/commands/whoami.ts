import { Command } from 'commander';
import { getCurrentUser } from '../../core/insforge.js';
import { success, error, info, checkmark, arrow, muted } from '../../ui/styles.js';

export const whoamiCommand = new Command('whoami')
  .description('Show current logged in user')
  .action(async () => {
    try {
      const user = await getCurrentUser();

      if (!user) {
        console.log();
        console.log(`  ${info('Not logged in.')}`);
        console.log();
        console.log(`  Run ${success('zoe login')} to sign in.`);
        console.log();
        return;
      }

      console.log();
      console.log(`${checkmark()} ${success('Authenticated')}`);
      console.log();
      console.log(`  ${arrow()} Email: ${user.email}`);
      if (user.name) {
        console.log(`  ${arrow()} Name: ${user.name}`);
      }
      if (user.id) {
        console.log(`  ${arrow()} ID: ${muted(user.id)}`);
      }
      console.log();
    } catch (err: any) {
      console.error(error(`Error: ${err.message}`));
      process.exit(1);
    }
  });
