import chalk from 'chalk';
import { createRequire } from 'module';
import { getInsForgeClient, getCurrentUser } from '../../core/insforge.js';
import { getModel } from '../../core/config.js';

export async function displayVersion(): Promise<void> {
  let pkg = { name: 'zoe-cli', version: 'unknown' };
  try {
    pkg = createRequire(import.meta.url)('../../../package.json');
  } catch {
    // ignore
  }

  const model = getModel() || 'deepseek/deepseek-v4-flash';

  let cloudStatus = 'Unreachable';
  let account = '—';
  try {
    getInsForgeClient();
    const u = await getCurrentUser();
    if (u) {
      cloudStatus = chalk.green('Connected');
      account = u.email || '—';
    } else {
      cloudStatus = chalk.yellow('Not signed in');
    }
  } catch {
    cloudStatus = chalk.red('Unreachable');
  }

  console.log('');
  console.log(`  ${chalk.bold('Zoe CLI')}`);
  console.log('');
  console.log(`  ${chalk.gray('Version'.padEnd(10))} v${pkg.version}`);
  console.log(`  ${chalk.gray('Model'.padEnd(10))} ${model}`);
  console.log(`  ${chalk.gray('Cloud'.padEnd(10))} ${cloudStatus}`);
  console.log(`  ${chalk.gray('Account'.padEnd(10))} ${account}`);
  console.log('');
}
