import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const execAsync = promisify(exec);

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (params: any) => Promise<string>;
}

function normalizeToolParams(toolName: string, params: any): any {
  if (!params || typeof params !== 'object') return params;
  const normalized: any = { ...params };

  // Universal aliases for common parameter names
  const universalAliases: Record<string, string[]> = {
    path: ['file_path', 'filepath', 'filePath', 'directory', 'dir', 'target'],
    content: ['body', 'text', 'data', 'code'],
    command: ['cmd', 'shell_command', 'shellCommand', 'exec'],
    pattern: ['query', 'search', 'regex'],
    old_text: ['oldText', 'oldtext', 'find', 'search_text', 'match', 'from'],
    new_text: ['newText', 'newtext', 'replace', 'substitute', 'to'],
  };

  for (const [canonical, variants] of Object.entries(universalAliases)) {
    if (normalized[canonical] === undefined) {
      for (const variant of variants) {
        if (normalized[variant] !== undefined) {
          normalized[canonical] = normalized[variant];
          break;
        }
      }
    }
  }

  return normalized;
}

function displayToolUsage(toolName: string, params: any) {
  console.log(`  🔧  ${chalk.cyan('Using:')} ${chalk.yellow(toolName)}`);
  if (params && Object.keys(params).length > 0) {
    const paramStr = Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    console.log(`      ${chalk.gray(paramStr)}`);
  }
  console.log('');
}

export const tools: Tool[] = [
  {
    name: 'list_directory',
    description: 'List the contents of a directory',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
        depth: { type: 'number', description: 'Depth of recursion (default: 1)' }
      },
      required: ['path']
    },
    execute: async (params: { path: string; depth?: number }) => {
      displayToolUsage('list_directory', params);
      const fullPath = path.resolve(process.cwd(), params.path || '.');
      const depth = params.depth || 1;

      if (!fs.existsSync(fullPath)) {
        return `Directory not found: ${params.path}`;
      }

      function listDir(dir: string, currentDepth: number): string[] {
        if (currentDepth > depth) return [];
        try {
          const items = fs.readdirSync(dir);
          const result: string[] = [];
          for (const item of items) {
            if (item.startsWith('.') && item !== '.') continue;
            if (item === 'node_modules') continue;
            const fullItemPath = path.join(dir, item);
            const isDir = fs.statSync(fullItemPath).isDirectory();
            const prefix = isDir ? '📁' : '📄';
            const indent = '  '.repeat(currentDepth);
            result.push(`${indent}${prefix} ${item}`);
            if (isDir && currentDepth < depth) {
              const subItems = listDir(fullItemPath, currentDepth + 1);
              result.push(...subItems);
            }
          }
          return result;
        } catch {
          return [`Error reading directory: ${dir}`];
        }
      }

      const items = listDir(fullPath, 0);
      return `Directory: ${params.path}\n\n${items.join('\n')}`;
    }
  },
  {
    name: 'read_file',
    description: 'Read the content of a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' }
      },
      required: ['path']
    },
    execute: async (params: { path: string }) => {
      displayToolUsage('read_file', params);
      const fullPath = path.resolve(process.cwd(), params.path);

      if (!fs.existsSync(fullPath)) {
        return `File not found: ${params.path}`;
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const displayContent = lines.length > 500
          ? lines.slice(0, 500).join('\n') + '\n... (truncated, 500 lines shown)'
          : content;
        return `File: ${params.path}\n\n${displayContent}`;
      } catch (error) {
        return `Error reading file: ${error}`;
      }
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' }
      },
      required: ['path', 'content']
    },
    execute: async (params: { path: string; content: string }) => {
      displayToolUsage('write_file', params);
      const fullPath = path.resolve(process.cwd(), params.path);
      const dir = path.dirname(fullPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, params.content, 'utf-8');
      return `File written: ${params.path}`;
    }
  },
  {
    name: 'edit_file',
    description: 'Make a targeted edit by replacing old_text with new_text. Use this for modifying existing files without rewriting them entirely.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        old_text: { type: 'string', description: 'Exact text to be replaced (copy from read_file output)' },
        new_text: { type: 'string', description: 'New text to insert' }
      },
      required: ['path', 'old_text', 'new_text']
    },
    execute: async (params: { path: string; old_text: string; new_text: string }) => {
      displayToolUsage('edit_file', { path: params.path });
      const fullPath = path.resolve(process.cwd(), params.path);

      if (!fs.existsSync(fullPath)) {
        return `File not found: ${params.path}`;
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Count occurrences to detect ambiguity
        const occurrences = content.split(params.old_text).length - 1;
        if (occurrences === 0) {
          return `Error: old_text was not found in ${params.path}. The file may have been modified, or the text does not match exactly (check whitespace, indentation, quotes). Do NOT claim the edit succeeded. Read the file again to see the current content and try with the exact text.`;
        }
        if (occurrences > 1) {
          return `Error: old_text appears ${occurrences} times in ${params.path}. Include more surrounding lines in old_text so it matches exactly once. Do NOT claim the edit succeeded.`;
        }

        const newContent = content.replace(params.old_text, params.new_text);
        fs.writeFileSync(fullPath, newContent, 'utf-8');
        return `File edited: ${params.path}`;
      } catch (error) {
        return `Error editing file: ${error}`;
      }
    }
  },
  {
    name: 'run_command',
    description: 'Run a terminal command',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
        timeout: { type: 'number', description: 'Timeout in seconds (optional, default 60)' }
      },
      required: ['command']
    },
    execute: async (params: { command: string; cwd?: string; timeout?: number }) => {
      displayToolUsage('run_command', params);
      try {
        const cwd = params.cwd || process.cwd();
        const timeout = (params.timeout || 60) * 1000;
        const { stdout, stderr } = await execAsync(params.command, { cwd, timeout });
        const output = stdout || stderr || 'Done';
        const lines = output.split('\n');
        const displayOutput = lines.length > 1000
          ? lines.slice(0, 1000).join('\n') + '\n... (truncated)'
          : output;
        return `Command executed:\n${displayOutput}`;
      } catch (error: any) {
        if (error.killed) {
          return `Command timed out after ${params.timeout || 60} seconds`;
        }
        return `Command failed: ${error.message}`;
      }
    }
  },
  {
    name: 'search_files',
    description: 'Search for files matching a pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (glob)' },
        path: { type: 'string', description: 'Directory to search in' }
      },
      required: ['pattern']
    },
    execute: async (params: { pattern: string; path?: string }) => {
      displayToolUsage('search_files', params);
      const searchPath = params.path || process.cwd();
      const { glob } = await import('glob');
      try {
        const files = await glob(params.pattern, {
          cwd: searchPath,
          ignore: ['node_modules/**', '.git/**']
        });
        if (files.length === 0) {
          return `No files found matching: ${params.pattern}`;
        }
        return `Found ${files.length} file(s):\n${files.slice(0, 50).join('\n')}${files.length > 50 ? '\n... and more' : ''}`;
      } catch (error) {
        return `Search failed: ${error}`;
      }
    }
  },
  {
    name: 'create_directory',
    description: 'Create a directory (and parent directories if needed)',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to create' }
      },
      required: ['path']
    },
    execute: async (params: { path: string }) => {
      displayToolUsage('create_directory', params);
      const fullPath = path.resolve(process.cwd(), params.path);
      fs.mkdirSync(fullPath, { recursive: true });
      return `Directory created: ${params.path}`;
    }
  },
  {
    name: 'get_project_context',
    description: 'Get project information (package.json, structure)',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: async () => {
      displayToolUsage('get_project_context', {});
      const context = await import('./context.js');
      return context.getProjectDescription();
    }
  }
];

export async function executeTool(toolName: string, params: any): Promise<string> {
  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    return `Tool not found: ${toolName}`;
  }
  try {
    const normalizedParams = normalizeToolParams(toolName, params);
    return await tool.execute(normalizedParams);
  } catch (error: any) {
    return `Tool execution error: ${error.message}`;
  }
}
