import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export const fileWriteTool = tool({
  name: 'file_write',
  description: 'Write content to a file, creating it and parent directories if needed.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file'),
    content: z.string().describe('Content to write to the file'),
  }),
  execute: async ({ path, content }) => {
    try {
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });
      await writeFile(path, content, 'utf-8');
      return { written: true, path };
    } catch (err: any) {
      if (err.code === 'EACCES') return { error: `Permission denied: ${path}` };
      return { error: err.message };
    }
  },
});
