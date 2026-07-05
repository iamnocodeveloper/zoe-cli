import chalk from 'chalk';
import { ZOE_LOGO, ZOE_DIVIDER, ZOE_FOOTER } from './logo.js';
import { getProjectStats } from '../core/intelligence.js';

export function displayWelcome(user: string, model: string, projectName: string) {
  const stats = getProjectStats();

  console.clear();
  console.log(chalk.cyan(ZOE_LOGO));
  console.log('');
  console.log(chalk.gray(ZOE_DIVIDER));
  console.log('');
  console.log(`  ${chalk.white('👤  User:')}      ${chalk.green(user)}`);
  console.log(`  ${chalk.white('🤖  Model:')}     ${chalk.yellow(model)}`);
  console.log(`  ${chalk.white('📁  Project:')}   ${chalk.blue(projectName)}`);
  console.log(`  ${chalk.white('📊  Files:')}     ${chalk.magenta(stats.files.toString())}  │  ${chalk.white('Lines:')}  ${chalk.magenta(stats.lines.toString())}`);
  console.log(`  ${chalk.white('🧠  Analysis:')}  ${chalk.green('Project Intelligence ready ✓')}`);
  console.log('');
  console.log(chalk.gray(ZOE_DIVIDER));
  console.log('');
  console.log(`  ${chalk.gray('💬  Ask me anything about your project...')}`);
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
}) {
  console.log(`\n  ${chalk.green('─'.repeat(60))}`);
  console.log(`  ${chalk.green('✅')}  ${chalk.bold('Completed')}`);
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
    console.log(`\n  ${chalk.gray('▶️  Next:')} ${chalk.cyan(result.nextStep)}`);
  }
  console.log('');
}

export function displayFooter() {
  console.log('');
  console.log(chalk.gray(ZOE_FOOTER));
}
