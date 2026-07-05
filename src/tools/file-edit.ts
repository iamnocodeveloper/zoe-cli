import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { readFile, writeFile } from 'fs/promises';

export const fileEditTool = tool({
  name: 'file_edit',
  description: 'Apply search-and-replace edits to a file with diff output.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file'),
    edits: z.array(z.object({
      old_text: z.string().describe('Text to search for (must appear exactly once)'),
      new_text: z.string().describe('Text to replace with'),
    })).describe('Array of search-and-replace edits'),
  }),
  execute: async ({ path, edits }) => {
    try {
      let content = await readFile(path, 'utf-8');
      const originalContent = content;
      const changes: Array<{ old: string; new: string; line: number }> = [];

      for (const edit of edits) {
        const index = content.indexOf(edit.old_text);
        if (index === -1) {
          return { error: `Text not found in ${path}: "${edit.old_text.slice(0, 50)}..."` };
        }

        // Check for multiple occurrences
        const secondIndex = content.indexOf(edit.old_text, index + 1);
        if (secondIndex !== -1) {
          return {
            error: `Text appears multiple times in ${path}. Please provide more context to make it unique.`,
          };
        }

        // Find line number
        const beforeText = content.slice(0, index);
        const line = beforeText.split('\n').length;

        content = content.replace(edit.old_text, edit.new_text);
        changes.push({ old: edit.old_text, new: edit.new_text, line });
      }

      await writeFile(path, content, 'utf-8');

      // Generate diff
      const diff = generateDiff(originalContent, content, path);

      return {
        edited: true,
        path,
        changes: changes.length,
        diff,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') return { error: `File not found: ${path}` };
      if (err.code === 'EACCES') return { error: `Permission denied: ${path}` };
      return { error: err.message };
    }
  },
});

function generateDiff(original: string, modified: string, path: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const diff: string[] = [];
  diff.push(`--- ${path}`);
  diff.push(`+++ ${path}`);

  let i = 0;
  let j = 0;

  while (i < originalLines.length || j < modifiedLines.length) {
    if (i < originalLines.length && j < modifiedLines.length) {
      if (originalLines[i] === modifiedLines[j]) {
        diff.push(` ${originalLines[i]}`);
        i++;
        j++;
      } else {
        diff.push(`-${originalLines[i]}`);
        diff.push(`+${modifiedLines[j]}`);
        i++;
        j++;
      }
    } else if (i < originalLines.length) {
      diff.push(`-${originalLines[i]}`);
      i++;
    } else {
      diff.push(`+${modifiedLines[j]}`);
      j++;
    }
  }

  return diff.join('\n');
}
