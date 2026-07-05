import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { glob } from 'glob';

export const globTool = tool({
  name: 'glob',
  description: 'Find files by glob pattern.',
  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern, e.g. "src/**/*.ts"'),
    path: z.string().optional().describe('Directory to search in (default: cwd)'),
  }),
  execute: async ({ pattern, path }) => {
    try {
      const cwd = path || process.cwd();
      const files = await glob(pattern, {
        cwd,
        ignore: ['**/node_modules/**', '**/.git/**', '**/.zoe/**'],
        absolute: false,
      });

      return {
        files: files.slice(0, 1000), // Cap at 1000 results
        total: files.length,
        truncated: files.length > 1000,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});
