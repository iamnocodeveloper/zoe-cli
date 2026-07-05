import chalk from 'chalk';
import { ZOE_LOGO, ZOE_DIVIDER, ZOE_FOOTER } from './logo.js';
import { getProjectStats } from '../core/intelligence.js';

export function displayWelcome(user: string, model: string, projectName: string) {
  const stats = getProjectStats();
  const projectIsEmpty = stats.files === 0;

  console.clear();
  console.log(chalk.cyan(ZOE_LOGO));
  console.log('');
  console.log(chalk.gray(ZOE_DIVIDER));
  console.log('');
  console.log(`  ${chalk.bold('Welcome to Zoe')}`);
  console.log(`  ${chalk.gray('Understand your project before AI does.')}`);
  console.log('');
  console.log(`  ${chalk.white('Project:')} ${chalk.blue(projectName)}${projectIsEmpty ? chalk.gray(' (empty)') : ''}`);

  if (!projectIsEmpty) {
    console.log(`  ${chalk.white('Files:')}   ${chalk.magenta(stats.files.toString())} ${chalk.gray('│')} ${chalk.white('Lines:')} ${chalk.magenta(stats.lines.toString())}`);
  }

  console.log('');
  console.log(chalk.gray(ZOE_DIVIDER));
  console.log('');

  if (projectIsEmpty) {
    displayEmptyProjectGuidance();
  } else {
    displayFirstRunSuggestions();
  }

  console.log('');
}

function displayFirstRunSuggestions(): void {
  console.log(`  ${chalk.bold('Try one of these:')}`);
  console.log('');
  console.log(`    ${chalk.cyan('•')} Analyze this project`);
  console.log(`    ${chalk.cyan('•')} Explain this codebase`);
  console.log(`    ${chalk.cyan('•')} Create a landing page`);
  console.log(`    ${chalk.cyan('•')} Find bugs in my project`);
  console.log('');
  console.log(`  ${chalk.gray('Type naturally. No slash commands required.')}`);
  console.log('');
}

function displayEmptyProjectGuidance(): void {
  console.log(`  ${chalk.yellow('⚠')}  ${chalk.bold('This directory is empty.')}`);
  console.log('');
  console.log(`  Zoe is ready to help. You can:`);
  console.log('');
  console.log(`    ${chalk.cyan('1.')} ${chalk.bold('Create a new project here')}`);
  console.log(`       ${chalk.gray('Example:')} "Create a Node.js CLI with TypeScript"`);
  console.log('');
  console.log(`    ${chalk.cyan('2.')} ${chalk.bold('Open an existing project')}`);
  console.log(`       ${chalk.gray('Run:')} cd /path/to/your/project && zoe`);
  console.log('');
}

const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];
let spinnerInterval: ReturnType<typeof setInterval> | null = null;

export function displayThinking() {
  if (spinnerInterval) return;

  let frame = 0;
  const start = Date.now();
  let msg = 'Zoe is thinking';

  process.stdout.write(chalk.cyan(`  ${SPINNER_FRAMES[0]}  ${msg}...`));

  spinnerInterval = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    const elapsed = Date.now() - start;

    if (elapsed > 15000) {
      msg = 'Still working, this is taking a while';
    } else if (elapsed > 5000) {
      msg = 'Still working';
    }

    process.stdout.write(`\r\x1b[K${chalk.cyan(`  ${SPINNER_FRAMES[frame]}  ${msg}...`)}`);
  }, 200);
}

export function clearThinking() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
  process.stdout.write('\r\x1b[K');
}

export function displayPhase(phase: string) {
  console.log(`  ${chalk.cyan('⟳')}  ${chalk.bold(phase)}`);
}

export function displayPlan(plan: string) {
  console.log(`\n  ${chalk.bold('📋 Execution Plan')}`);
  console.log(`  ${chalk.gray('─'.repeat(60))}`);
  const lines = plan.split('\n');
  for (const line of lines) {
    if (line.startsWith('###')) {
      console.log(`\n  ${chalk.white(line.replace('###', '').trim())}`);
    } else if (line.startsWith('- **')) {
      const match = line.match(/- \*\*(.+?)\*\*(.*)/);
      if (match) {
        console.log(`  ${chalk.cyan('•')} ${chalk.yellow(match[1])}${match[2]}`);
      } else {
        console.log(`  ${line}`);
      }
    } else if (line.trim()) {
      console.log(`  ${line}`);
    }
  }
  console.log(`  ${chalk.gray('─'.repeat(60))}`);
}

export function displayStep(step: string) {
  process.stdout.write(chalk.blue(`  📁  ${step}\n`));
}

export function displaySuccess(message: string) {
  process.stdout.write(chalk.green(`  ✅  ${message}\n`));
}

export function displayError(message: string) {
  process.stdout.write(chalk.red(`  ❌  ${message}\n`));
}

export function displayFriendlyError(error: string, suggestion?: string) {
  console.log(`\n  ${chalk.red('✖')}  ${chalk.bold('Task Failed')}`);
  console.log(`  ${chalk.gray('Reason:')}  ${error}`);
  if (suggestion) {
    console.log(`  ${chalk.gray('Suggestion:')}  ${suggestion}`);
  }
  console.log('');
}

export function displaySummary(result: {
  filesCreated: number;
  filesModified: number;
  warnings: string[];
  nextStep?: string;
  elapsedMs?: number;
}) {
  const elapsedStr = result.elapsedMs !== undefined
    ? chalk.gray(`  (${formatElapsed(result.elapsedMs)})`)
    : '';

  console.log('');
  console.log(`  ${chalk.green('─'.repeat(60))}`);
  console.log(`  ${chalk.green('✅')}  ${chalk.bold('Completed')}${elapsedStr}`);
  console.log(`  ${chalk.green('─'.repeat(60))}`);
  console.log(`  ${chalk.white('📄  Files created:')}  ${chalk.cyan(result.filesCreated.toString())}`);
  console.log(`  ${chalk.white('📝  Files modified:')} ${chalk.cyan(result.filesModified.toString())}`);
  if (result.warnings.length > 0) {
    console.log(`  ${chalk.yellow('⚠️   Warnings:')}     ${chalk.yellow(result.warnings.join(', '))}`);
  } else {
    console.log(`  ${chalk.white('⚠️   Warnings:')}     ${chalk.green('None')}`);
  }
  console.log(`  ${chalk.green('─'.repeat(60))}`);
  if (result.nextStep) {
    console.log('');
    console.log(`  ${chalk.gray('Next:')} ${chalk.cyan(result.nextStep)}`);
  }
  console.log('');
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

export function displayFooter() {
  console.log('');
  console.log(chalk.gray(ZOE_FOOTER));
}
