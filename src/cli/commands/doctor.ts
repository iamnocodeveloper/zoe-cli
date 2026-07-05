import { Command } from 'commander';
import { loadIntelligence } from '../../core/intelligence.js';
import { requireAuth } from '../../core/auth.js';
import { success, error, info, warning, checkmark, cross, arrow, bullet } from '../../ui/styles.js';
import { getCurrentUser, getInsForgeClient } from '../../core/insforge.js';
import { accessSync, constants } from 'fs';
import { resolve } from 'path';
import os from 'os';
import https from 'https';
import chalk from 'chalk';

interface Issue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  suggestion?: string;
}

function displayCheckList(checks: CheckResult[]): void {
  for (const c of checks) {
    const icon = c.status === 'pass' ? chalk.green('✓') : c.status === 'fail' ? chalk.red('✗') : chalk.yellow('!');
    const label = chalk.bold(c.name.padEnd(16));
    console.log(`  ${icon} ${label} ${c.message}`);
    if (c.suggestion && c.status !== 'pass') {
      console.log(`    ${chalk.gray('→')} ${c.suggestion}`);
    }
  }
}

function checkNode(): CheckResult {
  const v = process.version.replace('v', '');
  const major = parseInt(v.split('.')[0], 10);
  if (major < 18) {
    return { name: 'Node.js', status: 'fail', message: `v${v} (need 18+)`, suggestion: 'Install Node.js 18+ from https://nodejs.org' };
  }
  return { name: 'Node.js', status: 'pass', message: `v${v}` };
}

function checkInternet(): Promise<CheckResult> {
  return new Promise((resolve) => {
    const req = https.get('https://api.insforge.dev/health', { timeout: 5000 }, (res) => {
      if (res.statusCode && res.statusCode < 500) {
        resolve({ name: 'Internet', status: 'pass', message: 'Reachable' });
      } else {
        resolve({ name: 'Internet', status: 'fail', message: `HTTP ${res.statusCode}` });
      }
    });
    req.on('timeout', () => { req.destroy(); resolve({ name: 'Internet', status: 'fail', message: 'Timeout' }); });
    req.on('error', () => resolve({ name: 'Internet', status: 'fail', message: 'No connection' }));
  });
}

async function checkCloud(): Promise<CheckResult> {
  try {
    getInsForgeClient();
    const u = await getCurrentUser();
    if (u) return { name: 'Cloud', status: 'pass', message: `Connected as ${u.email}` };
    return { name: 'Cloud', status: 'warn', message: 'Not signed in', suggestion: 'Run: zoe login' };
  } catch {
    return { name: 'Cloud', status: 'fail', message: 'Unreachable' };
  }
}

async function checkGitHubLogin(): Promise<CheckResult> {
  return checkCloud();
}

function checkConfig(): CheckResult {
  const configPath = resolve(os.homedir(), '.zoe', 'config.json');
  try {
    accessSync(configPath, constants.R_OK);
    return { name: 'Configuration', status: 'pass', message: 'config.json present' };
  } catch {
    return { name: 'Configuration', status: 'warn', message: 'Not initialized', suggestion: 'Run: zoe login to initialize' };
  }
}

function checkPermissions(): CheckResult {
  const homeDir = os.homedir();
  try {
    accessSync(homeDir, constants.R_OK | constants.W_OK);
    return { name: 'Permissions', status: 'pass', message: 'Home directory writable' };
  } catch {
    return { name: 'Permissions', status: 'fail', message: 'Cannot write to home' };
  }
}

export const doctorCommand = new Command('doctor')
  .description('Verify Zoe installation, auth, and environment')
  .action(async () => {
    try {
      console.log('');
      console.log(chalk.bold.cyan('  Zoe Doctor'));
      console.log(chalk.gray('  ' + '─'.repeat(40)));
      console.log('');

      const checks: CheckResult[] = [];
      checks.push(checkNode());
      checks.push(await checkInternet());
      checks.push(await checkCloud());
      checks.push(await checkGitHubLogin());
      checks.push(checkConfig());
      checks.push(checkPermissions());

      displayCheckList(checks);

      const failed = checks.filter(c => c.status === 'fail').length;
      const warned = checks.filter(c => c.status === 'warn').length;
      console.log('');
      if (failed === 0 && warned === 0) {
        console.log(`  ${chalk.green('✓ All checks passed')}`);
      } else {
        console.log(`  ${failed > 0 ? chalk.red('✗') : chalk.yellow('!')} ${failed} failed, ${warned} warning${warned === 1 ? '' : 's'}`);
      }
      console.log('');

      // Project-level checks (optional, only if intelligence exists)
      const intelligence = loadIntelligence();
      if (!intelligence) {
        return;
      }

      const issues: Issue[] = [];
      checkDependencies(intelligence, issues);
      checkProjectStructure(intelligence, issues);
      checkConfiguration(intelligence, issues);

      if (issues.length === 0) {
        console.log(`  ${chalk.green('✓')} ${success('Project looks healthy')}`);
      } else {
        console.log('');
        console.log(`  ${chalk.bold('Project issues:')}`);
        console.log('');
        for (const issue of issues) {
          const icon = issue.severity === 'error' ? cross() : issue.severity === 'warning' ? warning('⚠') : info('ℹ');
          console.log(`    ${icon} ${issue.message}`);
          if (issue.suggestion) {
            console.log(`      ${arrow()} ${issue.suggestion}`);
          }
        }
      }

      // Project summary
      console.log('');
      console.log(info('Project Summary:'));
      console.log();
      console.log(`  ${bullet()} ${intelligence.name} v${intelligence.version}`);
      console.log(`  ${bullet()} ${intelligence.totalFiles} files`);
      console.log(`  ${bullet()} ${Object.keys(intelligence.dependencies.production).length} production dependencies`);
      console.log(`  ${bullet()} ${Object.keys(intelligence.dependencies.dev).length} dev dependencies`);
      console.log();
    } catch (err: any) {
      console.error(error(`Error: ${err.message}`));
      process.exit(1);
    }
  });

function checkDependencies(intel: any, issues: Issue[]) {
  const prodDeps = Object.keys(intel.dependencies.production);
  const devDeps = Object.keys(intel.dependencies.dev);

  // Check for missing package.json
  if (prodDeps.length === 0 && devDeps.length === 0) {
    issues.push({
      severity: 'warning',
      message: 'No dependencies found in package.json',
      suggestion: 'Run npm install to install dependencies',
    });
  }

  // Check for common missing dev dependencies
  const hasTypeScript = prodDeps.includes('typescript') || devDeps.includes('typescript');
  const hasTesting = devDeps.some((d: string) => ['jest', 'vitest', 'mocha', 'jasmine'].includes(d));
  const hasLinting = devDeps.some((d: string) => ['eslint', 'prettier'].includes(d));

  if (!hasTypeScript && intel.languages['TypeScript']) {
    issues.push({
      severity: 'info',
      message: 'TypeScript files found but TypeScript is not in dependencies',
      suggestion: 'Run npm install typescript --save-dev',
    });
  }

  if (!hasTesting) {
    issues.push({
      severity: 'info',
      message: 'No testing framework found',
      suggestion: 'Consider adding Jest or Vitest for testing',
    });
  }

  if (!hasLinting) {
    issues.push({
      severity: 'info',
      message: 'No linting/formatting tools found',
      suggestion: 'Consider adding ESLint and Prettier',
    });
  }
}

function checkProjectStructure(intel: any, issues: Issue[]) {
  const hasSrc = intel.structure.some((f: any) => f.path === 'src' && f.type === 'directory');
  const hasTests = intel.structure.some((f: any) =>
    f.path.includes('test') || f.path.includes('spec') || f.path.includes('__tests__')
  );
  const hasReadme = intel.structure.some((f: any) => f.path.toLowerCase() === 'readme.md');
  const hasGitignore = intel.structure.some((f: any) => f.path === '.gitignore');

  if (!hasSrc) {
    issues.push({
      severity: 'info',
      message: 'No src directory found',
      suggestion: 'Consider organizing code in a src directory',
    });
  }

  if (!hasTests) {
    issues.push({
      severity: 'warning',
      message: 'No test files found',
      suggestion: 'Add tests to ensure code quality',
    });
  }

  if (!hasReadme) {
    issues.push({
      severity: 'info',
      message: 'No README.md found',
      suggestion: 'Add a README to document your project',
    });
  }

  if (!hasGitignore) {
    issues.push({
      severity: 'warning',
      message: 'No .gitignore found',
      suggestion: 'Add a .gitignore to exclude node_modules and other files',
    });
  }
}

function checkConfiguration(intel: any, issues: Issue[]) {
  // Check for common configuration files
  const hasTsConfig = intel.structure.some((f: any) => f.path === 'tsconfig.json');

  if (intel.languages['TypeScript'] && !hasTsConfig) {
    issues.push({
      severity: 'warning',
      message: 'TypeScript files found but no tsconfig.json',
      suggestion: 'Run npx tsc --init to create a TypeScript configuration',
    });
  }
}
