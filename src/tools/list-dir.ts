import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readdir } from 'fs/promises';
import { join } from 'path';

export const listDirTool = tool({
  name: 'list_dir',
  description: 'List directory contents.',
  inputSchema: z.object({
    path: z.string().optional().describe('Directory path (default: cwd)'),
  }),
  execute: async ({ path }) => {
    try {
      const dir = path || process.cwd();
      const entries = await readdir(dir, { withFileTypes: true });

      const result = entries
        .filter((e) => !['node_modules', '.git', '.zoe'].includes(e.name))
        .sort((a, b) => {
          // Directories first, then files
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 500) // Cap at 500 entries
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          path: join(dir, entry.name),
        }));

      return {
        entries: result,
        total: result.length,
        path: dir,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') return { error: `Directory not found: ${path}` };
      if (err.code === 'EACCES') return { error: `Permission denied: ${path}` };
      return { error: err.message };
    }
  },
});
