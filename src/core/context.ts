import type { WorkspaceContext } from './workspace-intelligence.js';
import { getWorkspaceContext } from './workspace-intelligence.js';

function context(value?: WorkspaceContext): WorkspaceContext { return value || getWorkspaceContext(); }

export function getProjectDescription(value?: WorkspaceContext): string {
  const workspace = context(value); const lines = [
    `Project path: ${workspace.workspaceRoot}`,
    `Project name: ${workspace.projectName}`,
    `Frameworks: ${workspace.detectedFrameworks.join(', ') || 'Unknown'}`,
    `Languages: ${workspace.detectedLanguages.join(', ') || 'Unknown'}`,
    `Package manager: ${workspace.packageManager || 'None'}`,
    `Project structure (top level):`,
    ...workspace.mainDirectories.map((directory) => `  [directory] ${directory}`),
    ...workspace.importantFiles.slice(0, 20).map((file) => `  [important] ${file}`),
  ];
  return lines.join('\n');
}

export function getProjectTechStack(value?: WorkspaceContext): string {
  const workspace = context(value); const stack = [...workspace.detectedFrameworks, ...workspace.detectedLanguages];
  return stack.length ? stack.join(', ') : 'Unknown (no recognised project metadata)';
}

export function getProjectFilesSummary(value?: WorkspaceContext): string {
  const workspace = context(value); const extensions = new Map<string, number>();
  for (const file of workspace.files) extensions.set(file.extension || 'no-extension', (extensions.get(file.extension || 'no-extension') || 0) + 1);
  const fileTypes = [...extensions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([extension, count]) => `${extension} (${count})`).join(', ');
  return `Total files: ${workspace.projectStatistics.files}\nSource files: ${workspace.projectStatistics.sourceFiles}\nFile types: ${fileTypes}\nKey files: ${workspace.importantFiles.join(', ') || 'None'}`;
}

export function detectDestructivePaths(value?: WorkspaceContext): string[] {
  const workspace = context(value); const critical = new Set(['package.json', 'tsconfig.json', '.env', '.gitignore', 'docker-compose.yml', 'Dockerfile', 'next.config.js', 'next.config.mjs', 'vite.config.ts', 'vite.config.js']);
  return workspace.files.filter((file) => critical.has(file.relativePath)).map((file) => file.relativePath);
}
