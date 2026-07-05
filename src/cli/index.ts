#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { chat } from './commands/chat.js';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/login.js';
import { modelsCommand, useCommand } from './commands/models.js';
import { scanCommand } from './commands/scan.js';
import { doctorCommand } from './commands/doctor.js';
import { summaryCommand } from './commands/summary.js';
import { success, info, muted, DIM, RESET } from '../ui/styles.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read version from package.json
let version = '1.0.0';
try {
  const packageJson = JSON.parse(readFileSync(resolve('.zoe', '..', 'package.json'), 'utf-8'));
  version = packageJson.version || version;
} catch {
  // Ignore errors reading package.json
}

const program = new Command()
  .name('zoe')
  .description('Zoe - AI-powered coding assistant. Zero config, maximum power.')
  .version(version)
  .option('-v, --verbose', 'Enable verbose output');

program.on('option:version', async () => {
  const { displayVersion } = await import('./commands/version.js');
  await displayVersion();
  process.exit(0);
});

// Main command: "zoe" → starts interactive chat
// "zoe <prompt>" → runs the prompt directly
program
  .argument('[prompt]', 'Start chat or run a task directly')
  .option('-m, --model <model>', 'Override model for this session')
  .option('-i, --input <style>', 'Input style: block, bordered, plain', 'block')
  .option('-t, --tool-display <style>', 'Tool display: emoji, grouped, minimal, hidden', 'grouped')
  .action(async (prompt?: string, options?: any) => {
    await chat(prompt);
  });

// Subcommands (NO 'chat' subcommand)
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
program.addCommand(modelsCommand);
program.addCommand(useCommand);
program.addCommand(scanCommand);
program.addCommand(doctorCommand);
program.addCommand(summaryCommand);

// Rich version subcommand
const versionCommand = new Command('version')
  .description('Show Zoe version, model, and cloud status')
  .action(async () => {
    const { displayVersion } = await import('./commands/version.js');
    await displayVersion();
  });
program.addCommand(versionCommand);

// Add help text organized by sections
program.addHelpText('after', `
${chalk.bold('INSTALL')}
  ${muted('$')} npm install -g @nocodeveloper/zoe-cli

${chalk.bold('LOGIN')}
  ${chalk.cyan('zoe login')}           Open browser, sign in with GitHub
  ${chalk.cyan('zoe logout')}          Sign out and clear local session
  ${chalk.cyan('zoe whoami')}          Show current account

${chalk.bold('COMMANDS')}
  ${chalk.cyan('zoe')}                 Start interactive chat
  ${chalk.cyan('zoe "<task>"')}        Run a task directly
  ${chalk.cyan('zoe models')}          List available AI models
  ${chalk.cyan('zoe use <model>')}     Switch the active model
  ${chalk.cyan('zoe scan')}            Re-scan the current project
  ${chalk.cyan('zoe doctor')}          Verify environment, cloud, login
  ${chalk.cyan('zoe summary')}         Show project overview
  ${chalk.cyan('zoe --version')}       Version, model, cloud status
  ${chalk.cyan('zoe --help')}          Show this help

${chalk.bold('EXAMPLES')}
  ${muted('$')} zoe
  ${DIM}Start chatting. Try "Analyze this project".${RESET}

  ${muted('$')} zoe "Add a login form to index.html"
  ${DIM}Single-shot task: plan, build, review.${RESET}

  ${muted('$')} zoe "Create a Node.js CLI"
  ${DIM}Bootstrap a brand new project from scratch.${RESET}

${chalk.bold('IN-CHAT COMMANDS')}
  ${chalk.cyan('/model <name>')}       Switch model
  ${chalk.cyan('/scan')}              Re-scan project
  ${chalk.cyan('/help')}              In-chat help
  ${chalk.cyan('exit | quit')}         Leave Zoe

${chalk.gray('Docs:')}    ${info('https://github.com/iamnocodeveloper/zoe-cli')}
${chalk.gray('Issues:')}  ${info('https://github.com/iamnocodeveloper/zoe-cli/issues')}
`);

// Parse arguments
program.parse();
