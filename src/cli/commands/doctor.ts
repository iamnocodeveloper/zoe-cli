import { Command } from 'commander';
import { loadIntelligence } from '../../core/intelligence.js';
import { requireAuth } from '../../core/auth.js';
import { success, error, info, warning, checkmark, cross, arrow, bullet } from '../../ui/styles.js';

interface Issue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

export const doctorCommand = new Command('doctor')
  .description('Analyze project health and issues')
  .action(async () => {
    try {
      // Require authentication (auto-login if not authenticated)
      const authResult = await requireAuth();
      if (!authResult.success) {
        console.error(error(`Authentication failed: ${authResult.error}`));
        process.exit(1);
      }

      console.log(info('Analyzing project health...'));
      console.log();

      const intelligence = loadIntelligence();

      if (!intelligence) {
        console.log(warning('No project scan found.'));
        console.log();
        console.log(`  ${info('Run')} zoe scan ${info('first to analyze your project.')}`);
        console.log();
        return;
      }

      const issues: Issue[] = [];

      // Check for common issues
      checkDependencies(intelligence, issues);
      checkProjectStructure(intelligence, issues);
      checkConfiguration(intelligence, issues);

      // Display results
      if (issues.length === 0) {
        console.log(`${checkmark()} ${success('No issues found!')}`);
        console.log();
        console.log(`  Your project looks healthy.`);
      } else {
        console.log(`Found ${issues.length} issue(s):`);
        console.log();

        for (const issue of issues) {
          const icon = issue.severity === 'error' ? cross() : issue.severity === 'warning' ? warning('⚠') : info('ℹ');
          console.log(`  ${icon} ${issue.message}`);
          if (issue.suggestion) {
            console.log(`     ${arrow()} ${issue.suggestion}`);
          }
          console.log();
        }
      }

      // Show project summary
      console.log();
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
