import fs from 'node:fs';
import path from 'node:path';

export type UserConstraints = {
  allowedFiles: string[];
  forbiddenFiles: string[];
  allowNewFiles: boolean;
  allowDependencyInstall: boolean;
  allowCommands: boolean;
  requiredValidationCommands: string[];
  requestedFramework: string | null;
  requestedLanguage: string | null;
};

export type UserIntent = {
  originalUserPrompt: OriginalUserPrompt;
  originalRequest: string;
  constraints: UserConstraints;
  requestedChanges: RequestedChange[];
};

export type OriginalUserPrompt = Readonly<{ raw: string }>;

export type RequestedChange = {
  file: string;
  operation: 'replace_headline';
  exactValue: string;
};

export function extractUserIntent(request: string | OriginalUserPrompt, root = process.cwd()): UserIntent {
  const rawRequest = typeof request === 'string' ? request : request.raw;
  const originalUserPrompt: OriginalUserPrompt = Object.freeze({ raw: rawRequest });
  request = rawRequest;
  const lower = request.toLowerCase();
  const restricted = /(?:modify|edit|change|touch|modifica|edita|cambia)\s+only\s*:?|(?:modifica|edita|cambia)\s+solo\s*:?/i.test(request);
  const allowedFiles = restricted ? extractExplicitPaths(request).map((candidate) => canonicalExistingPath(candidate, root)) : [];
  const forbidCreates = /(?:do not|don't|must not|never|no)\s+(?:create|add)\s+(?:new\s+)?files?|no\s+(?:crees|crear)\s+archivos?/i.test(request);
  const forbidInstall = /(?:do not|don't|must not|never|no)\s+(?:install|add)\s+dependenc(?:y|ies)|no\s+instal(?:es|ar)\s+dependencias?/i.test(request);
  const requestedCommands = extractCommands(request);
  const forbidCommands = /(?:do not|don't|must not|never|no)\s+(?:run|execute)\s+commands?|no\s+(?:ejecutes|ejecutar)\s+comandos?/i.test(request);
  const requestedChanges: RequestedChange[] = [];
  const exactValue = extractExactValue(request);
  const valueMatch = request.match(/(?:to|as|como)\s*:\s*["“]?([^\r\n"”]+?)["”]?(?:\r?\n|$)/im);
  const headlineFile = allowedFiles.find((file) => /(?:^|\/)App\.tsx$/i.test(file));
  if (headlineFile && exactValue) {
    requestedChanges.push({ file: headlineFile, operation: 'replace_headline', exactValue });
  }
  return {
    originalUserPrompt,
    originalRequest: request,
    requestedChanges,
    constraints: {
      allowedFiles: [...new Set(allowedFiles)],
      forbiddenFiles: [],
      allowNewFiles: !forbidCreates,
      allowDependencyInstall: !forbidInstall,
      allowCommands: !forbidCommands,
      requiredValidationCommands: requestedCommands,
      requestedFramework: /react/i.test(request) ? 'react' : /vue/i.test(request) ? 'vue' : /svelte/i.test(request) ? 'svelte' : null,
      requestedLanguage: /typescript|\btsx?\b/i.test(request) ? 'typescript' : /javascript|\bjsx?\b/i.test(request) ? 'javascript' : null,
    },
  };
}

function extractExplicitPaths(request: string): string[] {
  const candidates = request.match(/(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+|\b[A-Za-z0-9_-]+\.(?:tsx?|jsx?|css|scss|json|html|md)\b/g) ?? [];
  return candidates.filter((candidate) => !/^(?:npm|pnpm|yarn|bun)\b/i.test(candidate));
}

function extractExactValue(promptInput: string | OriginalUserPrompt): string | null {
  const prompt = typeof promptInput === 'string' ? promptInput : promptInput.raw;
  const marker = /(?:to|as|como)\s*:/im.exec(prompt);
  if (!marker || marker.index === undefined) return null;
  const tail = prompt.slice(marker.index + marker[0].length);
  const inline = tail.match(/^[ \t]*(["'])([\s\S]*?)\1/);
  if (inline?.[2]?.trim()) return inline[2];
  const lines = tail.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim().length > 0);
  if (first < 0) return null;
  if (lines[first].trim().startsWith('```')) {
    const end = lines.findIndex((line, index) => index > first && line.trim().startsWith('```'));
    if (end > first + 1) return lines.slice(first + 1, end).join('\n');
  }
  return lines[first].trim();
}

function canonicalExistingPath(candidate: string, root: string): string {
  const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '');
  const direct = path.resolve(root, normalized);
  if (fs.existsSync(direct)) return path.relative(root, direct).replace(/\\/g, '/');
  const basename = path.basename(normalized).toLowerCase();
  const matches: string[] = [];
  const visit = (directory: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.toLowerCase() === basename) matches.push(target);
    }
  };
  visit(root);
  return matches.length === 1 ? path.relative(root, matches[0]).replace(/\\/g, '/') : normalized;
}

function extractCommands(request: string): string[] {
  const matches = request.match(/\b(?:npm|pnpm|yarn|bun)\s+run\s+[A-Za-z0-9:_-]+/gi) ?? [];
  return [...new Set(matches.map((command) => command.trim()))];
}
