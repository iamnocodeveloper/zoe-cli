import { Command } from 'commander';
import { loadIntelligence, getProjectSummary, getDependencyMap } from '../../core/intelligence.js';
import { requireAuth } from '../../core/auth.js';
import { success, error, info, warning, highlight, muted } from '../../ui/styles.js';

export const summaryCommand = new Command('summary')
  .description('Show project summary')
  .option('-d, --dependencies', 'Show dependency details')
  .option('-l, --languages', 'Show language statistics')
  .option('-s, --structure', 'Show project structure')
  .action(async (options) => {
    try {
      // Require authentication (auto-login if not authenticated)
      const authResult = await requireAuth();
      if (!authResult.success) {
        console.error(error(`Authentication failed: ${authResult.error}`));
        process.exit(1);
      }

      const intelligence = loadIntelligence();

      if (!intelligence) {
        console.log();
        console.log(warning('No project scan found.'));
        console.log();
        console.log(`  ${info('Run')} zoe scan ${info('first to analyze your project.')}`);
        console.log();
        return;
      }

      console.log();
      console.log(getProjectSummary(intelligence));
      console.log();

      // Show dependencies if requested
      if (options.dependencies) {
        console.log();
        console.log(getDependencyMap(intelligence));
        console.log();
      }

      // Show language statistics if requested
      if (options.languages) {
        console.log();
        console.log(info('Language Statistics:'));
        console.log();

        const sortedLanguages = Object.entries(intelligence.languages)
          .sort((a, b) => b[1].lines - a[1].lines);

        for (const [lang, stats] of sortedLanguages) {
          const percentage = ((stats.lines / intelligence.totalLines) * 100).toFixed(1);
          console.log(`  ${highlight(lang)}`);
          console.log(`    ${muted('Files:')} ${stats.files}`);
          console.log(`    ${muted('Lines:')} ${stats.lines.toLocaleString()} (${percentage}%)`);
        }
        console.log();
      }

      // Show structure if requested
      if (options.structure) {
        console.log();
        console.log(info('Project Structure:'));
        console.log();

        const directories = intelligence.structure
          .filter((f) => f.type === 'directory')
          .sort((a, b) => a.path.localeCompare(b.path));

        const files = intelligence.structure
          .filter((f) => f.type === 'file')
          .sort((a, b) => a.path.localeCompare(b.path));

        // Show top-level directories
        const topLevelDirs = directories.filter((d) => !d.path.includes('/'));
        for (const dir of topLevelDirs) {
          console.log(`  📁 ${highlight(dir.path)}`);
        }

        console.log();

        // Show top-level files
        const topLevelFiles = files.filter((f) => !f.path.includes('/'));
        for (const file of topLevelFiles) {
          console.log(`  📄 ${muted(file.path)}`);
        }

        console.log();
        console.log(`  ${muted('... and more')}`);
        console.log();
      }

      console.log();
      console.log(`  ${info('Last scanned:')} ${new Date(intelligence.lastScanned).toLocaleString()}`);
      console.log();
    } catch (err: any) {
      console.error(error(`Error: ${err.message}`));
      process.exit(1);
    }
  });
