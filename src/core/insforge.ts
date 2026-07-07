import { createClient } from '@insforge/sdk';
import { getZoeCloudConfig, getZoeCloudUnreachableError, ZOE_STATUS_PAGE } from './cloud.js';
import { getSession } from './config.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

export interface InsForgeConfig {
  baseUrl: string;
  projectId: string;
}

const AUTH_HOME = () => join(homedir(), '.zoe', 'auth.json');

let insforgeClient: any = null;

export function getInsForgeClient(): any {
  if (insforgeClient) return insforgeClient;
  const config = getZoeCloudConfig();
  insforgeClient = createClient({
    baseUrl: config.baseUrl,
    anonKey: '',
  });
  restoreAuthSession(insforgeClient);
  return insforgeClient;
}

function persistAuthSession(client: any): void {
  try {
    const tokenManager = client.tokenManager || client.getHttpClient?.()?.tokenManager;
    if (!tokenManager) return;
    const session = tokenManager.getSession?.();
    const accessToken = tokenManager.getAccessToken?.();
    const http = client.http || client.getHttpClient?.();
    const refreshToken = http?.refreshToken
      || tokenManager.refreshToken
      || session?.refreshToken
      || null;
    if (session || accessToken) {
      const enrichedSession = session
        ? { ...session, refreshToken: refreshToken || session.refreshToken }
        : session;
      const dir = dirname(AUTH_HOME());
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
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
    if (!existsSync(authPath)) return;
    const saved = JSON.parse(readFileSync(authPath, 'utf-8'));
    if (!saved) return;
    const token = saved.accessToken || saved.session?.accessToken;
    const refreshToken = saved.refreshToken || saved.session?.refreshToken;
    if (!token) return;

    if (typeof client.setAccessToken === 'function') {
      client.setAccessToken(token);
    } else {
      const http = client.http || client.getHttpClient?.();
      if (http?.setAuthToken) http.setAuthToken(token);
      if (client.tokenManager?.setAccessToken) client.tokenManager.setAccessToken(token);
    }

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
    if (existsSync(authPath)) unlinkSync(authPath);
  } catch {
    // ignore
  }
}

export async function loginWithGithub() {
  const config = getZoeCloudConfig();
  const baseUrl = config.baseUrl;

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
        || 'Unable to connect to Zoe Cloud.\n' +
           `Please check your internet connection or visit:\n${ZOE_STATUS_PAGE}`
      );
    }
    const authUrl = oauthResp.data.url;
    const codeVerifier = oauthResp.data.codeVerifier;

    const { default: open } = await import('open');
    await open(authUrl);

    console.log(`  ${chalk.gray('⏳')}  Waiting for authentication...`);

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

  insforgeClient = null;

  return {
    user: {
      email: user.email,
      name: (user?.profile as any)?.name || user.email,
    },
    projectId: '',
    token: 'zoe-cloud',
    apiKey: '',
  };
}

let cachedOpenRouterKey: string | null = null;

export async function getOpenRouterKeyFromSecrets(): Promise<string> {
  if (cachedOpenRouterKey) return cachedOpenRouterKey;

  const config = getZoeCloudConfig();
  const baseUrl = config.baseUrl;

  const sessionApiKey = getSession().apiKey || getSession().token || '';
  if (!sessionApiKey || sessionApiKey === 'insforge-token') {
    throw getZoeCloudUnreachableError();
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

  throw getZoeCloudUnreachableError();
}

export async function getCurrentUser() {
  try {
    const client = getInsForgeClient();
    const resp = await client.auth.getCurrentUser();
    return resp.data?.user || null;
  } catch {
    return null;
  }
}

export async function logout() {
  try {
    const client = getInsForgeClient();
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
