import { Command } from 'commander';
import { loginWithGithub, getCurrentUser, logout as insforgeLogout } from '../../core/insforge.js';
import { saveSession, clearSession, getSession } from '../../core/config.js';
import chalk from 'chalk';

export async function login() {
  try {
    console.log(chalk.cyan('  🔐  Setting up authentication...'));
    const session = await loginWithGithub();

    if (session && session.user) {
      saveSession({
        user: session.user.name || session.user.email,
        email: session.user.email,
        projectId: session.projectId,
        token: session.token,
        apiKey: session.apiKey || undefined,
        lastLogin: new Date().toISOString(),
      });

      console.log(chalk.green('  ✅  Ready!'));
      if (session.user.email) {
        console.log(chalk.gray(`  👤  Signed in as: ${session.user.email}`));
      }
      console.log(chalk.gray('  💡  Run "zoe" to start'));
      // Clean exit so the next "zoe" command runs in a fresh process
      process.exit(0);
    } else {
      console.log(chalk.red('  ✖  Authentication failed'));
      process.exit(1);
    }
  } catch (error: any) {
    console.log(chalk.red(`  ✖  ${error.message || 'Authentication failed'}`));
    process.exit(1);
  }
}

export async function whoami() {
  const session = getSession();
  if (session.user) {
    console.log(chalk.green(`  👤  User: ${session.user}`));
    console.log(chalk.gray(`  🕐  Last login: ${session.lastLogin || 'N/A'}`));
  } else {
    console.log(chalk.yellow('  ℹ️  Not logged in. Run: zoe login'));
  }
}

export async function logout() {
  const session = getSession();
  if (!session.user) {
    console.log(chalk.yellow('  ℹ️  No active session.'));
    return;
  }

  console.log(chalk.yellow(`  🔓  Logging out: ${session.user}`));
  await insforgeLogout();
  clearSession();
  console.log(chalk.green('  ✅  Logged out'));
}

export const loginCommand = new Command('login')
  .description('Set up authentication')
  .action(login);

export const whoamiCommand = new Command('whoami')
  .description('Show current user')
  .action(whoami);

export const logoutCommand = new Command('logout')
  .description('Logout and clear session')
  .action(logout);
