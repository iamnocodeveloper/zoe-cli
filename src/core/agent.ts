import { getModel } from './config.js';
import { getInsForgeClient } from './insforge.js';
import { getProjectDescription, getProjectTechStack, getProjectFilesSummary, detectDestructivePaths } from './context.js';
import { addMessage, getConversationHistory, getConversationContext, loadSession } from './memory.js';
import { executeTool, tools } from './tools.js';
import { ZOE_CHAT_SYSTEM_PROMPT, ZOE_SYSTEM_PROMPT, ZOE_PLAN_PROMPT, ZOE_EXECUTE_PROMPT, ZOE_REVIEW_PROMPT } from './prompt.js';
import { displayThinking, clearThinking, displayPhase } from '../ui/display.js';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import os from 'os';

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; callId: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; callId: string; output: string }
  | { type: 'reasoning'; delta: string };

async function callOpenRouter(
  messages: ChatMessage[],
  options?: { onFirstToken?: () => void }
): Promise<string> {
  const model = getModel();
  const client = await getInsForgeClient();

  let stream: AsyncIterable<any>;
  try {
    stream = await client.ai.chat.completions.create({
      model,
      messages,
      stream: true,
      temperature: 0.7,
    });
  } catch (gatewayErr) {
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
    const decoder = new TextDecoder();
    let full = '';
    let firstToken = false;

    while (reader) {
      const { done, value } = await reader.read();
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
            options.onFirstToken();
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
  fileTracker?: { created: number; modified: number }
): Promise<{ text: string; toolResults: { name: string; output: string }[]; writesSucceeded: number }> {
  const functionCallRegex = /<function_calls>([\s\S]*?)<\/function_calls>/g;
  let result = response;
  const toolResults: { name: string; output: string }[] = [];
  let writesSucceeded = 0;

  for (const match of response.matchAll(functionCallRegex)) {
    const block = match[1];

    const invokeRegex = /<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/g;
    for (const invoke of block.matchAll(invokeRegex)) {
      const toolName = invoke[1];
      const paramsBlock = invoke[2];

      const paramRegex = /<parameter name="([^"]+)">([\s\S]*?)<\/parameter>/g;
      const params: Record<string, string> = {};
      for (const param of paramsBlock.matchAll(paramRegex)) {
        params[param[1]] = param[2].trim();
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
      const toolResult = await executeTool(toolName, params);

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
        if (fs.existsSync(fullPath)) {
          fileTracker.modified++;
        } else {
          fileTracker.created++;
        }
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
  options?: { onFirstToken?: () => void }
) {
  readFileCache.clear();
  const model = getModel();

  loadSession();
  addMessage('user', prompt);

  const projectContext = getProjectDescription();
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

  const localFileTracker = { created: 0, modified: 0 };
  const { text, toolResults, writesSucceeded } = await processToolCalls(fullResponse, localFileTracker);
  let finalResponse = text || fullResponse;
  let totalWrites = writesSucceeded;

  // ALWAYS run feedback loop after tool calls so the AI produces a summary
  // and the user sees a clear "Done" message before the next prompt.
  if (toolResults.length > 0) {
    // Stagnation guard: if the first batch of tool results had no writes, skip
    // the feedback loop entirely — there's nothing to follow up on.
    const firstBatchHadProgress = toolResults.some(r =>
      r.name === 'write_file' || r.name === 'edit_file' || r.name === 'run_command'
    );

    if (firstBatchHadProgress) {
      messages.push(
        { role: 'assistant' as const, content: finalResponse },
        { role: 'user' as const, content: `Tool results:\n${toolResults.map(r => {
        const maxOut = r.name === 'run_command' ? 2000 : 500;
        const out = r.output.length > maxOut ? '...(truncated)\n' + r.output.slice(-maxOut) : r.output;
        return `${r.name}: ${out}`;
      }).join('\n\n')}\n\nProvide a brief summary of what was done. If more work is needed (e.g., another file to create, or the user expected multiple changes), proceed with the next tool call. IMPORTANT: If no write_file or edit_file succeeded, state clearly that no files were modified yet.` }
      );
      displayThinking();
      try {
        const followup = await callOpenRouter(messages, { onFirstToken: clearThinking });
        const followupProcessed = await processToolCalls(followup, localFileTracker);
        totalWrites += followupProcessed.writesSucceeded;

        // Stagnation guard in recursive feedback: if the followup had no
        // additional writes, accept the text and stop.
        const followupHadProgress = followupProcessed.toolResults.some(r =>
          r.name === 'write_file' || r.name === 'edit_file' || r.name === 'run_command'
        );

        if (followupProcessed.toolResults.length > 0 && followupHadProgress) {
          messages.push(
            { role: 'assistant' as const, content: followupProcessed.text || followup },
            { role: 'user' as const, content: `Tool results:\n${followupProcessed.toolResults.map(r => `${r.name}: ${r.output.slice(0, 500)}`).join('\n\n')}\n\nProvide a final summary of everything that was done.` }
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

// ---- TASK EXECUTOR: Full Pipeline ----

export async function createPlan(request: string): Promise<{
  plan: string;
  isDestructive: boolean;
}> {
  loadSession();
  addMessage('user', request);

  const projectContext = getProjectDescription();
  const techStack = getProjectTechStack();
  const filesSummary = getProjectFilesSummary();
  const destructivePaths = detectDestructivePaths();

  displayPhase('Reading workspace...');
  const messages = [
    {
      role: 'system' as const,
      content: `${ZOE_PLAN_PROMPT}

## PROJECT CONTEXT
${projectContext}

## TECH STACK
${techStack}

## FILES SUMMARY
${filesSummary}

## USER REQUEST
${request}

## ADDITIONAL CONTEXT
Critical config files present: ${destructivePaths.length > 0 ? destructivePaths.join(', ') : 'None'}

Now create an execution plan.`
    }
  ];

  displayPhase('Analyzing request...');
  displayThinking();

  const plan = await callOpenRouter(messages);
  const isDestructive = plan.toLowerCase().includes('[destructive]') || destructivePaths.length > 0;

  addMessage('assistant', plan);

  return { plan, isDestructive };
}

export async function executePlan(
  request: string,
  plan: string
): Promise<{
  filesCreated: number;
  filesModified: number;
  warnings: string[];
  nextStep?: string;
  elapsedMs: number;
}> {
  readFileCache.clear();
  const startTime = Date.now();
  const model = getModel();

  const projectContext = getProjectDescription();
  const techStack = getProjectTechStack();
  const execSysCtx = `\n## SYSTEM CONTEXT\n- Node.js: ${process.version}\n- Package manager: npm\n- OS: ${os.platform()} ${os.release()}\n- Working directory: ${process.cwd()}\n`;

  const fileTracker = { created: 0, modified: 0 };

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

## AVAILABLE TOOLS
${tools.map(t => `- ${t.name}: ${t.description} — params: ${Object.keys(t.parameters.properties).join(', ')}`).join('\n')}`
    }
  ];

  const executionResult = await callOpenRouter(executionMessages);
  const { text: processedResult, toolResults, writesSucceeded: firstWrites } = await processToolCalls(executionResult, fileTracker);
  let finalExecText = processedResult || executionResult;
  let totalWrites = firstWrites;

  // Feedback loop — keep prompting until the AI stops calling tools or hits limit
  let loopCount = 0;
  let workingToolResults = [...toolResults];
  let consecutiveNoWrites = 0;
  const MAX_NO_WRITE_ITERATIONS = 3;
  while (workingToolResults.length > 0 && loopCount < 5) {
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

    executionMessages.push(
      { role: 'assistant' as const, content: finalExecText },
      { role: 'user' as const, content: `Tool results:\n${workingToolResults.map(r => {
        const maxOut = r.name === 'run_command' ? 2000 : 500;
        const out = r.output.length > maxOut ? '...(truncated)\n' + r.output.slice(-maxOut) : r.output;
        return `${r.name}: ${out}`;
      }).join('\n\n')}\n\nContinue. If you need to do more work (read another file, edit more, etc.), use the appropriate tool calls. When you're completely done, respond with a one-sentence summary and NO tool calls. IMPORTANT: If no write_file or edit_file succeeded so far, state that no files have been modified yet.` }
    );
    displayPhase(`Continuing (step ${loopCount + 1})...`);
    const continueResult = await callOpenRouter(executionMessages);
    const processed = await processToolCalls(continueResult, fileTracker);
    totalWrites += processed.writesSucceeded;
    if (processed.toolResults.length === 0) {
      finalExecText = processed.text || continueResult;
      break;
    }
    finalExecText = processed.text || continueResult;
    workingToolResults = [...processed.toolResults];
  }

  // HONESTY GUARD: If the AI claimed completion but no writes succeeded, append a correction
  if (totalWrites === 0) {
    finalExecText += '\n\nNo files were modified. The task did not produce any file changes.';
  }

  addMessage('assistant', finalExecText);

  // Phase 4 — Review
  displayPhase('Reviewing...');

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

Review the work done.`
    }
  ];

  const reviewResult = await callOpenRouter(reviewMessages);

  const warnings: string[] = [];
  if (reviewResult.toLowerCase().includes('import')) {
    warnings.push('Check imports');
  }
  if (reviewResult.toLowerCase().includes('todo') || reviewResult.toLowerCase().includes('placeholder')) {
    warnings.push('Incomplete code detected');
  }
  if (reviewResult.toLowerCase().includes('error') || reviewResult.toLowerCase().includes('missing')) {
    warnings.push('Review found issues');
  }

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
    nextStep,
    elapsedMs: Date.now() - startTime,
  };
}
