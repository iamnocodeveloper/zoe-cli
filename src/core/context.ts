import type { WorkspaceContext } from './workspace-intelligence.js';
import { getWorkspaceContext } from './workspace-intelligence.js';

function context(value?: WorkspaceContext): WorkspaceContext { return value || getWorkspaceContext(); }

export function getProjectDescription(value?: WorkspaceContext): string {
  const workspace = context(value);
  const git = workspace.gitContext;
  const capabilities = workspace.packageName === '@nocodeveloper/zoe-cli'
    ? ['task orchestration', 'workspace inspection', 'explicit permissions', 'local checkpoints', 'safe resume', 'read-only Git awareness']
    : [];
  const lines = [
    '## VERIFIED FACTS — CANONICAL WORKSPACE CONTEXT',
    `Project path: ${workspace.workspaceRoot}`,
    `Project name: ${workspace.projectName}`,
    `Package name: ${workspace.packageName || 'Not detected'}`,
    `Package version: ${workspace.packageVersion || 'Not detected'}`,
    `Package bin: ${Object.entries(workspace.packageBin).map(([name, target]) => `${name} -> ${target}`).join(', ') || 'Not detected'}`,
    `Frameworks: ${workspace.detectedFrameworks.join(', ') || 'Unknown'}`,
    `Languages: ${workspace.detectedLanguages.join(', ') || 'Unknown'}`,
    `Runtime: ${workspace.runtime || 'Not detected'}`,
    `Package manager: ${workspace.packageManager || 'None'}`,
    `Available scripts: ${Object.keys(workspace.availableScripts).sort().join(', ') || 'None detected'}`,
    `Important manifests: ${workspace.dependencyFiles.join(', ') || 'None detected'}`,
    `Verified file count: ${workspace.projectStatistics.files}`,
    `Verified source file count: ${workspace.projectStatistics.sourceFiles}`,
    `Tests directory: ${workspace.mainDirectories.includes('test') || workspace.mainDirectories.includes('tests') ? 'Detected' : 'Not detected'}`,
    `Project structure (top level):`,
    ...workspace.mainDirectories.map((directory) => `  [directory] ${directory}`),
    ...workspace.importantFiles.slice(0, 20).map((file) => `  [important] ${file}`),
    `Git: ${git.repositoryDetected ? `${git.workingTreeState}${git.currentBranch ? ` on ${git.currentBranch}` : ''}` : 'Not a Git repository'}`,
    `Implemented Zoe capabilities: ${capabilities.join(', ') || 'Not applicable to this project'}`,
    'Unavailable or uninspected information: file contents and architecture not explicitly listed above.',
    'Grounding rules: Never contradict VERIFIED FACTS. Not inspected is not absent. A sanitized replica may be partial. Never infer repository-wide absence from one file read. Keep verified facts separate from interpretation.',
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
