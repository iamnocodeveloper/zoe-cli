import { getSession, getModel, saveModel } from '../../core/config.js';
import { isAuthenticated } from '../../core/auth.js';
import { displayWelcome, clearThinking, displayFriendlyError, displayPlan, displaySummary, displayPhase } from '../../ui/display.js';
import { taskOrchestrator } from '../../core/task-orchestrator.js';
import { renderTaskOutcome } from '../task-result-renderer.js';
import { runAgent, createPlan, executeRuntimeV2 } from '../../core/agent.js';
import { classifyTask, type TaskMode } from '../../core/task-mode.js';
import { ZOE_STATUS_PAGE } from '../../core/cloud.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { assertCommandCwd } from '../../core/workspace.js';
import { clearMemorySession, compactMemorySession, getSessionInfo } from '../../core/memory.js';
import { restoreLatestBackup } from '../../core/backups.js';
import { getAuthErrorMessage, getAuthSessionStatus, ZoeAuthError } from '../../core/insforge.js';
import { classifyDirectCommand, type CommandPermissionDecision } from '../../core/command-permission-policy.js';
import { getWorkspaceContext } from '../../core/workspace-intelligence.js';
import { previewTaskContext } from '../task-preview-renderer.js';
import { handleCancellationInterrupt } from '../../core/task-cancellation.js';

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

export function buildPastedPrompt(lines: readonly string[]): string {
  return lines.join('\n');
}

export function createInputLineQueue() {
  const bufferedLines: string[] = [];
  let waitingLine: ((line: string) => void) | null = null;
  let inputClosed = false;
  return {
    push(line: string): void {
      if (waitingLine) {
        const resolve = waitingLine;
        waitingLine = null;
        resolve(line);
      } else bufferedLines.push(line);
    },
    close(): void { inputClosed = true; },
    read(): Promise<string> {
      const buffered = bufferedLines.shift();
      if (buffered !== undefined) return Promise.resolve(buffered);
      if (inputClosed) return Promise.reject(new Error('stdin-closed'));
      return new Promise((resolve) => { waitingLine = resolve; });
    },
  };
}

async function capturePasteBlock(readLine: () => Promise<string>): Promise<string> {
  const lines: string[] = [];
  console.log(chalk.gray('  Paste your request. Enter .done on its own line to submit.'));
  while (true) {
    const line = await readLine();
    if (line === '.done') return buildPastedPrompt(lines);
    lines.push(line);
  }
}

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
  const startupAuth = getAuthSessionStatus();
  if (!startupAuth.authenticated) {
    if (startupAuth.code === 'MALFORMED_LOCAL_SESSION') {
      renderTaskError(new ZoeAuthError(startupAuth.code), 'Run: zoe login');
      return;
    }
    try {
      const { login } = await import('./login.js');
      await login();
    } catch {
      // login() already shows its own error messages
      process.exit(1);
    }
    session = getSession();
    if (!(await isAuthenticated())) {
      process.exit(1);
    }
  }

  const model = getModel();
  if (!model) {
    saveModel('deepseek/deepseek-v4-flash');
  }

  const projectName = path.basename(process.cwd());
  displayWelcome(session.user || session.email || 'Zoe user', getModel(), projectName);

  const handleSigint = () => {
    const decision = handleCancellationInterrupt();
    if (decision === 'CANCEL_REQUESTED') console.log(chalk.yellow('\n  Cancelling active task at the next safe boundary...'));
    else if (decision === 'CANCELLATION_ALREADY_IN_PROGRESS') console.log(chalk.gray('\n  Cancellation is already in progress.'));
    else process.exit(130);
  };
  process.on('SIGINT', handleSigint);

  if (prompt) {
    if (isTerminalCommand(prompt)) {
      await executeTerminalCommand(prompt);
    } else if (classifyTask(prompt) === 'TASK_MODE') {
      await runTaskWithPipeline(prompt);
    } else {
      await runAgentWithDisplay(prompt);
    }
    process.off('SIGINT', handleSigint);
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const inputQueue = createInputLineQueue();
  rl.on('line', (line) => inputQueue.push(line));
  rl.on('close', () => inputQueue.close());
  const readLine = () => inputQueue.read();

  while (true) {
    let userInput: string;
    try {
      process.stdout.write(chalk.gray('  > '));
      userInput = await readLine();
    } catch (e) {
      // stdin closed (pipe ended, EOF, Ctrl+D) — exit cleanly
      console.log('');
      console.log('  👋  Goodbye!');
      console.log('');
      break;
    }

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('');
      console.log('  👋  Goodbye!');
      console.log('');
      break;
    }

    if (userInput === '/paste') {
      try {
        userInput = await capturePasteBlock(readLine);
      } catch {
        console.log('');
        break;
      }
      if (!userInput) continue;
    }

    if (userInput === '/models') {
      const { getModelCatalog } = await import('../../core/insforge.js');
      const models = await getModelCatalog();
      console.log(`\n  ${chalk.cyan('Available models')}`);
      console.log(`  ${chalk.gray('─'.repeat(64))}`);
      for (const model of models) {
        const marker = model.model_id === getModel() ? chalk.green('●') : chalk.gray('○');
        const tier = model.tier === 'free' ? chalk.green('FREE') : chalk.magenta(model.tier.toUpperCase());
        console.log(`  ${marker} ${chalk.white(model.display_name.padEnd(25))} ${tier}  ${chalk.gray(model.provider)}`);
        console.log(`    ${chalk.gray(model.description)}`);
      }
      console.log(`  ${chalk.gray('─'.repeat(64))}`);
      console.log(`  ${chalk.gray('Use /model <provider/model> to switch.')}\n`);
      continue;
    }

    if (userInput === '/model' || userInput.startsWith('/model ')) {
      const modelName = userInput.replace('/model', '').trim();
      if (modelName) {
        saveModel(modelName);
        console.log('');
        console.log(`  ${chalk.green('✓')} Model changed to: ${chalk.yellow(modelName)}`);
        console.log('');
      } else {
        await chooseModelInteractively(readLine);
      }
      continue;
    }

    if (userInput === '/clear') {
      clearMemorySession();
      console.log(chalk.green('\n  ✓ Conversation memory cleared for this project.\n'));
      continue;
    }

    if (userInput === '/compact') {
      compactMemorySession();
      console.log(chalk.green('\n  ✓ Conversation compacted. Recent context was preserved.\n'));
      continue;
    }

    if (userInput === '/status') {
      const info = getSessionInfo();
      console.log(`\n  ${chalk.cyan('Session:')} ${info.id}`);
      console.log(`  ${chalk.cyan('Messages:')} ${info.messages}`);
      console.log(`  ${chalk.cyan('Updated:')} ${info.updated}\n`);
      continue;
    }

    if (userInput.startsWith('/undo')) {
      const target = userInput.replace('/undo', '').trim();
      if (!target) {
        console.log(chalk.yellow('\n  Usage: /undo <relative-file-path>\n'));
        continue;
      }
      try {
        const restored = restoreLatestBackup(target);
        console.log(chalk.green(`\n  ✓ Restored ${target}`));
        console.log(chalk.gray(`    Backup: ${restored}\n`));
      } catch (error: any) {
        console.log(chalk.red(`\n  ✗ ${error.message}\n`));
      }
      continue;
    }

    if (userInput === '/diff' || userInput === '/git-diff') {
      await showGitOutput('diff -- . ":!.zoe"', 'Git diff');
      continue;
    }

    if (userInput === '/git-status') {
      await showGitOutput('status --short', 'Git status');
      continue;
    }

    if (userInput === '/help') {
      console.log(`
  📋  ${chalk.white('Available commands:')}
    ${chalk.cyan('/model <name>')}  - Change the AI model
    ${chalk.cyan('/models')}         - List available models
    ${chalk.cyan('/help')}          - Show this help
    ${chalk.cyan('/scan')}          - Scan the project again
    ${chalk.cyan('/clear')}         - Clear project conversation memory
    ${chalk.cyan('/compact')}       - Compact older conversation context
    ${chalk.cyan('/paste')}         - Paste multiline input; finish with .done
    ${chalk.cyan('/status')}        - Show current session information
    ${chalk.cyan('/undo <file>')}   - Restore the latest backup of a file
    ${chalk.cyan('/diff')}          - Show current Git diff
    ${chalk.cyan('/git-status')}    - Show Git workspace status
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
      } else if (classifyTask(userInput) === 'TASK_MODE') {
        await runTaskWithPipeline(userInput);
      } else {
        await runAgentWithDisplay(userInput);
      }
    }
  }

  rl.close();
  process.off('SIGINT', handleSigint);
}

async function showGitOutput(args: string, title: string): Promise<void> {
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd: assertCommandCwd(),
      timeout: 30_000,
      maxBuffer: 512 * 1024,
    });
    const output = `${stdout || ''}${stderr || ''}`.trim();
    console.log(`\n  ${chalk.cyan(title)}\n  ${chalk.gray('─'.repeat(60))}`);
    console.log(output ? output : '  Working tree clean.');
    console.log(`  ${chalk.gray('─'.repeat(60))}\n`);
  } catch (error: any) {
    console.log(chalk.red(`\n  Git inspection failed: ${error.message}\n`));
  }
}

async function chooseModelInteractively(readLine: () => Promise<string>): Promise<void> {
  const { getModelCatalog } = await import('../../core/insforge.js');
  const models = await getModelCatalog();
  if (models.length === 0) {
    console.log(chalk.yellow('\n  No models available.\n'));
    return;
  }

  console.log(`\n  ${chalk.cyan('Choose a model')}`);
  console.log(`  ${chalk.gray('─'.repeat(64))}`);
  models.forEach((model, index) => {
    const marker = model.model_id === getModel() ? chalk.green('●') : chalk.gray('○');
    const tier = model.tier === 'free' ? chalk.green('FREE') : chalk.magenta(model.tier.toUpperCase());
    console.log(`  ${chalk.yellow(String(index + 1).padStart(2, ' '))} ${marker} ${chalk.white(model.display_name.padEnd(25))} ${tier}  ${chalk.gray(model.provider)}`);
  });
  console.log(`  ${chalk.gray('─'.repeat(64))}`);

  process.stdout.write('  Select number (Enter to cancel): ');
  const selection = (await readLine()).trim();

  if (!selection) {
    console.log(chalk.gray('  Selection cancelled.\n'));
    return;
  }

  const index = Number(selection) - 1;
  const selected = Number.isInteger(index) && index >= 0 ? models[index] : undefined;
  if (!selected) {
    console.log(chalk.red('  Invalid model selection.\n'));
    return;
  }

  saveModel(selected.model_id);
  console.log(chalk.green(`  ✓ Model changed to ${selected.display_name} (${selected.model_id})\n`));
}

// ---- Terminal Command Execution ----

async function requestDirectCommandConfirmation(decision: CommandPermissionDecision): Promise<boolean> {
  if (!decision.requiresConfirmation) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const packageDetails = decision.packageManager ? `\n  Manager: ${decision.packageManager}\n  Action: ${decision.packageAction || 'unknown'}\n  Packages: ${decision.packages.join(', ') || '(none detected)'}\n  Scope: ${decision.global ? 'global' : 'project'}` : '';
  console.log(`\n  ${chalk.yellow('Permission required')}\n  Command: ${decision.normalizedCommand}\n  Category: ${decision.category}\n  Risk: ${decision.riskLevel}\n  Workspace impact: ${decision.workspaceImpact}${packageDetails}\n  Reason: ${decision.reasons.join(' ')}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(decision.requiresStrongConfirmation ? '  Type CONFIRM to continue: ' : '  Allow this one command? [y/N]: ', resolve));
    return decision.requiresStrongConfirmation ? answer.trim() === 'CONFIRM' : /^(y|yes)$/i.test(answer.trim());
  } finally { rl.close(); }
}

export async function executeTerminalCommand(command: string) {
  const executionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const decision = classifyDirectCommand(command, getWorkspaceContext());
  if (decision.denialReason) {
    console.log(chalk.red(`\n  Command blocked: ${decision.denialReason}\n`));
    return { outcome: decision.category === 'WORKSPACE_ESCAPE' ? 'WORKSPACE_ESCAPE_BLOCKED' : 'DESTRUCTIVE_COMMAND_BLOCKED', decision, executionId };
  }
  if (!(await requestDirectCommandConfirmation(decision))) {
    console.log(chalk.yellow(`\n  ${process.stdin.isTTY ? 'Command was not approved.' : 'Confirmation required; command was not executed.'}\n`));
    return { outcome: process.stdin.isTTY ? 'PERMISSION_DENIED' : 'CONFIRMATION_REQUIRED', decision, executionId };
  }
  console.log('');
  console.log(`  ${chalk.cyan('🔧')}  ${chalk.bold('Executing:')} ${chalk.yellow(command)}`);
  console.log(`  ${chalk.gray('─'.repeat(60))}`);
  console.log('');

  try {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const { stdout, stderr } = await execAsync(command, {
      cwd: assertCommandCwd(),
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
    if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe command] id=${executionId} category=${decision.category} risk=${decision.riskLevel} shell=${decision.shell} outcome=EXECUTED`);
    console.log('');
    return { outcome: 'EXECUTED', decision, executionId };

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
    if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe command] id=${executionId} category=${decision.category} risk=${decision.riskLevel} shell=${decision.shell} outcome=EXECUTION_FAILED`);
    console.log('');
    return { outcome: 'EXECUTION_FAILED', decision, executionId };
  }
}

// ---- Task Pipeline ----

async function runTaskWithPipeline(request: string) {
  console.log('');
  const outcome = await taskOrchestrator.run(request, 'chat', { onPreview: previewTaskContext, onPlan: displayPlan });
  clearThinking();
  renderTaskOutcome(outcome);
  return;

  try {
    // Phase 1 & 2 — Plan
    displayPhase('Reading workspace...');
    const { plan, isDestructive, status } = await createPlan(request);
    clearThinking();
    displayPhase('Planning...');

    displayPlan(plan);

    if (status === 'NEEDS_USER_INPUT') {
      displaySummary({ filesCreated: 0, filesModified: 0, warnings: [plan], status });
      return;
    }

    // Tool-level permissions handle the actual approval, including previews.
    // Keep the plan visible, but do not ask for a second confirmation here.
    if (isDestructive) console.log(`  ${chalk.yellow('⚠️  Critical files are included; Zoe will request permission per action.')}`);

    // Phase 3-5 — Execute, Review, Summary
    const result = await executeRuntimeV2(request, plan);
    clearThinking();

    displaySummary(result);

  } catch (error: any) { renderTaskError(error, 'Try rephrasing or run: zoe doctor'); }
}

// ---- Quick Chat ----

async function runAgentWithDisplay(prompt: string) {
  console.log(chalk.gray('  ────────────────────────────────────────────────────────────'));
  console.log('');
  const outcome = await taskOrchestrator.run(prompt, 'chat', { onPreview: previewTaskContext });
  clearThinking();
  renderTaskOutcome(outcome);
  return;

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
    renderTaskError(error, 'Try rephrasing');
    console.log('');
  }
}

export function renderTaskError(error: unknown, fallbackSuggestion: string): void {
  clearThinking();
  const auth = getAuthErrorMessage(error);
  if (auth) {
    displayFriendlyError(auth.reason, auth.suggestion);
    return;
  }
  const msg = error instanceof Error ? error.message : 'Something went wrong';
  displayFriendlyError(msg, fallbackSuggestion);
}
