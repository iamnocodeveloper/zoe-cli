import { Command } from 'commander';
import { logout } from '../../core/insforge.js';
import { success, info, checkmark, warning } from '../../ui/styles.js';

export const logoutCommand = new Command('logout')
  .description('Logout and clear session')
  .action(async () => {
    try {
      const result = await logout();
      console.log();
      console.log(`${checkmark()} ${success('Logged out successfully.')}`);
      if (result.cloudRevocationFailed) console.log(`  ${warning('Local credentials were cleared, but Zoe Cloud sign-out could not be confirmed.')}`);
      console.log();
      console.log(`  ${info('Run')} zoe login ${info('to sign in again.')}`);
      console.log();
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
