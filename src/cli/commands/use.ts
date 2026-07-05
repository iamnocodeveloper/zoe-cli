import { Command } from 'commander';
import { loadConfig, saveConfig } from '../../core/config.js';
import { success, error, info, checkmark, arrow, highlight } from '../../ui/styles.js';

export const useCommand = new Command('use')
  .description('Select a model to use')
  .argument('<model>', 'Model ID (e.g., deepseek/deepseek-v4-flash)')
  .action(async (modelId: string) => {
    try {
      const config = loadConfig();

      // Validate model ID format
      if (!modelId.includes('/')) {
        console.log();
        console.log(error('Invalid model ID format.'));
        console.log();
        console.log(`  ${info('Model ID should be in format: provider/model-name')}`);
        console.log(`  ${info('Example:')} deepseek/deepseek-v4-flash`);
        console.log();
        console.log(`  ${info('Run')} zoe models ${info('to see available models.')}`);
        console.log();
        process.exit(1);
      }

      // Save model to config
      saveConfig({ model: modelId });

      console.log();
      console.log(`${checkmark()} ${success('Model updated!')}`);
      console.log();
      console.log(`  ${arrow()} Model: ${highlight(modelId)}`);
      console.log();
      console.log(`  ${info('Run')} zoe chat ${info('to start coding with this model.')}`);
      console.log();
    } catch (err: any) {
      console.error(error(`Error: ${err.message}`));
      process.exit(1);
    }
  });
