import { getModel, loadConfig } from './config.js';
import { isZoeCloudSessionExpiredError, isZoeCloudUnauthorized, withAuthenticatedZoeCloudRequest } from './insforge.js';
import { getProjectDescription, getProjectTechStack, getProjectFilesSummary, detectDestructivePaths } from './context.js';
import { getWorkspaceContext, type WorkspaceContext } from './workspace-intelligence.js';
import { addMessage, getConversationHistory, getConversationContext, loadSession } from './memory.js';
import { executeTool, tools } from './tools.js';
import { ZOE_CHAT_SYSTEM_PROMPT, ZOE_SYSTEM_PROMPT, ZOE_STRUCTURED_PLAN_PROMPT, ZOE_EXECUTE_PROMPT, ZOE_REVIEW_PROMPT } from './prompt.js';
import { displayThinking, clearThinking, displayPhase } from '../ui/display.js';
import { createProjectSnapshotFromWorkspace, parseExecutionPlan, validateExecutionPlan, validateRuntimeConstraints } from './execution-plan.js';
import { extractUserIntent } from './user-intent.js';
import { RuntimeController } from './runtime-controller.js';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { availableValidationCommands, createExecutionRuntime, detectPackageManager, resolvePlannedFile, type ExecutionPlan } from './execution-runtime.js';
import type { TaskCancellationToken } from './task-cancellation.js';
import type { CheckpointPipelineStage } from './task-checkpoint.js';
import type { CheckpointStageMetadata } from './checkpoint-lifecycle.js';

const execAsync = promisify(exec);

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; callId: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; callId: string; output: string }
  | { type: 'reasoning'; delta: string };

export interface BuilderToolPolicy {
  inspectedPaths: Set<string>;
  inspectionOperations: number;
  writes: number;
  forceWrite: boolean;
}

export function createBuilderToolPolicy(): BuilderToolPolicy {
  return { inspectedPaths: new Set<string>(), inspectionOperations: 0, writes: 0, forceWrite: false };
}

export function enforceBuilderToolPolicy(policy: BuilderToolPolicy, toolName: string, params: Record<string, unknown>): string | null {
  if (toolName === 'edit_file' || toolName === 'write_file') {
    policy.writes++;
    return null;
  }
  if (policy.forceWrite) return 'Builder interrupted: emit edit_file or write_file now. Further exploration is forbidden.';
  const command = typeof params.command === 'string' ? params.command.trim() : '';
  const isSearch = toolName === 'grep' || (toolName === 'run_command' && /^(rg|grep)\b/.test(command));
  if (isSearch && policy.inspectedPaths.size > 0) {
    policy.forceWrite = true;
    return 'Builder interrupted: grep/search after reading the required file is forbidden. Emit edit_file or write_file now.';
  }
  if (toolName === 'read_file') {
    const filePath = typeof params.path === 'string' ? params.path : '';
    if (filePath && policy.inspectedPaths.has(filePath)) {
      policy.forceWrite = true;
      return `Builder interrupted: ${filePath} was already read. Emit edit_file or write_file now.`;
    }
    if (filePath) policy.inspectedPaths.add(filePath);
    policy.inspectionOperations++;
    policy.forceWrite = true;
    if (policy.inspectionOperations > 2) {
      policy.forceWrite = true;
      return 'Builder interrupted after two read operations without a write. Emit edit_file or write_file now.';
    }
  }
  return null;
}

async function callOpenRouter(
  messages: ChatMessage[],
  options?: { onFirstToken?: () => void }
): Promise<string> {
  const model = getModel();
  let stream: AsyncIterable<any>;
  try {
    stream = await withAuthenticatedZoeCloudRequest((client) => createCloudStream(client, model, messages));
  } catch (gatewayErr) {
    if (isZoeCloudSessionExpiredError(gatewayErr)) throw gatewayErr;
    throw new Error(`Zoe Cloud AI gateway unavailable: ${gatewayErr instanceof Error ? gatewayErr.message : 'request failed'}`);
    /* Direct provider access is intentionally disabled. Model credentials stay in Zoe Cloud. */
    // Gateway path failed — fall back to direct OpenRouter if we have an api_key
    const { getOpenRouterKeyFromSecrets } = await import('./insforge.js');
    const apiKey = await getOpenRouterKeyFromSecrets();

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://zoe-cli.dev',
        'X-Title': 'Zoe CLI',
      },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `API Error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Zoe Cloud returned an empty streaming response.');
    const decoder = new TextDecoder();
    let full = '';
    let firstToken = false;

    while (reader) {
      const { done, value } = await reader!.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        try {
          const data = line.replace('data: ', '');
          if (data === '[DONE]') continue;
          const json = JSON.parse(data);
          const content = json.choices[0]?.delta?.content || '';
          if (!content) continue;
          if (!firstToken && options?.onFirstToken) {
            options?.onFirstToken?.();
            firstToken = true;
          }
          process.stdout.write(content);
          full += content;
        } catch {}
      }
    }
    console.log('\n');
    return full;
  }

  let fullResponse = '';
  let hasEmittedFirstToken = false;

  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content || '';
    if (!content) continue;

    if (!hasEmittedFirstToken && options?.onFirstToken) {
      options.onFirstToken();
      hasEmittedFirstToken = true;
    }

    process.stdout.write(content);
    fullResponse += content;
  }

  console.log('\n');
  return fullResponse;
}

async function createCloudStream(
  client: any,
  model: string,
  messages: ChatMessage[],
): Promise<AsyncIterable<any>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.ai.chat.completions.create({
        model,
        messages,
        stream: true,
        temperature: 0.7,
      });
    } catch (error) {
      lastError = error;
      if (isZoeCloudUnauthorized(error)) throw error;
      if (attempt < 2) {
        const delayMs = 400 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Cloud request failed');
}

// Cache of file contents read during the current task — avoids duplicate read_file calls
const readFileCache = new Map<string, string>();

function detectImports(content: string): string[] {
  const importRegex = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
  const packages: string[] = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const pkg = match[1];
    if (!pkg.startsWith('.') && !pkg.startsWith('@types/') && !pkg.startsWith('node:')) {
      packages.push(pkg);
    }
  }
  return [...new Set(packages)];
}

function getProjectDependencies(): string[] {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];
  } catch {
    return [];
  }
}

async function processToolCalls(
  response: string,
  fileTracker?: { created: number; modified: number },
  editRepairAttempts = new Map<string, number>(),
  builderPolicy?: BuilderToolPolicy,
  workspaceContext?: WorkspaceContext,
  cancellationToken?: TaskCancellationToken,
): Promise<{ text: string; toolResults: { name: string; output: string }[]; writesSucceeded: number }> {
  // Tool execution receives the task's canonical context even though current
  // path-bound tools do not yet consume additional inventory metadata.
  void workspaceContext;
  // Models may emit either the legacy function_calls wrapper or the newer
  // tool_calls wrapper. Both can contain XML <invoke> blocks.
  const functionCallRegex = /<(?:function_calls|tool_calls)>([\s\S]*?)<\/(?:function_calls|tool_calls)>/g;
  let result = response;
  const toolResults: { name: string; output: string }[] = [];
  let writesSucceeded = 0;
  let toolCallCount = 0;
  const maxSteps = Math.max(1, loadConfig().maxSteps || 100);

  const executeFreshEdit = async (params: Record<string, unknown>): Promise<string> => {
    const filePath = typeof params.path === 'string' ? params.path : '';
    const fullPath = path.resolve(process.cwd(), filePath);
    const attempts = editRepairAttempts.get(fullPath) ?? 0;
    if (attempts >= 2) {
      return `Error: edit repair already failed for ${filePath}. No further edit attempts will use stale content.`;
    }

    readFileCache.delete(fullPath);
    const freshRead = await executeTool('read_file', { path: filePath });
    if (freshRead.startsWith('File not found:') || freshRead.startsWith('Error reading file:')) return freshRead;
    const completeContent = fs.readFileSync(fullPath, 'utf8');
    readFileCache.set(fullPath, completeContent);

    const editResult = await executeTool('edit_file', params);
    if (!editResult.includes('old_text was not found')) return editResult;

    readFileCache.delete(fullPath);
    const refreshedRead = fs.readFileSync(fullPath, 'utf8');
    readFileCache.set(fullPath, refreshedRead);
    editRepairAttempts.set(fullPath, attempts + 1);
    if (attempts === 0) {
      return `${editResult}\n\nFresh file content for one focused repair attempt:\n${refreshedRead}`;
    }
    return `${editResult}\n\nFocused repair failed after rereading ${filePath}. No further edit attempts will use stale content.`;
  };

  // Prefer structured tool calls when a model returns them. XML remains as a
  // backwards-compatible fallback for older models and existing prompts.
  const structuredRegex = /<tool_calls>([\s\S]*?)<\/tool_calls>/g;
  for (const match of response.matchAll(structuredRegex)) {
    try {
      const calls = JSON.parse(match[1]) as Array<{ name: string; arguments?: Record<string, unknown> }>;
      for (const call of calls) {
        cancellationToken?.throwIfCancelled();
        if (!call?.name) continue;
        toolCallCount++;
        if (toolCallCount > maxSteps) {
          toolResults.push({ name: 'agent_guard', output: `Maximum tool steps reached (${maxSteps}). Execution stopped safely.` });
          result = result.replace(match[0], '');
          break;
        }
        const params = call.arguments || {};
        const blocked = builderPolicy && enforceBuilderToolPolicy(builderPolicy, call.name, params);
        if (blocked) {
          toolResults.push({ name: 'builder_guard', output: blocked });
          continue;
        }
        console.log(`  🔧  ${chalk.cyan('Executing:')} ${chalk.yellow(call.name)}`);
        const toolResult = call.name === 'edit_file'
          ? await executeFreshEdit(params)
          : await executeTool(call.name, params);
        toolResults.push({ name: call.name, output: toolResult });
        if ((call.name === 'write_file' && toolResult.startsWith('File written:')) ||
            (call.name === 'edit_file' && toolResult.startsWith('File edited:'))) {
          writesSucceeded++;
        }
      }
      result = result.replace(match[0], '');
    } catch {
      // Leave malformed structured calls untouched so the XML fallback can run.
    }
  }

  for (const match of response.matchAll(functionCallRegex)) {
    const block = match[1];

    const invokeRegex = /<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/g;
    for (const invoke of block.matchAll(invokeRegex)) {
      cancellationToken?.throwIfCancelled();
      toolCallCount++;
      if (toolCallCount > maxSteps) {
        toolResults.push({ name: 'agent_guard', output: `Maximum tool steps reached (${maxSteps}). Execution stopped safely.` });
        break;
      }
      const toolName = invoke[1];
      const paramsBlock = invoke[2];

      const paramRegex = /<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g;
      const params: Record<string, string> = {};
      for (const param of paramsBlock.matchAll(paramRegex)) {
        params[param[1]] = param[2].trim();
      }

      const blocked = builderPolicy && enforceBuilderToolPolicy(builderPolicy, toolName, params);
      if (blocked) {
        toolResults.push({ name: 'builder_guard', output: blocked });
        continue;
      }

      // Anti-duplicate read: if the file was already read, return cached content
      if (toolName === 'read_file' && params.path) {
        const fullPath = path.resolve(process.cwd(), params.path);
        const cacheKey = fullPath;
        if (readFileCache.has(cacheKey)) {
          toolResults.push({ name: toolName, output: readFileCache.get(cacheKey)! });
          continue;
        }
      }

      console.log(`  🔧  ${chalk.cyan('Executing:')} ${chalk.yellow(toolName)}`);
      const targetExistedBeforeWrite = (toolName === 'write_file' || toolName === 'edit_file') && params.path
        ? fs.existsSync(path.resolve(process.cwd(), params.path))
        : false;
      const toolResult = toolName === 'edit_file'
        ? await executeFreshEdit(params)
        : await executeTool(toolName, params);

      // Cache successful read_file results
      if (toolName === 'read_file' && params.path && !toolResult.startsWith('File not found') && !toolResult.startsWith('Error')) {
        const fullPath = path.resolve(process.cwd(), params.path);
        readFileCache.set(fullPath, toolResult);
      }

      // Invalidate cache on write/edit for this path
      if ((toolName === 'write_file' || toolName === 'edit_file') && params.path) {
        const fullPath = path.resolve(process.cwd(), params.path);
        readFileCache.delete(fullPath);
      }

      // Only count as a successful write if the tool returned success
      const writeSucceeded =
        (toolName === 'write_file' && toolResult.startsWith('File written:')) ||
        (toolName === 'edit_file' && toolResult.startsWith('File edited:'));

      if (writeSucceeded && fileTracker) {
        writesSucceeded++;
        const fullPath = path.resolve(process.cwd(), params.path);
        // Determine whether the file existed before the write. The success
        // response is produced after writing, so checking existence here
        // would classify every new file as modified.
        const wasExisting = targetExistedBeforeWrite;
        if (wasExisting) fileTracker.modified++;
        else fileTracker.created++;
      }

      // Auto-detect missing dependencies from generated imports
      if (toolName === 'write_file' && writeSucceeded && params.content) {
        const imports = detectImports(params.content);
        if (imports.length > 0) {
          const known = getProjectDependencies();
          const missing = imports.filter(pkg => !known.includes(pkg));
          if (missing.length > 0 && missing.length <= 5) {
            toolResults.push({
              name: 'write_file',
              output: `${toolResult}\n\nDetected ${missing.length} new import(s) that may need installation: ${missing.join(', ')}. Consider running: npm install ${missing.join(' ')}`
            });
            continue;
          }
        }
      }

      toolResults.push({ name: toolName, output: toolResult });
      console.log(`  ${chalk.green('✓')}  ${chalk.gray(toolResult.replace(/\n/g, ' · ').slice(0, 80))}`);
    }

    result = result.replace(match[0], '');
  }

  return { text: result.trim(), toolResults, writesSucceeded };
}

// ---- AGENT: Quick Chat ----

export async function runAgent(
  prompt: string,
  options?: { onFirstToken?: () => void; workspaceContext?: WorkspaceContext; cancellationToken?: TaskCancellationToken }
) {
  readFileCache.clear();
  const model = getModel();

  loadSession();
  addMessage('user', prompt);

  const workspaceContext = options?.workspaceContext || getWorkspaceContext();
  options?.cancellationToken?.throwIfCancelled();
  const projectContext = getProjectDescription(workspaceContext);
  const conversationHistory = getConversationContext();
  const sysCtx = `\n## SYSTEM CONTEXT\n- Node.js: ${process.version}\n- Package manager: npm\n- OS: ${os.platform()} ${os.release()}\n- Working directory: ${process.cwd()}\n`;

  const messages = [
    {
      role: 'system' as const,
      content: `${ZOE_CHAT_SYSTEM_PROMPT}

## CURRENT PROJECT CONTEXT
${projectContext}

${sysCtx}
## CONVERSATION HISTORY
${conversationHistory}

## AVAILABLE TOOLS
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}`
    },
    ...getConversationHistory().filter(m => m.role !== 'system').map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    }))
  ];

  console.log(`  📁  ${chalk.gray('Project:')} ${chalk.cyan(path.basename(process.cwd()))}`);
  console.log(`  🤖  ${chalk.gray('Model:')} ${chalk.yellow(model)}`);

  displayThinking();

  const fullResponse = await callOpenRouter(messages, options);
  options?.cancellationToken?.throwIfCancelled();

  const localFileTracker = { created: 0, modified: 0 };
  const { text, toolResults, writesSucceeded } = await processToolCalls(fullResponse, localFileTracker, undefined, undefined, workspaceContext, options?.cancellationToken);
  let finalResponse = text || fullResponse;
  let totalWrites = writesSucceeded;

  // ALWAYS run feedback loop after tool calls so the AI produces a summary
  // and the user sees a clear "Done" message before the next prompt.
  if (toolResults.length > 0) {
    // Stagnation guard: if the first batch of tool results had no writes, skip
    // the feedback loop entirely — there's nothing to follow up on.
    const firstBatchHadResults = toolResults.length > 0;

    if (firstBatchHadResults) {
      messages.push(
        { role: 'assistant' as const, content: finalResponse },
        { role: 'user' as const, content: `Tool results:\n${toolResults.map(r => {
        const maxOut = r.name === 'run_command' ? 2000 : 500;
        const out = r.output.length > maxOut ? '...(truncated)\n' + r.output.slice(-maxOut) : r.output;
        return `${r.name}: ${out}`;
      }).join('\n\n')}\n\nAnswer the original user using these real results. For analysis or explanation requests, explain the project's purpose, architecture, technologies, integrations, important files, scripts, and risks. Do not merely repeat raw tool output. Use another tool only if genuinely necessary. IMPORTANT: If no write_file or edit_file succeeded, state clearly that no files were modified.` }
      );
      displayThinking();
      try {
        const followup = await callOpenRouter(messages, { onFirstToken: clearThinking });
        options?.cancellationToken?.throwIfCancelled();
        const followupProcessed = await processToolCalls(followup, localFileTracker, undefined, undefined, workspaceContext, options?.cancellationToken);
        totalWrites += followupProcessed.writesSucceeded;

        // Stagnation guard in recursive feedback: if the followup had no
        // additional writes, accept the text and stop.
        const followupHadProgress = followupProcessed.toolResults.some(r =>
          r.name === 'write_file' || r.name === 'edit_file' || r.name === 'run_command'
        );

        if (followupProcessed.toolResults.length > 0) {
          messages.push(
            { role: 'assistant' as const, content: followupProcessed.text || followup },
            { role: 'user' as const, content: `Tool results:\n${followupProcessed.toolResults.map(r => `${r.name}: ${r.output.slice(0, 1000)}`).join('\n\n')}\n\nProvide the final answer to the original user. Explain the project concretely when this was an analysis request. Do not output tool-call markup.` }
          );
          displayThinking();
          try {
            finalResponse = await callOpenRouter(messages, { onFirstToken: clearThinking });
          } catch (e) {
            finalResponse = followupProcessed.text || followup;
          }
        } else {
          finalResponse = followupProcessed.text || followup;
        }
      } catch (e) {
        // Feedback loop failed — surface the tool results so user sees what happened
        finalResponse = `Done. Tool results:\n${toolResults.map(r => `- ${r.name}: ${r.output.slice(0, 300)}`).join('\n')}`;
      }
    }
    // If first batch had no writes, finalResponse is already the raw text from
    // the AI explaining what it tried. The honesty guard below will catch it
    // if it claimed actions.
  }

  // HONESTY GUARD: If the AI claimed to have done work but no writes succeeded, append a correction
  if (totalWrites === 0 && toolResults.length > 0) {
    const claimedActions = /\b(created|wrote|updated|modified|changed|fixed|edited|added|removed|deleted|moved|renamed)\b/i.test(finalResponse);
    if (claimedActions) {
      finalResponse += '\n\n' + chalk.yellow('Note: No files were actually modified. The operations above did not produce any file changes.');
    }
  }

  addMessage('assistant', finalResponse);

  return finalResponse;
}

export function enforceRequestedChanges(plan: any, requestedChanges: Array<{ file: string; operation: 'replace_headline'; exactValue: string }>): any {
  if (requestedChanges.length === 0) return plan;
  const requirements = [...plan.requirements];
  for (const change of requestedChanges) {
    const description = `Replace the main headline in ${change.file} with exactly: ${change.exactValue}`;
    if (!requirements.some((requirement: any) => requirement.verification?.type === 'file_contains' && requirement.verification.path === change.file && requirement.verification.patterns?.includes(change.exactValue))) {
      requirements.push({ id: `requested-change-${change.file}`, description, verification: { type: 'file_contains', path: change.file, patterns: [change.exactValue] } });
    }
  }
  const summary = /value\s+not\s+provided|desired\s+text\s+unknown|placeholder/i.test(plan.summary)
    ? `Apply the requested exact change: ${requestedChanges.map((change) => `${change.file} = ${change.exactValue}`).join(', ')}`
    : plan.summary;
  return { ...plan, summary, requestedChanges: requestedChanges.map((change) => ({ ...change })), requirements };
}

export function verifySemanticRequestedChanges(content: string, changes: Array<{ operation: 'replace_headline'; exactValue: string }>): string[] {
  const issues: string[] = [];
  const visibleContent = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const change of changes) {
    if (change.operation !== 'replace_headline') continue;
    const escaped = change.exactValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const heading = new RegExp(`<h1\\b([^>]*)>\\s*${escaped}\\s*</h1>`, 'i').exec(visibleContent);
    if (!heading || /\bhidden\b|aria-hidden\s*=\s*["']?true|display\s*:\s*none/i.test(heading[1])) {
      issues.push(`Visible main headline was not changed to exactly: ${change.exactValue}`);
    }
  }
  return issues;
}

export function hasBlockingReview(review: string): boolean {
  const match = /BLOCKING_ISSUES\s*:\s*([\s\S]*)/i.exec(review);
  if (!match) return true;
  return !/^\s*(none|no|0)\s*[.!]*\s*$/i.test(match[1]);
}

// ---- TASK EXECUTOR: Full Pipeline ----

export async function createPlan(request: string, workspaceContext = getWorkspaceContext(), cancellationToken?: TaskCancellationToken): Promise<{
  plan: string;
  isDestructive: boolean;
  status?: 'NEEDS_USER_INPUT';
}> {
  loadSession();
  cancellationToken?.throwIfCancelled();
  addMessage('user', request);

  const projectContext = getProjectDescription(workspaceContext);
  const snapshot = createProjectSnapshotFromWorkspace(workspaceContext);
  const userIntent = extractUserIntent(request, snapshot.root);
  const techStack = getProjectTechStack(workspaceContext);
  const filesSummary = getProjectFilesSummary(workspaceContext);
  const destructivePaths = detectDestructivePaths(workspaceContext);

  displayPhase('Reading workspace...');
  const messages: ChatMessage[] = [
    {
      role: 'system' as const,
      content: `${ZOE_STRUCTURED_PLAN_PROMPT}

## PROJECT CONTEXT
${projectContext}

## TECH STACK
${techStack}

## FILES SUMMARY
${filesSummary}

## USER REQUEST
${request}

## AUTHORITATIVE USER CONSTRAINTS
${JSON.stringify(userIntent.constraints, null, 2)}
These constraints are Runtime-owned. Copy them exactly. Never weaken or reinterpret them.

## AUTHORITATIVE REQUESTED CHANGES
${JSON.stringify(userIntent.requestedChanges, null, 2)}
These exact values are Runtime-owned. They cannot be omitted, replaced with placeholders, or described as unknown.

## ADDITIONAL CONTEXT
Critical config files present: ${destructivePaths.length > 0 ? destructivePaths.join(', ') : 'None'}

## PROJECT SNAPSHOT
${JSON.stringify(snapshot, null, 2)}

Now return the JSON plan.`
    }
  ];

  displayPhase('Analyzing request...');
  displayThinking();

  let plan = await callOpenRouter(messages);
  cancellationToken?.throwIfCancelled();
  let parsed = parseExecutionPlan(plan, userIntent.constraints);
  if (parsed.success) parsed = { success: true, plan: enforceRequestedChanges(parsed.plan, userIntent.requestedChanges) };
  if (!parsed.success) {
    displayPhase('Repairing invalid plan...');
    messages.push({ role: 'assistant', content: plan }, { role: 'user', content: `Return ONLY one corrected JSON object matching the ExecutionPlan schema exactly. Fix every validation error below. verification must be an object with type and its fields, never a string. userConstraints must be an object with allowedFiles, forbiddenFiles, allowDependencyInstall, and allowNewFiles, never an array. Do not add prose or Markdown. Validation errors: ${parsed.error}` });
    plan = await callOpenRouter(messages);
    cancellationToken?.throwIfCancelled();
    parsed = parseExecutionPlan(plan, userIntent.constraints);
    if (parsed.success) parsed = { success: true, plan: enforceRequestedChanges(parsed.plan, userIntent.requestedChanges) };
  }
  if (!parsed.success) {
    const explanation = `NEEDS_USER_INPUT: The planner returned an invalid structured plan. ${parsed.error}`;
    addMessage('assistant', explanation);
    return { plan: explanation, isDestructive: true, status: 'NEEDS_USER_INPUT' };
  }
  const planErrors = [...validateExecutionPlan(parsed.plan, snapshot), ...validateRuntimeConstraints(parsed.plan, userIntent.constraints)];
  if (planErrors.length > 0) {
    displayPhase('Repairing plan constraints...');
    messages.push(
      { role: 'assistant', content: plan },
      { role: 'user', content: `Return ONLY one corrected JSON object. The previous JSON is structurally valid but violates the user constraints. Remove every file not in allowedFiles, never create a file when allowNewFiles is false, remove forbidden commands, and preserve the requested requirements. Revalidate the complete plan before responding. Constraint errors: ${planErrors.join(' | ')}` },
    );
    plan = await callOpenRouter(messages);
    cancellationToken?.throwIfCancelled();
    parsed = parseExecutionPlan(plan, userIntent.constraints);
    if (parsed.success) parsed = { success: true, plan: enforceRequestedChanges(parsed.plan, userIntent.requestedChanges) };
    if (parsed.success) {
      const repairedErrors = [...validateExecutionPlan(parsed.plan, snapshot), ...validateRuntimeConstraints(parsed.plan, userIntent.constraints)];
      if (repairedErrors.length === 0) {
        plan = JSON.stringify(parsed.plan, null, 2);
        const isDestructive = parsed.plan.risks.length > 0 || destructivePaths.length > 0;
        addMessage('assistant', plan);
        return { plan, isDestructive };
      }
      planErrors.splice(0, planErrors.length, ...repairedErrors);
    } else {
      const explanation = `NEEDS_USER_INPUT: The repaired plan is invalid. ${parsed.error}`;
      addMessage('assistant', explanation);
      return { plan: explanation, isDestructive: true, status: 'NEEDS_USER_INPUT' };
    }
    const explanation = `NEEDS_USER_INPUT: Invalid execution plan after repair. ${planErrors.join(' | ')}`;
    addMessage('assistant', explanation);
    return { plan: explanation, isDestructive: true, status: 'NEEDS_USER_INPUT' };
  }
  plan = JSON.stringify(parsed.plan, null, 2);
  const isDestructive = parsed.plan.risks.length > 0 || destructivePaths.length > 0;

  addMessage('assistant', plan);

  return { plan, isDestructive };
}

export async function executeRuntimeV2(
  request: string,
  plan: string,
  workspaceContext = getWorkspaceContext(),
  cancellationToken?: TaskCancellationToken,
  onCheckpointStage?: (stage: CheckpointPipelineStage, metadata?: CheckpointStageMetadata) => Promise<void>
): Promise<{
  filesCreated: number;
  filesModified: number;
  warnings: string[];
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'NEEDS_USER_INPUT';
  missingFiles: string[];
  missingRequirements: string[];
  nextStep?: string;
  elapsedMs: number;
}> {
  readFileCache.clear();
  cancellationToken?.throwIfCancelled();
  const startTime = Date.now();
  const snapshot = createProjectSnapshotFromWorkspace(workspaceContext);
  const controller = new RuntimeController();
  controller.transition('ANALYZING');
  controller.setPhase('EXPLORE');
  controller.setSnapshot(snapshot);
  const userIntent = extractUserIntent(request, snapshot.root);
  let parsedPlan = parseExecutionPlan(plan, userIntent.constraints);
  if (parsedPlan.success) parsedPlan = { success: true, plan: enforceRequestedChanges(parsedPlan.plan, userIntent.requestedChanges) };
  if (!parsedPlan.success) {
    controller.finish('NEEDS_USER_INPUT');
    return { filesCreated: 0, filesModified: 0, warnings: [parsedPlan.error], status: 'NEEDS_USER_INPUT', missingFiles: [], missingRequirements: [], elapsedMs: Date.now() - startTime };
  }
  const planErrors = [...validateExecutionPlan(parsedPlan.plan, snapshot), ...validateRuntimeConstraints(parsedPlan.plan, userIntent.constraints)];
  if (planErrors.length > 0) {
    controller.finish('NEEDS_USER_INPUT');
    return { filesCreated: 0, filesModified: 0, warnings: planErrors, status: 'NEEDS_USER_INPUT', missingFiles: [], missingRequirements: [], elapsedMs: Date.now() - startTime };
  }
  controller.transition('PLANNING');
  controller.setPhase('PLAN');
  controller.setPlan(parsedPlan.plan);
  controller.transition('EXECUTING');
  controller.setPhase('BUILD');
  plan = JSON.stringify(parsedPlan.plan, null, 2);
  const model = getModel();

  const projectContext = getProjectDescription(workspaceContext);
  const techStack = getProjectTechStack(workspaceContext);
  const execSysCtx = `\n## SYSTEM CONTEXT\n- Node.js: ${process.version}\n- Package manager: npm\n- OS: ${os.platform()} ${os.release()}\n- Working directory: ${process.cwd()}\n`;

  const fileTracker = { created: 0, modified: 0 };
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const hadPackageJsonBefore = fs.existsSync(packageJsonPath);
  const verificationWarningsForExecution: string[] = [];
  const editRepairAttempts = new Map<string, number>();
  const beforeHashes = new Map<string, string | undefined>(parsedPlan.plan.files.map((file) => {
    const resolved = resolvePlannedFile(file.path);
    const hash = resolved ? createHash('sha256').update(fs.readFileSync(resolved)).digest('hex') : undefined;
    return [file.path.replace(/\\/g, '/'), hash];
  }));
  const runtimePlan = extractRuntimePlan(plan);
  const builderPolicy = createBuilderToolPolicy();
  const runtime = createExecutionRuntime(runtimePlan);
  const impossibleHeadlineTarget = userIntent.requestedChanges.find((change) => {
    if (change.operation !== 'replace_headline') return false;
    const target = resolvePlannedFile(change.file);
    if (!target) return true;
    const source = fs.readFileSync(target, 'utf8');
    return !/<h1\b[^>]*>/i.test(source);
  });
  if (impossibleHeadlineTarget) {
    controller.setPhase('FINAL STATE');
    controller.finish('NEEDS_USER_INPUT');
    return {
      filesCreated: 0,
      filesModified: 0,
      warnings: [`The requested semantic target (main headline) was not found in ${impossibleHeadlineTarget.file}. Authorize the file containing that page headline or clarify the target.`],
      status: 'NEEDS_USER_INPUT',
      missingFiles: [],
      missingRequirements: [`main headline in ${impossibleHeadlineTarget.file}`],
      elapsedMs: Date.now() - startTime,
    };
  }
  const reconcileFileActions = (results: Array<{ name: string; output: string }>) => {
    const created: string[] = [];
    const modified: string[] = [];
    for (const result of results) {
      controller.recordEvent('tool_request', { name: result.name, output: result.output.slice(0, 500) });
      if (result.name === 'builder_guard') controller.recordEvent('tool_request', { event: 'BUILDER_EXPLORATION_BLOCKED', detail: result.output });
      const match = result.output.match(/^File (?:written|edited):\s*(.+)$/m);
      if (!match) continue;
      const file = match[1].trim();
      const action = parsedPlan.plan.files.find((entry) => entry.path.replace(/\\/g, '/') === file.replace(/\\/g, '/'))?.action;
      const resolved = resolvePlannedFile(file);
      const afterHash = resolved ? createHash('sha256').update(fs.readFileSync(resolved)).digest('hex') : undefined;
      const beforeHash = beforeHashes.get(file.replace(/\\/g, '/'));
      controller.recordEvent('file_hash', { path: file, beforeHash, afterHash });
      if (action === 'create' && afterHash) { created.push(file); controller.recordFile(file, 'create'); }
      if (action === 'modify' && beforeHash && afterHash && beforeHash !== afterHash) { modified.push(file); controller.recordFile(file, 'modify'); }
    }
    runtime.inspect({ filesCreated: created, filesModified: modified });
  };
  displayPhase(`Runtime: ${detectPackageManager()} · plan loaded`);

  // Phase 3 — Execute
  displayPhase('Building...');

  const executionMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    {
      role: 'system',
      content: `${ZOE_EXECUTE_PROMPT}
${plan}

${execSysCtx}
## PROJECT CONTEXT
${projectContext}

## TECH STACK
${techStack}

## USER REQUEST
${request}

## AUTHORITATIVE REQUESTED CHANGES
${JSON.stringify(userIntent.requestedChanges, null, 2)}
Use the exact value above. Do not claim it was unspecified.

## AVAILABLE TOOLS
${tools.map(t => `- ${t.name}: ${t.description} — params: ${Object.keys(t.parameters.properties).join(', ')}`).join('\n')}`
    }
  ];

  const executionResult = await callOpenRouter(executionMessages);
  cancellationToken?.throwIfCancelled();
  cancellationToken?.enter('Tool execution');
  const { text: processedResult, toolResults, writesSucceeded: firstWrites } = await processToolCalls(executionResult, fileTracker, editRepairAttempts, builderPolicy, workspaceContext, cancellationToken);
  reconcileFileActions(toolResults);
  let finalExecText = processedResult || executionResult;
  let totalWrites = firstWrites;

  // Feedback loop — keep prompting until the AI stops calling tools or hits limit
  let loopCount = 0;
  let workingToolResults = [...toolResults];
  let consecutiveNoWrites = 0;
  const MAX_NO_WRITE_ITERATIONS = 3;
  while (workingToolResults.length > 0 && runtimePlan.filesToCreate.length === 0 && runtimePlan.filesToModify.length === 0 && loopCount < 5) {
    loopCount++;

    // Stagnation guard: if the last batch had no writes, count it. After 3
    // consecutive no-progress iterations, break the loop — the AI isn't making
    // progress and continuing wastes tokens + confuses the user.
    const hadProgress = workingToolResults.some(r =>
      r.name === 'write_file' || r.name === 'edit_file' || r.name === 'run_command'
    );
    if (hadProgress) {
      consecutiveNoWrites = 0;
    } else {
      consecutiveNoWrites++;
    }
    if (consecutiveNoWrites >= MAX_NO_WRITE_ITERATIONS) {
      break;
    }
    const staleEditNeedsRepair = workingToolResults.some((result) =>
      result.output.includes('Fresh file content for one focused repair attempt:')
    );

    executionMessages.push(
      { role: 'assistant' as const, content: finalExecText },
      { role: 'user' as const, content: `Tool results:\n${workingToolResults.map(r => {
        const maxOut = r.name === 'run_command' ? 2000 : 500;
        const out = r.output.length > maxOut ? '...(truncated)\n' + r.output.slice(-maxOut) : r.output;
        return `${r.name}: ${out}`;
      }).join('\n\n')}\n\n${staleEditNeedsRepair ? 'Make one focused edit_file repair using the fresh file content above. Do not use the prior old_text or call any other tool.' : 'Continue. If you need to do more work (read another file, edit more, etc.), use the appropriate tool calls. When you are completely done, respond with a one-sentence summary and no tool calls.'}` }
    );
    displayPhase(`Continuing (step ${loopCount + 1})...`);
    const continueResult = await callOpenRouter(executionMessages);
    cancellationToken?.throwIfCancelled();
    const processed = await processToolCalls(continueResult, fileTracker, editRepairAttempts, builderPolicy, workspaceContext, cancellationToken);
    reconcileFileActions(processed.toolResults);
    totalWrites += processed.writesSucceeded;
    if (processed.toolResults.length === 0) {
      finalExecText = processed.text || continueResult;
      break;
    }
    finalExecText = processed.text || continueResult;
    workingToolResults = [...processed.toolResults];
  }

  // Scaffolding safeguard: creating package.json without installing its
  // dependencies leaves a new project unusable. Run npm install locally after
  // the model has created a package manifest, with the normal shell permission
  // prompt still applied by executeTool.
  if (userIntent.constraints.allowDependencyInstall && !hadPackageJsonBefore && fs.existsSync(packageJsonPath) && !fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
    displayPhase('Installing dependencies...');
    const installResult = await executeTool('run_command', { command: 'npm install', cwd: process.cwd(), timeout: 180 });
    if (!installResult.startsWith('Command executed:')) {
      verificationWarningsForExecution.push(`npm install failed: ${installResult.slice(0, 300)}`);
    }
  }

  // Completion safeguard: do not report success while files explicitly listed
  // in the plan are still missing. Give the model a bounded chance to finish
  // the remaining implementation instead of stopping at an intermediate turn.
  for (let completionAttempt = 0; completionAttempt < 2; completionAttempt++) {
    if (!runtime.beginRepair()) break;
    const pendingActions = runtime.state.pendingSteps.filter((step) => step.startsWith('create:') || step.startsWith('modify:'));
    const missingPaths = pendingActions.map((step) => step.slice(step.indexOf(':') + 1));
    const missingRequirements = getMissingPlannedRequirements(plan);
    if (missingPaths.length === 0) break;
    const pendingContent = missingPaths.map((file) => {
      const resolved = resolvePlannedFile(file);
      return `${file}:\n${resolved ? fs.readFileSync(resolved, 'utf8') : '(file missing)'}`;
    }).join('\n\n');

    executionMessages.push(
      { role: 'assistant' as const, content: finalExecText },
      { role: 'user' as const, content: `Required file actions remain pending:\n${pendingActions.join('\n')}\n\nRequirements:\n${missingRequirements.join('\n') || '(none)'}\n\nLatest file content:\n${pendingContent}\n\nBuilder is no longer allowed to explore. Emit an edit_file or write_file call for every pending action now. Do not respond with prose, read_file, grep, or search calls.` }
    );
    displayPhase(`Completing remaining files (step ${completionAttempt + 1})...`);
    const completionResult = await callOpenRouter(executionMessages);
    cancellationToken?.throwIfCancelled();
    const completionProcessed = await processToolCalls(completionResult, fileTracker, editRepairAttempts, builderPolicy, workspaceContext, cancellationToken);
    reconcileFileActions(completionProcessed.toolResults);
    totalWrites += completionProcessed.writesSucceeded;
    finalExecText = completionProcessed.text || completionResult;
    if (completionProcessed.toolResults.length === 0) break;
  }
  await onCheckpointStage?.('ToolExecution', { completedToolBatches: 1, completedToolNames: toolResults.map((result) => result.name), toolElapsedMs: Date.now() - startTime });
  const pendingFileActions = runtime.state.pendingSteps.filter((step) => step.startsWith('create:') || step.startsWith('modify:'));
  if (pendingFileActions.length > 0) {
    runtime.markFailed();
    controller.setPhase('FINAL STATE');
    controller.finish('FAILED');
    return {
      filesCreated: fileTracker.created,
      filesModified: fileTracker.modified,
      warnings: ['Zoe could not produce the required file modification.'],
      status: 'FAILED',
      missingFiles: pendingFileActions.map((step) => step.slice(step.indexOf(':') + 1)),
      missingRequirements: getMissingPlannedRequirements(plan),
      elapsedMs: Date.now() - startTime,
    };
  }

  const semanticIssues = userIntent.requestedChanges.flatMap((change) => {
    const target = resolvePlannedFile(change.file);
    return target ? verifySemanticRequestedChanges(fs.readFileSync(target, 'utf8'), [change]) : [`Requested file is missing: ${change.file}`];
  });
  if (semanticIssues.length > 0) {
    runtime.markFailed();
    controller.setPhase('FINAL STATE');
    controller.finish('FAILED');
    return {
      filesCreated: fileTracker.created,
      filesModified: fileTracker.modified,
      warnings: semanticIssues,
      status: 'FAILED',
      missingFiles: [],
      missingRequirements: semanticIssues,
      elapsedMs: Date.now() - startTime,
    };
  }

  // HONESTY GUARD: If the AI claimed completion but no writes succeeded, append a correction
  if (totalWrites === 0) {
    finalExecText += '\n\nNo files were modified. The task did not produce any file changes.';
  }

  addMessage('assistant', finalExecText);

  // Phase 4 — Review
  displayPhase('Reviewing...');
  controller.transition('VERIFYING');
  controller.setPhase('REVIEW');
  const validationRoot = findExecutionRoot(runtimePlan);

  const verificationWarnings: string[] = [...verificationWarningsForExecution];
  for (const command of getPlanValidationCommands(plan, validationRoot)) {
    cancellationToken?.enter('Validation');
    controller.setPhase('VERIFY');
    displayPhase(`Verifying (${command})...`);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: validationRoot,
        timeout: 120_000,
        maxBuffer: 512 * 1024,
      });
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      controller.recordEvent('command', { command, exitCode: 0, output });
      controller.recordValidation({ name: command, passed: true, output });
      controller.recordStep(`validation:${command}`);
      controller.recordStep(`command:${command}`);
      console.log(`  ${chalk.green('✓')} ${command} passed${output ? ` — ${output.split('\n').filter(Boolean).slice(-1)[0]}` : ''}`);
    } catch (error: any) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
      controller.recordEvent('command', { command, exitCode: error.code ?? 1, output });
      controller.recordValidation({ name: command, passed: false, output });
      verificationWarnings.push(`${command} failed${output ? `: ${output.split('\n').filter(Boolean).slice(-3).join(' | ')}` : ''}`);
      console.log(`  ${chalk.red('✗')} ${command} failed`);
    }
  }
  await onCheckpointStage?.('Validation', { validationStatus: verificationWarnings.length > 0 ? 'FAILED' : 'PASSED', validationResultNames: getPlanValidationCommands(plan, validationRoot) });

  const reviewMessages = [
    {
      role: 'system' as const,
      content: `${ZOE_REVIEW_PROMPT}

## PLAN
${plan}

## EXECUTION RESULT
${finalExecText}

## FILES CREATED: ${fileTracker.created}
## FILES MODIFIED: ${fileTracker.modified}

## WORKSPACE CONTEXT
Version: ${workspaceContext.contextVersion}
Frameworks: ${workspaceContext.detectedFrameworks.join(', ') || 'Unknown'}
Important files: ${workspaceContext.importantFiles.join(', ') || 'None'}

Review the work done. End with exactly one line: BLOCKING_ISSUES: none, or BLOCKING_ISSUES: followed by the required change that is incomplete, incorrect, misleading, or semantically unsatisfied.`
    }
  ];

  cancellationToken?.enter('Reviewer');
  const reviewResult = await callOpenRouter(reviewMessages);
  cancellationToken?.throwIfCancelled();

  const warnings: string[] = [...verificationWarnings];
  controller.recordEvent('verification', { reviewer: 'authoritative', output: reviewResult.slice(0, 1000) });
  const reviewBlocked = hasBlockingReview(reviewResult);
  await onCheckpointStage?.('Reviewer', { reviewStatus: reviewBlocked ? 'BLOCKED' : 'PASSED' });
  if (reviewBlocked) warnings.push(`Reviewer blocking issue: ${reviewResult.trim()}`);

  const missingFiles = getMissingPlannedPaths(plan);
  const missingRequirements = getMissingPlannedRequirements(plan);
  runtime.inspect({
    implementedRequirements: runtimePlan.requirements.filter((requirement) => !missingRequirements.includes(requirement)),
  });
  for (const requirement of runtime.state.implementedRequirements) runtime.completeStep(`requirement:${requirement}`);
  for (const command of getPlanValidationCommands(plan, validationRoot)) {
    runtime.recordValidation({ command, passed: !verificationWarnings.some((warning) => warning.startsWith(`${command} failed`)), output: '' });
  }
  if (missingFiles.length > 0) warnings.push(`Missing planned files: ${missingFiles.join(', ')}`);
  if (missingRequirements.length > 0) warnings.push(`Missing requirements: ${missingRequirements.join(', ')}`);
  for (const requirement of parsedPlan.plan.requirements) {
    if (!missingRequirements.includes(requirement.description) && !missingRequirements.includes(requirement.id)) controller.recordStep(`requirement:${requirement.id}`);
  }
  const verificationFailed = verificationWarnings.some((warning) => /failed/i.test(warning));
  const runtimeFailed = verificationFailed || reviewBlocked || missingFiles.length > 0 || missingRequirements.length > 0 || totalWrites === 0 || controller.state.pendingSteps.length > 0;
  controller.setPhase('FINAL STATE');
  controller.finish(runtimeFailed ? 'FAILED' : 'SUCCESS');
  const status = controller.state.status as 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'NEEDS_USER_INPUT';

  // Determine next step
  let nextStep: string | undefined;
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.dev) {
        nextStep = `npm run dev`;
      } else if (pkg.scripts?.start) {
        nextStep = `npm start`;
      }
    } catch {
      // ignore
    }
  }

  return {
    filesCreated: fileTracker.created,
    filesModified: fileTracker.modified,
    warnings,
    status,
    missingFiles,
    missingRequirements,
    nextStep,
    elapsedMs: Date.now() - startTime,
  };
}

function extractRuntimePlan(plan: string): ExecutionPlan {
  try {
    const structured = JSON.parse(plan) as any;
    if (Array.isArray(structured.files) && Array.isArray(structured.requirements)) {
      return {
        filesToCreate: structured.files.filter((file: any) => file.action === 'create').map((file: any) => file.path),
        filesToModify: structured.files.filter((file: any) => file.action === 'modify').map((file: any) => file.path),
        requirements: structured.requirements.map((requirement: any) => requirement.description),
        validationCommands: (structured.validationCommands ?? []).map((command: any) => command.command),
        successCriteria: [],
      };
    }
  } catch { /* legacy plans are handled below */ }
  const readSection = (label: string): string => plan.match(new RegExp(`(?:###\\s*${label}|${label}:)\\s*([\\s\\S]*?)(?=###|##|$)`, 'i'))?.[1] ?? '';
  const bullets = (value: string): string[] => [...value.matchAll(/^\s*[-*]\s+`?([^`\n]+)`?\s*$/gm)].map((match) => match[1].trim());
  return {
    filesToCreate: bullets(readSection('Files to create')),
    filesToModify: bullets(readSection('Files to modify')),
    requirements: bullets(readSection('Requirements')),
    validationCommands: bullets(readSection('Validation commands')),
    successCriteria: bullets(readSection('Success criteria')),
  };
}

function findExecutionRoot(runtimePlan: ExecutionPlan): string {
  const candidates = [...runtimePlan.filesToCreate, ...runtimePlan.filesToModify]
    .map((file) => resolvePlannedFile(file))
    .filter((file): file is string => Boolean(file));
  for (const file of candidates) {
    let directory = path.dirname(file);
    while (directory.startsWith(process.cwd())) {
      if (fs.existsSync(path.join(directory, 'package.json'))) return directory;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return process.cwd();
}

function getVerificationCommands(cwd = process.cwd()): string[] {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};
    const manager = detectPackageManager(cwd);
    return ['typecheck', 'test', 'lint', 'build']
      .filter((name) => typeof scripts[name] === 'string' && !scripts[name].includes('watch'))
      .map((name) => `${manager} run ${name}`);
  } catch {
    return [];
  }
}

function getPlanValidationCommands(plan: string, cwd: string): string[] {
  try {
    const structured = JSON.parse(plan) as any;
    if (Array.isArray(structured.validationCommands)) {
      return structured.validationCommands.filter((item: any) => item?.required !== false && item?.command)
        .map((item: any) => String(item.command));
    }
  } catch { /* legacy plan */ }
  return getVerificationCommands(cwd);
}

function getMissingPlannedPaths(plan: string): string[] {
  const candidates = [...plan.matchAll(/-\s+`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((candidate) => !candidate.includes(' — ') && !candidate.includes(' - '));
  return [...new Set(candidates)].filter((candidate) => {
    const normalized = candidate.replace(/\/$/, '');
    return normalized.length > 0 && !resolvePlannedFile(normalized);
  });
}

function getMissingPlannedRequirements(plan: string): string[] {
  try {
    const structured = JSON.parse(plan) as any;
    if (Array.isArray(structured.requirements)) {
      return structured.requirements.filter((requirement: any) => {
        const verification = requirement.verification;
        if (!verification) return true;
        if (verification.type === 'file_exists') return !resolvePlannedFile(verification.path);
        if (verification.type === 'file_contains') {
          const file = resolvePlannedFile(verification.path);
          if (!file) return true;
          const source = fs.readFileSync(file, 'utf8');
          return !verification.patterns.every((pattern: string) => source.includes(pattern));
        }
        return false;
      }).map((requirement: any) => requirement.description || requirement.id);
    }
  } catch { /* legacy text plan */ }
  const section = plan.match(/(?:###\s*Requirements|Requirements:)\s*([\s\S]*?)(?=###|##|$)/i)?.[1] || '';
  const requirements = [...section.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((match) => match[1].trim());
  if (requirements.length === 0) return [];

  const source = getProjectTextFiles().map((file) => {
    try { return fs.readFileSync(file, 'utf8').toLowerCase(); } catch { return ''; }
  }).join('\n');

  return requirements.filter((requirement) => {
    const lower = requirement.toLowerCase();
    const terms = lower.includes('navbar') || lower.includes('navigation') ? ['nav', 'header']
      : lower.includes('hero') ? ['hero']
      : lower.includes('feature') ? ['feature']
      : lower.includes('cta') || lower.includes('call to action') ? ['cta', 'call to action']
      : lower.includes('footer') ? ['footer']
      : lower.includes('responsive') || lower.includes('mobile') ? ['@media', 'responsive', 'viewport']
      : [lower.split(/\s+/).slice(0, 2).join(' ')];
    return !terms.some((term) => source.includes(term));
  });
}

function getProjectTextFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'build', '.zoe'].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(tsx?|jsx?|css|html|json|vue|svelte)$/.test(entry.name)) files.push(full);
    }
  };
  walk(process.cwd());
  return files;
}
