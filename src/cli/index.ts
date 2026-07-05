#!/usr/bin/env node

import { Command } from 'commander';
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

// Add help examples
program.addHelpText('after', `
${DIM}Examples:${RESET}
  ${muted('$')} zoe                              ${info('Start interactive chat')}
  ${muted('$')} zoe "Add authentication"         ${info('Run a task directly')}
  ${muted('$')} zoe login                        ${info('Login with GitHub')}
  ${muted('$')} zoe logout                       ${info('Logout')}
  ${muted('$')} zoe whoami                       ${info('Show current user')}
  ${muted('$')} zoe models                       ${info('List available models')}
  ${muted('$')} zoe use deepseek/deepseek-v4-flash ${info('Select a model')}
  ${muted('$')} zoe scan                         ${info('Scan project structure')}
  ${muted('$')} zoe doctor                       ${info('Check project health')}
  ${muted('$')} zoe summary                      ${info('Show project summary')}

${DIM}For more information on a command, run:${RESET}
  ${muted('$')} zoe <command> --help
`);

// Parse arguments
program.parse();
