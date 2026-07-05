import { getSession, getModel, saveModel } from '../../core/config.js';
import { displayWelcome, clearThinking, displayFriendlyError, displayPlan, displaySummary } from '../../ui/display.js';
import { runAgent, createPlan, executePlan } from '../../core/agent.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import chalk from 'chalk';
import { createInterface } from 'readline';

const execAsync = promisify(exec);

const TERMINAL_COMMANDS = new Set([
  'npm', 'yarn', 'pnpm', 'bun', 'npx',
  'git',
  'ls', 'dir', 'pwd', 'cd', 'mkdir', 'rm', 'rmdir', 'touch', 'cp', 'mv', 'ln', 'cat', 'grep', 'find', 'tail', 'head', 'less', 'more', 'sort', 'uniq', 'wc',
  'node', 'python', 'python3', 'go', 'cargo', 'rustc', 'ruby', 'php', 'java',
  'docker', 'docker-compose', 'kubectl', 'helm', 'terraform', 'ansible',
  'curl', 'wget', 'ping', 'ssh', 'scp', 'rsync',
  'ps', 'kill', 'top', 'htop', 'pgrep', 'pkill',
  'echo', 'export', 'source', 'alias', 'unalias',
  'make', 'cmake', 'gcc', 'g++', 'clang',
  'psql', 'mysql', 'mongosh', 'redis-cli',
  'nano', 'vim', 'code', 'open',
]);

const TASK_KEYWORDS = [
  // English action verbs
  'create', 'build', 'add', 'generate', 'make',
  'modify', 'update', 'implement', 'develop',
  'install', 'configure', 'setup', 'refactor',
  'fix', 'repair', 'migrate', 'deploy',
  'edit', 'change', 'rename', 'move', 'delete', 'remove',
  'do', 'run', 'execute', 'start',
  // Spanish action verbs (tú form)
  'escribir', 'crear', 'generar', 'construir',
  'añadir', 'agregar', 'implementar', 'configurar',
  'escribe', 'crea', 'genera', 'construye',
  'añade', 'agrega', 'configura', 'instala',
  'modifica', 'actualiza', 'implementa',
  'edita', 'editala', 'editalo', 'cambia', 'cambiala', 'cambialo',
  'haz', 'hazme', 'mueve', 'renombra', 'borra', 'elimina',
  // Connectors that imply action ("si crea...", "please make...")
  'si', 'please', 'necesito', 'quiero',
];

// Spanish connector patterns — start of sentence followed by task
const TASK_CONNECTOR_PATTERNS = [
  /^(si|por favor|please|necesito|quiero|me puedes|puedes|ayúdame|hazme|haz)\s+/i,
  /^(puedes|podrías)\s+(crear|hacer|generar|construir|escribir|modificar|editar|cambiar)/i,
];

function isTerminalCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  const firstWord = trimmed.split(/\s+/)[0];
  return TERMINAL_COMMANDS.has(firstWord);
}

function isTaskRequest(input: string): boolean {
  const lower = input.toLowerCase().trim();
  if (!lower) return false;

  // Direct keyword at start
  if (TASK_KEYWORDS.some(kw => lower.startsWith(kw))) return true;

  // Word boundary in middle
  if (TASK_KEYWORDS.some(kw => lower.includes(` ${kw} `))) return true;

  // Spanish connector patterns: "si crea...", "por favor cambia...", etc.
  if (TASK_CONNECTOR_PATTERNS.some(p => p.test(lower))) return true;

  return false;
}

export async function chat(prompt?: string) {
  let session = getSession();
  if (!session.user) {
    try {
      const { login } = await import('./login.js');
      await login();
    } catch {
      // login() already shows its own error messages
      process.exit(1);
    }
    session = getSession();
    if (!session.user) {
      process.exit(1);
    }
  }

  const model = getModel();
  if (!model) {
    saveModel('deepseek/deepseek-v4-flash');
  }

  const projectName = path.basename(process.cwd());
  displayWelcome(session.user, getModel(), projectName);

  if (prompt) {
    if (isTerminalCommand(prompt)) {
      await executeTerminalCommand(prompt);
    } else if (isTaskRequest(prompt)) {
      await runTaskWithPipeline(prompt);
    } else {
      await runAgentWithDisplay(prompt);
    }
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  while (true) {
    let userInput: string;
    try {
      userInput = await new Promise<string>((resolve, reject) => {
        rl.question(chalk.gray('  > '), resolve);
        rl.on('close', () => reject(new Error('stdin-closed')));
      });
    } catch (e) {
      // stdin closed (pipe ended, EOF, Ctrl+D) — exit cleanly
      console.log('\n  👋  Goodbye! Zoe will remember your project.\n');
      break;
    }

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('\n  👋  Goodbye! Zoe will remember your project.\n');
      break;
    }

    if (userInput.startsWith('/model')) {
      const modelName = userInput.replace('/model', '').trim();
      if (modelName) {
        saveModel(modelName);
        console.log(chalk.green(`  ✅  Model changed to: ${modelName}\n`));
        console.log(`  🤖  Now using: ${chalk.yellow(getModel())}`);
        console.log('');
      } else {
        console.log(chalk.gray('  📋  Usage: /model <model-name>'));
        console.log('  📋  Example: /model deepseek/deepseek-v4-flash\n');
      }
      continue;
    }

    if (userInput === '/help') {
      console.log(`
  📋  ${chalk.white('Available commands:')}
    ${chalk.cyan('/model <name>')}  - Change the AI model
    ${chalk.cyan('/help')}          - Show this help
    ${chalk.cyan('/scan')}          - Scan the project again
    ${chalk.cyan('exit / quit')}    - Exit Zoe

  ${chalk.white('Tips:')}
    Terminal commands (npm, git, ls...) run directly
    Task requests (create, build, add...) use planning pipeline
    Everything else is casual chat
      `);
      continue;
    }

    if (userInput === '/scan') {
      const { scan } = await import('./scan.js');
      await scan();
      console.log(chalk.green('  ✅  Project rescanned\n'));
      continue;
    }

    if (userInput.trim()) {
      if (isTerminalCommand(userInput)) {
        await executeTerminalCommand(userInput);
      } else if (isTaskRequest(userInput)) {
        await runTaskWithPipeline(userInput);
      } else {
        await runAgentWithDisplay(userInput);
      }
    }
  }

  rl.close();
}

// ---- Terminal Command Execution ----

async function executeTerminalCommand(command: string) {
  console.log('');
  console.log(`  ${chalk.cyan('🔧')}  ${chalk.bold('Executing:')} ${chalk.yellow(command)}`);
  console.log(`  ${chalk.gray('─'.repeat(60))}`);
  console.log('');

  try {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      shell: shell,
      timeout: 60000,
    });

    if (stdout) {
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`  ${line}`);
        }
      }
    }
    if (stderr) {
      const lines = stderr.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`  ${chalk.yellow(line)}`);
        }
      }
    }

    console.log('');
    console.log(`  ${chalk.green('✅')}  ${chalk.green('Command completed')}`);
    console.log(`  ${chalk.gray('─'.repeat(60))}`);
    console.log('');

  } catch (error: any) {
    if (error.stdout) {
      const lines = error.stdout.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) console.log(`  ${line}`);
      }
    }
    if (error.stderr) {
      const errorMsg = error.stderr.toString().split('\n').pop() || '';
      console.log(`  ${chalk.red('❌')}  ${errorMsg.trim()}`);
    } else {
      console.log(`  ${chalk.red('❌')}  ${error.message}`);
    }
    console.log('');
  }
}

// ---- Task Pipeline ----

async function runTaskWithPipeline(request: string) {
  console.log(chalk.gray('  ────────────────────────────────────────────────────────────'));

  try {
    // Phase 1 & 2 — Plan
    const { plan, isDestructive } = await createPlan(request);
    clearThinking();

    displayPlan(plan);

    // Confirmation if destructive
    if (isDestructive) {
      console.log(`  ${chalk.yellow('⚠️  This task may modify critical files.')}`);
      console.log(`  ${chalk.gray('  Proceed?')} ${chalk.cyan('[Y/n]')}`);

      const answer = await new Promise<string>((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question('', (a) => {
          rl.close();
          resolve(a.toLowerCase().trim());
        });
      });

      if (answer === 'n' || answer === 'no') {
        console.log(`\n  ${chalk.gray('Task cancelled.')}`);
        console.log('');
        return;
      }
    }

    // Phase 3-5 — Execute, Review, Summary
    const result = await executePlan(request, plan);
    clearThinking();

    displaySummary(result);

  } catch (error: any) {
    clearThinking();
    const msg = error.message || 'Something went wrong';
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      displayFriendlyError('Authentication issue.', 'Run: zoe login');
    } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('ENOTFOUND')) {
      displayFriendlyError('Could not connect.', 'Check your internet connection');
    } else if (msg.includes('timeout')) {
      displayFriendlyError('The request timed out.', 'Try a simpler request');
    } else {
      displayFriendlyError(msg, 'Try rephrasing or run: zoe doctor');
    }
  }
}

// ---- Quick Chat ----

async function runAgentWithDisplay(prompt: string) {
  console.log(chalk.gray('  ────────────────────────────────────────────────────────────'));
  console.log('');

  try {
    const response = await runAgent(prompt, {
      onFirstToken: clearThinking,
    });

    console.log('');
    console.log(chalk.gray('  ────────────────────────────────────────────────────────────'));
    console.log('');
    console.log(chalk.gray('  💡  Need more help? Just ask.'));
    console.log('');

  } catch (error: any) {
    clearThinking();
    const msg = error.message || 'Something went wrong';
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      displayFriendlyError('Authentication issue.', 'Run: zoe login');
    } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('ENOTFOUND')) {
      displayFriendlyError('Could not connect.', 'Check your internet connection');
    } else {
      displayFriendlyError(msg, 'Try rephrasing');
    }
    console.log('');
  }
}
