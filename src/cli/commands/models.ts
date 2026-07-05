import { Command } from 'commander';
import { getAvailableModels } from '../../core/insforge.js';
import { getModel, saveModel } from '../../core/config.js';
import { requireAuth } from '../../core/auth.js';
import { success, error, info, checkmark, arrow, muted, highlight, warning } from '../../ui/styles.js';

export const modelsCommand = new Command('models')
  .description('List available AI models')
  .option('-s, --search <query>', 'Search models by name or ID')
  .action(async (options) => {
    try {
      // Require authentication (auto-login if not authenticated)
      const authResult = await requireAuth();
      if (!authResult.success) {
        console.error(error(`Authentication failed: ${authResult.error}`));
        process.exit(1);
      }

      const models = await getAvailableModels();

      if (models.length === 0) {
        console.log();
        console.log(error('No models available.'));
        console.log();
        process.exit(1);
      }

      const currentModel = getModel();

      // Apply search filter
      let filteredModels = models;
      if (options.search) {
        const query = options.search.toLowerCase();
        filteredModels = models.filter(
          (m) => m.toLowerCase().includes(query)
        );
      }

      console.log();
      console.log(`  ${info('Available Models')}`);
      console.log();

      // Show current model
      console.log(`  Current: ${highlight(currentModel)}`);
      console.log();

      // Group by provider
      const providers = new Map<string, string[]>();
      for (const model of filteredModels) {
        const provider = model.split('/')[0] || 'other';
        if (!providers.has(provider)) {
          providers.set(provider, []);
        }
        providers.get(provider)!.push(model);
      }

      // Display models by provider
      for (const [provider, providerModels] of providers) {
        console.log(`  ${success(provider.toUpperCase())}`);
        for (const model of providerModels.slice(0, 5)) {
          const isCurrent = model === currentModel;
          const marker = isCurrent ? `${checkmark()} ` : '   ';
          const name = isCurrent ? highlight(model) : muted(model);
          console.log(`${marker}${name}`);
        }
        if (providerModels.length > 5) {
          console.log(`   ${muted(`... and ${providerModels.length - 5} more`)}`);
        }
        console.log();
      }

      console.log(`  ${info('Use')} zoe use <model-id> ${info('to select a model.')}`);
      console.log();
    } catch (err: any) {
      console.error(error(`Error: ${err.message}`));
      process.exit(1);
    }
  });

export const useCommand = new Command('use')
  .description('Select a model to use')
  .argument('<model>', 'Model ID (e.g., deepseek/deepseek-v4-flash)')
  .action(async (modelId: string) => {
    try {
      // Require authentication (auto-login if not authenticated)
      const authResult = await requireAuth();
      if (!authResult.success) {
        console.error(error(`Authentication failed: ${authResult.error}`));
        process.exit(1);
      }

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

      // Get available models and check if the model exists
      const availableModels = await getAvailableModels();
      if (availableModels.length > 0 && !availableModels.includes(modelId)) {
        console.log();
        console.log(warning(`Model "${modelId}" not found in available models.`));
        console.log();
        console.log(`  ${info('Available models:')}`);
        for (const m of availableModels.slice(0, 10)) {
          console.log(`    ${m}`);
        }
        if (availableModels.length > 10) {
          console.log(`    ${muted(`... and ${availableModels.length - 10} more`)}`);
        }
        console.log();
        console.log(`  ${info('Use')} zoe models ${info('to see all models.')}`);
        console.log();
        return;
      }

      // Save model to config
      saveModel(modelId);

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
