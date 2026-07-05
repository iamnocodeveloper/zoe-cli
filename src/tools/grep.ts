import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';

export const grepTool = tool({
  name: 'grep',
  description: 'Search file contents by regex.',
  inputSchema: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z.string().optional().describe('Directory or file to search (default: cwd)'),
    glob: z.string().optional().describe('File filter, e.g. "*.ts"'),
    ignoreCase: z.boolean().optional(),
  }),
  execute: async ({ pattern, path, glob: fileFilter, ignoreCase }) => {
    try {
      const cwd = path || process.cwd();
      const flags = ignoreCase ? 'gi' : 'g';
      const regex = new RegExp(pattern, flags);
      const matches: Array<{ file: string; line: number; content: string }> = [];

      const maxResults = 100;

      async function searchDir(dir: string) {
        if (matches.length >= maxResults) return;

        try {
          const entries = await readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            if (matches.length >= maxResults) break;

            const fullPath = join(dir, entry.name);

            if (entry.isDirectory()) {
              if (!['node_modules', '.git', '.zoe', 'dist', 'build'].includes(entry.name)) {
                await searchDir(fullPath);
              }
            } else if (entry.isFile()) {
              // Apply file filter
              if (fileFilter && !matchesGlob(entry.name, fileFilter)) continue;

              try {
                const content = await readFile(fullPath, 'utf-8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                  if (matches.length >= maxResults) break;

                  if (regex.test(lines[i])) {
                    matches.push({
                      file: relative(cwd, fullPath),
                      line: i + 1,
                      content: lines[i].trim().slice(0, 200),
                    });
                  }

                  // Reset regex lastIndex
                  regex.lastIndex = 0;
                }
              } catch {
                // Skip files that can't be read
              }
            }
          }
        } catch {
          // Skip directories that can't be read
        }
      }

      // Check if path is a file
      try {
        const pathStat = await stat(cwd);
        if (pathStat.isFile()) {
          const content = await readFile(cwd, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break;

            if (regex.test(lines[i])) {
              matches.push({
                file: cwd,
                line: i + 1,
                content: lines[i].trim().slice(0, 200),
              });
            }

            regex.lastIndex = 0;
          }
        } else {
          await searchDir(cwd);
        }
      } catch {
        await searchDir(cwd);
      }

      return {
        matches,
        total: matches.length,
        truncated: matches.length >= maxResults,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  },
});

function matchesGlob(filename: string, pattern: string): boolean {
  // Simple glob matching
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(filename);
}
