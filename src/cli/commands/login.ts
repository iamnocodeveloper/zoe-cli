import { Command } from 'commander';
import { getAuthSessionStatus, loginWithGithub } from '../../core/insforge.js';
import { saveSession, getSession } from '../../core/config.js';
import chalk from 'chalk';

export async function login() {
  try {
    console.log(chalk.cyan('  🔐  Setting up authentication...'));
    const session = await loginWithGithub();
    if (!session?.user) {
      console.log(chalk.red('  ✖  Authentication failed'));
      return;
    }
    // Compatibility/display metadata only. auth.json remains credential authority.
    saveSession({
      user: session.user.name || session.user.email,
      email: session.user.email,
      projectId: session.projectId,
      token: session.token,
      apiKey: session.apiKey || undefined,
      lastLogin: new Date().toISOString(),
    });
    console.log(chalk.green('  ✅  Ready!'));
    console.log(chalk.gray(`  👤  Signed in as: ${session.user.email}`));
    console.log(chalk.gray('  🚀  Starting Zoe...\n'));
    const { chat } = await import('./chat.js');
    await chat();
  } catch (error: any) {
    console.log(chalk.red(`  ✖  ${error.message || 'Authentication failed'}`));
  }
}

export async function whoami() {
  if (!getAuthSessionStatus().authenticated) {
    console.log(chalk.yellow('  ℹ️  Not logged in. Run: zoe login'));
    return;
  }
  const session = getSession();
  console.log(chalk.green(`  👤  User: ${session.user || session.email || 'Authenticated Zoe user'}`));
  console.log(chalk.gray(`  🕐  Last login: ${session.lastLogin || 'N/A'}`));
}

export const loginCommand = new Command('login').description('Set up authentication').action(login);
export const whoamiCommand = new Command('whoami').description('Show current account').action(whoami);
