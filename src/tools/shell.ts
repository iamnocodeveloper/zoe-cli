import { tool } from '@openrouter/agent/tool';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const shellTool = tool({
  name: 'shell',
  description: 'Execute a shell command and return output.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    timeout: z.number().optional().describe('Timeout in seconds (default: 120)'),
  }),
  execute: async ({ command, timeout }) => {
    try {
      const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash');
      const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

      const timeoutMs = (timeout ?? 120) * 1000;

      const { stdout, stderr } = await execFileAsync(shell, shellArgs, {
        timeout: timeoutMs,
        maxBuffer: 256 * 1024, // 256KB
        encoding: 'utf-8',
      });

      const output = (stdout + stderr).trim();
      const truncated = output.length > 2000 || output.split('\n').length > 100;

      return {
        output: truncated ? output.slice(0, 2000) : output,
        exitCode: 0,
        truncated,
      };
    } catch (err: any) {
      if (err.killed) {
        return {
          output: err.stdout ? err.stdout.trim().slice(0, 2000) : '',
          exitCode: 1,
          timedOut: true,
          error: 'Command timed out',
        };
      }

      return {
        output: err.stdout ? err.stdout.trim().slice(0, 2000) : '',
        exitCode: err.code ?? 1,
        error: err.message,
      };
    }
  },
});
