import fs from 'fs';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { createClient } from '@insforge/sdk';

export interface InsForgeConfig {
  baseUrl: string;
  projectId: string;
}

function readConfigFile(configPath: string): InsForgeConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      baseUrl: raw.oss_host || raw.baseUrl || raw.apiUrl || 'https://api.insforge.dev',
      projectId: raw.project_id || raw.projectId || raw.PROJECT_ID || '',
    };
  } catch {
    return null;
  }
}

const CONFIG_HOME = () => path.join(os.homedir(), '.insforge', 'project.json');
const AUTH_HOME = () => path.join(os.homedir(), '.insforge', 'auth.json');

function findInsForgeConfig(): InsForgeConfig | null {
  const homeConfig = CONFIG_HOME();
  if (fs.existsSync(homeConfig)) {
    const config = readConfigFile(homeConfig);
    if (config) return config;
  }

  let currentDir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const configPath = path.join(currentDir, '.insforge', 'project.json');
    if (fs.existsSync(configPath)) {
      const config = readConfigFile(configPath);
      if (config) return config;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
  return null;
}

async function ensureProjectConfig(): Promise<InsForgeConfig> {
  const existing = findInsForgeConfig();
  if (existing) return existing;
  throw new Error('Not authenticated. Run: zoe login');
}

let insforgeClient: any = null;

export async function getInsForgeClient(): Promise<any> {
  if (insforgeClient) return insforgeClient;

  // Try CLI first, then cached project.json
  const resolved = await resolveBackendUrl();
  insforgeClient = createClient({
    baseUrl: resolved.baseUrl,
    anonKey: '',
  });

  // Restore persisted auth session
  restoreAuthSession(insforgeClient);

  return insforgeClient;
}

function persistAuthSession(client: any): void {
  try {
    const tokenManager = client.tokenManager || client.getHttpClient?.()?.tokenManager;
    if (!tokenManager) return;
    const session = tokenManager.getSession?.();
    const accessToken = tokenManager.getAccessToken?.();
    // Try to get refreshToken from http client or tokenManager
    const http = client.http || client.getHttpClient?.();
    const refreshToken = http?.refreshToken
      || tokenManager.refreshToken
      || session?.refreshToken
      || null;
    if (session || accessToken) {
      const enrichedSession = session
        ? { ...session, refreshToken: refreshToken || session.refreshToken }
        : session;
      const dir = path.dirname(AUTH_HOME());
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        AUTH_HOME(),
        JSON.stringify({ session: enrichedSession, accessToken, refreshToken }, null, 2)
      );
    }
  } catch {
    // ignore
  }
}

function restoreAuthSession(client: any): void {
  try {
    const authPath = AUTH_HOME();
    if (!fs.existsSync(authPath)) return;
    const saved = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    if (!saved) return;
    const token = saved.accessToken || saved.session?.accessToken;
    const refreshToken = saved.refreshToken || saved.session?.refreshToken;
    if (!token) return;

    // Use client.setAccessToken if available — it updates both HTTP client
    // and tokenManager. Falls back to manual sync.
    if (typeof client.setAccessToken === 'function') {
      client.setAccessToken(token);
    } else {
      const http = client.http || client.getHttpClient?.();
      if (http?.setAuthToken) http.setAuthToken(token);
      if (client.tokenManager?.setAccessToken) client.tokenManager.setAccessToken(token);
    }

    // Restore refresh token so SDK can auto-refresh on 401
    const http = client.http || client.getHttpClient?.();
    if (refreshToken && http?.setRefreshToken) {
      http.setRefreshToken(refreshToken);
    }

    if (saved.session?.user && client.tokenManager?.setUser) {
      client.tokenManager.setUser(saved.session.user);
    }
  } catch {
    // ignore
  }
}

function clearAuthSession(): void {
  try {
    const authPath = AUTH_HOME();
    if (fs.existsSync(authPath)) fs.unlinkSync(authPath);
  } catch {
    // ignore
  }
}

export async function loginWithGithub() {
  const resolved = await resolveBackendUrl();
  const baseUrl = resolved.baseUrl;

  const client = createClient({
    baseUrl,
    anonKey: '',
  });

  const userResp = await client.auth.getCurrentUser();
  let user = userResp.data?.user;

  if (!user) {
    console.log(`  ${chalk.cyan('📂')}  Opening browser for GitHub login...`);

    const oauthResp = await client.auth.signInWithOAuth('github', {
      redirectTo: 'http://localhost:3456/callback',
    });
    if (oauthResp.error || !oauthResp.data?.url) {
      throw new Error(
        oauthResp.error?.message
        || `Could not reach OAuth endpoint at ${baseUrl}. ` +
           `Check your project URL in ~/.insforge/project.json. ` +
           `Run: npx @insforge/cli current --json to see the correct URL.`
      );
    }
    const authUrl = oauthResp.data.url;
    const codeVerifier = oauthResp.data.codeVerifier;

    const { default: open } = await import('open');
    await open(authUrl);

    console.log(`  ${chalk.gray('⏳')}  Waiting for authentication...`);

    // InsForge redirects with `?insforge_code=...` (not `code`)
    const code = await new Promise<string>(async (resolve, reject) => {
      const http = await import('http');
      const server = http.default.createServer((req: any, res: any) => {
        const url = new URL(req.url!, 'http://localhost:3456');
        const authCode = url.searchParams.get('insforge_code')
          || url.searchParams.get('code');
        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Login Successful - Zoe CLI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1f2937;
    }
    .card {
      background: white; padding: 48px; border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center; max-width: 420px;
      animation: fadeIn 0.4s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .check {
      width: 72px; height: 72px; margin: 0 auto 28px;
      background: #10b981; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      animation: scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes scaleIn { from { transform: scale(0); } to { transform: scale(1); } }
    .check svg { width: 36px; height: 36px; stroke: white; fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
    p { color: #6b7280; font-size: 15px; margin-bottom: 28px; line-height: 1.5; }
    .close-btn {
      display: inline-block; padding: 12px 28px;
      background: #6366f1; color: white;
      border-radius: 8px; text-decoration: none;
      font-weight: 500; font-size: 14px;
      transition: background 0.2s;
      cursor: pointer; border: none;
    }
    .close-btn:hover { background: #4f46e5; }
    .subtitle { font-size: 13px; color: #9ca3af; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>Login Successful</h1>
    <p>You can now close this window and return to your terminal.</p>
    <button class="close-btn" onclick="window.close()">Close Window</button>
    <div class="subtitle">Zoe CLI</div>
  </div>
</body>
</html>`);
          server.close();
          resolve(authCode);
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><h2>Missing code</h2><p>Authentication callback did not include an authorization code. Please return to your terminal and try again.</p></body></html>');
        }
      });
      server.listen(3456, () => {
        console.log(`  ${chalk.gray('🔗')}  Listening on http://localhost:3456`);
      });
      server.on('error', reject);
      setTimeout(() => { server.close(); reject(new Error('Authentication timeout')); }, 120000);
    });

    console.log(`  ${chalk.cyan('🔄')}  Exchanging code for session...`);
    await client.auth.exchangeOAuthCode(code, codeVerifier);

    const finalUserResp = await client.auth.getCurrentUser();
    user = finalUserResp.data?.user;
  }

  if (!user?.email) {
    throw new Error('Authentication failed — no user returned after OAuth');
  }

  // Persist auth session to disk so it survives process restarts
  persistAuthSession(client);

  // Save/update project config with the resolved baseUrl
  const configFile = CONFIG_HOME();
  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let existing: any = {};
  if (fs.existsSync(configFile)) {
    try { existing = JSON.parse(fs.readFileSync(configFile, 'utf-8')); } catch {}
  }

  const projectConfig = {
    oss_host: baseUrl,
    project_id: existing.project_id || resolved.projectId || (user?.metadata as any)?.project_id || '',
  };
  fs.writeFileSync(configFile, JSON.stringify(projectConfig, null, 2));

  insforgeClient = null;

  let apiKey: string | null = null;
  try {
    apiKey = await fetchProjectApiKey(client, baseUrl);
  } catch {
    // Non-fatal — Gateway path may still work
  }

  return {
    user: {
      email: user.email,
      name: (user?.profile as any)?.name || user.email,
    },
    projectId: projectConfig.project_id,
    token: apiKey || 'insforge-token',
    apiKey: apiKey || '',
  };
}

async function resolveBackendUrl(): Promise<{ baseUrl: string; projectId: string; source: 'config' | 'cli' | 'default' }> {
  // 1. Local config — fastest, no CLI dependency, user-controlled
  const local = findInsForgeConfig();
  if (local?.baseUrl && local.baseUrl !== 'https://api.insforge.dev') {
    return {
      baseUrl: local.baseUrl,
      projectId: local.projectId || '',
      source: 'config',
    };
  }

  // 2. InsForge CLI as fallback — only if local config is missing/stale
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const { stdout } = await execAsync('npx --yes @insforge/cli current --json', {
      timeout: 45000,
      windowsHide: true,
    });
    const info = JSON.parse(stdout);
    if (info?.project?.oss_host && typeof info.project.oss_host === 'string') {
      return {
        baseUrl: info.project.oss_host,
        projectId: info.project.project_id || '',
        source: 'cli',
      };
    }
  } catch {
    // CLI not available or not authenticated — fall through
  }

  // 3. Last resort default
  return {
    baseUrl: local?.baseUrl || 'https://api.insforge.dev',
    projectId: local?.projectId || '',
    source: 'default',
  };
}

async function fetchProjectApiKey(client: any, baseUrl: string): Promise<string | null> {
  const endpoints = [
    '/api/projects/current',
    '/api/v1/projects/current',
    '/api/cli/project',
    '/api/projects/me',
    '/api/v1/cli/project',
  ];

  for (const path of endpoints) {
    try {
      const response = await client.ai.http.get(path);
      const apiKey = (response as any)?.api_key
        || (response as any)?.apiKey
        || (response as any)?.data?.api_key
        || (response as any)?.data?.apiKey;
      if (apiKey && typeof apiKey === 'string' && apiKey.length > 20) {
        return apiKey;
      }
    } catch {
      continue;
    }
  }
  return null;
}

let cachedOpenRouterKey: string | null = null;

export async function getOpenRouterKeyFromSecrets(): Promise<string> {
  if (cachedOpenRouterKey) return cachedOpenRouterKey;

  const config = findInsForgeConfig();
  const baseUrl = config?.baseUrl || 'https://api.insforge.dev';

  const { getSession } = await import('./config.js');
  const sessionApiKey = getSession().apiKey || (getSession().token !== 'insforge-token' ? getSession().token : '');

  if (!sessionApiKey) {
    throw new Error('Could not connect to AI provider');
  }

  const secretNames = ['OPENROUTER_API_KEY', 'OPENROUTER_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY'];

  for (const keyName of secretNames) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`${baseUrl}/api/secrets/${encodeURIComponent(keyName)}`, {
        headers: { Authorization: `Bearer ${sessionApiKey}` },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) continue;

      const data = await res.json() as { key: string; value: string };
      if (data?.value) {
        cachedOpenRouterKey = data.value;
        return data.value;
      }
    } catch {
      continue;
    }
  }

  throw new Error('Could not connect to AI provider');
}

export async function getCurrentUser() {
  try {
    const client = await getInsForgeClient();
    const resp = await client.auth.getCurrentUser();
    return resp.data?.user || null;
  } catch {
    return null;
  }
}

export async function logout() {
  try {
    const client = await getInsForgeClient();
    await client.auth.clearCredentials();
    clearAuthSession();
    insforgeClient = null;
  } catch {
    // ignore
  }
}

export async function getAvailableModels(): Promise<string[]> {
  return fallbackModels();
}

function fallbackModels(): string[] {
  return [
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-v4-pro',
    'anthropic/claude-sonnet-4-5',
    'anthropic/claude-3-5-sonnet',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.0-flash',
    'google/gemini-2.0-pro',
    'mistralai/mistral-large',
    'meta-llama/llama-3-70b-instruct',
  ];
}
