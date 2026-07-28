import path from 'node:path';
import type { WorkspaceContext } from './workspace-intelligence.js';

export type CommandCategory = 'READ_ONLY' | 'SAFE_EXECUTION' | 'FILE_MODIFICATION' | 'PACKAGE_INSTALL' | 'PACKAGE_REMOVE' | 'SCRIPT_EXECUTION' | 'NETWORK_COMMAND' | 'PROCESS_CONTROL' | 'SYSTEM_CONFIGURATION' | 'WORKSPACE_ESCAPE' | 'DESTRUCTIVE' | 'UNKNOWN';
export type CommandRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'DESTRUCTIVE';
export type PackageAction = 'install' | 'update' | 'remove' | 'audit' | 'list' | 'run' | null;
export interface CommandPermissionDecision {
  readonly normalizedCommand: string; readonly shell: 'powershell' | 'cmd' | 'sh' | 'unknown'; readonly commandName: string;
  readonly arguments: readonly string[]; readonly chainedCommands: readonly string[]; readonly category: CommandCategory;
  readonly riskLevel: CommandRiskLevel; readonly requiresConfirmation: boolean; readonly requiresStrongConfirmation: boolean;
  readonly allowedByDefault: boolean; readonly workspaceImpact: 'inside' | 'external' | 'escape' | 'unknown'; readonly networkAccess: boolean;
  readonly packageManager: string | null; readonly packageAction: PackageAction; readonly packages: readonly string[]; readonly global: boolean;
  readonly reasons: readonly string[]; readonly denialReason?: string; readonly metadata: Readonly<Record<string, string>>;
}

const OPERATORS = /(?:&&|\|\||>>|2>>|2>|[;|><])/;
const READ_ONLY = new Set(['pwd', 'cd', 'dir', 'ls', 'get-childitem', 'type', 'cat', 'get-content', 'echo', 'where', 'which']);
const DESTRUCTIVE = /^(?:rm|rmdir|del|erase|shred|mkfs|dd|format|diskpart|shutdown|reboot|remove-item|clear-content|format-volume|stop-computer|restart-computer|reg)\b|\b(?:git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f[a-z]*|taskkill\b.*\/(?:f)|stop-process\b.*-force)\b/i;
const NETWORK = /^(?:curl|wget|invoke-webrequest|invoke-restmethod|ssh|scp|ftp)\b|\bgit\s+(?:clone|fetch|pull)\b/i;

function freeze<T>(value: T): T { return Object.freeze(value); }
function tokenize(value: string): string[] { return value.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^(?:"|')|(?:"|')$/g, '')) || []; }
function shellFor(command: string): CommandPermissionDecision['shell'] { return /\b(?:Get-|Remove-|Invoke-|Out-File|\$\{|\|\s*(?:iex|Invoke-Expression))/i.test(command) ? 'powershell' : process.platform === 'win32' ? 'cmd' : 'sh'; }
function impact(command: string, root: string): CommandPermissionDecision['workspaceImpact'] {
  const paths = (command.match(/(?:[A-Za-z]:\\[^\s"']+|\/{1}[^\s"']+|~[\\/][^\s"']+|\.\.[\\/][^\s"']*)/g) || []).filter((candidate) => !candidate.startsWith('//'));
  if (/\bcd\s+\.\./i.test(command) && /(?:&&|;|\|\|)/.test(command)) return 'escape';
  for (const candidate of paths) { if (candidate.startsWith('..') || candidate.startsWith('~') || /^[A-Za-z]:\\/i.test(candidate) || candidate.startsWith('/')) { try { if (!path.resolve(root, candidate).startsWith(path.resolve(root))) return 'external'; } catch { return 'unknown'; } } }
  return paths.length ? 'inside' : 'unknown';
}
function packageInfo(tokens: string[]): { manager: string | null; action: PackageAction; global: boolean; packages: string[] } {
  const manager = tokens[0]?.toLowerCase() || ''; const rest = tokens.slice(1).map((token) => token.toLowerCase());
  if (!['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'poetry', 'uv', 'cargo', 'go', 'composer', 'gem', 'bundle', 'flutter', 'dart', 'dotnet', 'mvn', 'mvnw', 'gradle', 'gradlew'].includes(manager)) return { manager: null, action: null, global: false, packages: [] };
  const actionToken = rest.find((token) => !token.startsWith('-')) || '';
  const action: PackageAction = /^(install|add|get)$/.test(actionToken) ? 'install' : /^(update|upgrade)$/.test(actionToken) ? 'update' : /^(remove|uninstall|delete)$/.test(actionToken) ? 'remove' : /^(audit|list|ls|view|metadata)$/.test(actionToken) ? actionToken === 'audit' ? 'audit' : 'list' : /^(run|exec|test|build)$/.test(actionToken) ? 'run' : null;
  const global = tokens.some((token) => /^(?:-g|--global|--user)$/.test(token)); const packages = tokens.slice(tokens.findIndex((token) => token.toLowerCase() === actionToken) + 1).filter((token) => !token.startsWith('-'));
  return { manager, action, global, packages };
}
function classifySingle(command: string, workspace: WorkspaceContext): CommandPermissionDecision {
  const normalizedCommand = command.trim().replace(/\s+/g, ' '); const tokens = tokenize(normalizedCommand); const commandName = (tokens[0] || '').toLowerCase(); const info = packageInfo(tokens); const reasons: string[] = [];
  const chainedCommands = normalizedCommand.split(/(?:&&|\|\||;|\|)/).map((part) => part.trim()).filter(Boolean); const hasOperator = OPERATORS.test(normalizedCommand) || /\$\(|`/.test(normalizedCommand);
  let category: CommandCategory = 'UNKNOWN'; let riskLevel: CommandRiskLevel = 'HIGH'; let requiresStrongConfirmation = false;
  const workspaceImpact = impact(normalizedCommand, workspace.workspaceRoot); const networkAccess = NETWORK.test(normalizedCommand) || Boolean(info.manager && ['install', 'update'].includes(info.action || ''));
  if (/\b(?:curl|wget|iwr|invoke-webrequest)\b[\s\S]*\|\s*(?:sh|bash|iex|invoke-expression)\b/i.test(normalizedCommand)) { category = 'DESTRUCTIVE'; riskLevel = 'DESTRUCTIVE'; requiresStrongConfirmation = true; reasons.push('Remote content is piped into a shell.'); }
  else if (DESTRUCTIVE.test(normalizedCommand)) { category = 'DESTRUCTIVE'; riskLevel = 'DESTRUCTIVE'; requiresStrongConfirmation = true; reasons.push('Destructive command pattern detected.'); }
  else if (workspaceImpact === 'external' || workspaceImpact === 'escape') { category = 'WORKSPACE_ESCAPE'; riskLevel = 'HIGH'; requiresStrongConfirmation = true; reasons.push('Command may operate outside the workspace.'); }
  else if ((hasOperator && /(?:>|>>|out-file)/i.test(normalizedCommand)) || commandName === 'out-file') { category = 'FILE_MODIFICATION'; riskLevel = 'MEDIUM'; reasons.push('Output redirection can write a file.'); }
  else if (info.action === 'install' || info.action === 'update') { category = 'PACKAGE_INSTALL'; riskLevel = info.global ? 'HIGH' : 'HIGH'; reasons.push('Package modification requires explicit approval.'); }
  else if (info.action === 'remove') { category = 'PACKAGE_REMOVE'; riskLevel = 'HIGH'; reasons.push('Package removal requires explicit approval.'); }
  else if (info.action === 'audit' || info.action === 'list') { category = 'READ_ONLY'; riskLevel = 'LOW'; }
  else if (['git'].includes(commandName) && /^(status|diff|log|branch)$/.test(tokens[1] || '') && !tokens.some((token) => /^-(?:D|d|f)/.test(token))) { category = 'READ_ONLY'; riskLevel = 'LOW'; }
  else if (READ_ONLY.has(commandName) && !(hasOperator || (commandName === 'echo' && />/.test(normalizedCommand)))) { category = 'READ_ONLY'; riskLevel = 'LOW'; }
  else if (info.action === 'run') { const script = tokens[2] || ''; const safe = ['test', 'lint', 'typecheck', 'build'].includes(script) && workspace.summary.dependencyManagers.length > 0; category = 'SCRIPT_EXECUTION'; riskLevel = safe ? 'MEDIUM' : 'HIGH'; reasons.push(safe ? 'Known project script may write generated output.' : 'Unknown script requires explicit approval.'); }
  else if (NETWORK.test(normalizedCommand)) { category = 'NETWORK_COMMAND'; riskLevel = 'HIGH'; reasons.push('Network command requires explicit approval.'); }
  else if (/^(?:kill|taskkill|stop-process)$/.test(commandName)) { category = 'PROCESS_CONTROL'; riskLevel = 'HIGH'; reasons.push('Process control command.'); }
  else if (/^(?:setx|reg|netsh|sc|systemctl)$/.test(commandName)) { category = 'SYSTEM_CONFIGURATION'; riskLevel = 'HIGH'; reasons.push('System configuration command.'); }
  else if (/\.(?:ps1|bat|cmd|sh|py|js|mjs)$/i.test(commandName) || ['node', 'python', 'python3'].includes(commandName)) { category = 'SCRIPT_EXECUTION'; riskLevel = 'HIGH'; reasons.push('Script execution requires explicit approval.'); }
  else reasons.push('Unknown commands are never auto-approved.');
  if (hasOperator && category === 'READ_ONLY') { category = 'UNKNOWN'; riskLevel = 'HIGH'; reasons.push('Shell operators require explicit review.'); }
  const requiresConfirmation = riskLevel !== 'LOW';
  return freeze({ normalizedCommand, shell: shellFor(normalizedCommand), commandName, arguments: freeze(tokens.slice(1)), chainedCommands: freeze(chainedCommands), category, riskLevel, requiresConfirmation, requiresStrongConfirmation, allowedByDefault: !requiresConfirmation, workspaceImpact, networkAccess, packageManager: info.manager, packageAction: info.action, packages: freeze(info.packages), global: info.global, reasons: freeze(reasons), denialReason: category === 'DESTRUCTIVE' && workspaceImpact !== 'inside' ? 'Destructive external command blocked by policy.' : undefined, metadata: freeze({ workspace: workspace.workspaceRoot, contextVersion: String(workspace.contextVersion) }) });
}
const weight: Record<CommandRiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, DESTRUCTIVE: 3 };
export function classifyDirectCommand(command: string, workspace: WorkspaceContext): CommandPermissionDecision {
  const parts = command.split(/(?:&&|\|\||;|\|)/).map((part) => part.trim()).filter(Boolean); if (!command.trim()) return classifySingle('', workspace);
  const decisions = parts.map((part) => classifySingle(part, workspace)); const highest = decisions.reduce((best, next) => weight[next.riskLevel] >= weight[best.riskLevel] ? next : best);
  if (decisions.length === 1 && !/[><]/.test(command)) return highest;
  const aggregate = classifySingle(command, workspace); const riskLevel = weight[highest.riskLevel] > weight[aggregate.riskLevel] ? highest.riskLevel : aggregate.riskLevel;
  const category = riskLevel === highest.riskLevel ? highest.category : aggregate.category;
  return freeze({ ...aggregate, category, riskLevel, requiresConfirmation: riskLevel !== 'LOW', requiresStrongConfirmation: aggregate.requiresStrongConfirmation || highest.requiresStrongConfirmation, reasons: freeze([...aggregate.reasons, ...highest.reasons]) });
}
