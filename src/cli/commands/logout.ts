import { Command } from 'commander';
import { logout } from '../../core/insforge.js';
import { success, info, checkmark } from '../../ui/styles.js';

export const logoutCommand = new Command('logout')
  .description('Logout and clear session')
  .action(async () => {
    try {
      await logout();
      console.log();
      console.log(`${checkmark()} ${success('Logged out successfully.')}`);
      console.log();
      console.log(`  ${info('Run')} zoe login ${info('to sign in again.')}`);
      console.log();
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
