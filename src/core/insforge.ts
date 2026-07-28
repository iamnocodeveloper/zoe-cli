import { createClient } from '@insforge/sdk';
import { getZoeCloudConfig, getZoeCloudUnreachableError, ZOE_STATUS_PAGE } from './cloud.js';
import { clearSession } from './config.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

export interface InsForgeConfig {
  baseUrl: string;
  projectId: string;
}

const AUTH_HOME = () => join(homedir(), '.zoe', 'auth.json');
export const ZOE_SESSION_EXPIRED_MESSAGE = 'Zoe Cloud session expired.\nRun: zoe login';

export interface StoredAuthSession {
  accessToken: string;
  refreshToken?: string | null;
  session?: { accessToken?: string; refreshToken?: string; user?: unknown; [key: string]: unknown };
}

export interface AuthSessionStore {
  load(): StoredAuthSession | null;
  save(session: StoredAuthSession): void;
  clear?(): void;
}

export type AuthErrorCode = 'UNAUTHENTICATED' | 'SESSION_EXPIRED' | 'REFRESH_REJECTED' | 'CLOUD_UNAVAILABLE' | 'NETWORK_TIMEOUT' | 'MALFORMED_AUTH_RESPONSE' | 'MALFORMED_LOCAL_SESSION' | 'AUTH_CONFIGURATION_ERROR';

export class ZoeAuthError extends Error {
  constructor(public readonly code: AuthErrorCode) { super(code); this.name = 'ZoeAuthError'; }
}

export type AuthSessionStatus = {
  authenticated: boolean;
  code?: AuthErrorCode;
  tokenNearExpiry: boolean;
  refreshTokenAvailable: boolean;
};

function debugAuth(message: string): void {
  if (process.env.ZOE_DEBUG === 'true') console.error(`[zoe auth] ${message}`);
}

function loadStoredAuthSession(): StoredAuthSession | null {
  try {
    const authPath = AUTH_HOME();
    if (!existsSync(authPath)) return null;
    const saved = JSON.parse(readFileSync(authPath, 'utf-8')) as StoredAuthSession;
    const accessToken = saved?.accessToken || saved?.session?.accessToken;
    const refreshToken = saved?.refreshToken || saved?.session?.refreshToken;
    if (typeof accessToken !== 'string' || !accessToken) return null;
    return { ...saved, accessToken, refreshToken: typeof refreshToken === 'string' ? refreshToken : null };
  } catch {
    debugAuth('stored session is malformed');
    return null;
  }
}

function saveStoredAuthSession(session: StoredAuthSession): void {
  const dir = dirname(AUTH_HOME());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = AUTH_HOME();
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(session, null, 2), 'utf8');
    renameSync(temp, target);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

const diskAuthSessionStore: AuthSessionStore = {
  load: loadStoredAuthSession,
  save: saveStoredAuthSession,
  clear: clearAuthSession,
};

export function createAuthSessionStore(authPath: string): AuthSessionStore {
  return {
    load: () => {
      try {
        if (!existsSync(authPath)) return null;
        const saved = JSON.parse(readFileSync(authPath, 'utf8')) as StoredAuthSession;
        const accessToken = saved?.accessToken || saved?.session?.accessToken;
        const refreshToken = saved?.refreshToken || saved?.session?.refreshToken;
        return typeof accessToken === 'string' && accessToken
          ? { ...saved, accessToken, refreshToken: typeof refreshToken === 'string' ? refreshToken : null }
          : null;
      } catch { return null; }
    },
    save: (session) => {
      const dir = dirname(authPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const temp = `${authPath}.${process.pid}.${Date.now()}.tmp`;
      try { writeFileSync(temp, JSON.stringify(session, null, 2), 'utf8'); renameSync(temp, authPath); }
      finally { if (existsSync(temp)) unlinkSync(temp); }
    },
    clear: () => { try { if (existsSync(authPath)) unlinkSync(authPath); } catch { /* local cleanup is best effort */ } },
  };
}

function applyAuthSession(client: any, session: StoredAuthSession): void {
  if (typeof client.setAccessToken === 'function') client.setAccessToken(session.accessToken);
  const http = client.http || client.getHttpClient?.();
  if (http?.setAuthToken) http.setAuthToken(session.accessToken);
  if (client.tokenManager?.setAccessToken) client.tokenManager.setAccessToken(session.accessToken);
  if (session.refreshToken && http?.setRefreshToken) http.setRefreshToken(session.refreshToken);
  if (session.session?.user && client.tokenManager?.setUser) client.tokenManager.setUser(session.session.user);
}

function tokenExpiresSoon(accessToken: string, skewMs = 60_000): boolean {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return true;
    const parsed = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { exp?: unknown };
    return typeof parsed.exp !== 'number' || parsed.exp * 1000 <= Date.now() + skewMs;
  } catch {
    return true;
  }
}

function structurallyValid(session: StoredAuthSession | null): session is StoredAuthSession {
  return Boolean(session && typeof session.accessToken === 'string' && session.accessToken.length > 0);
}

function classifyAuthFailure(error: unknown): ZoeAuthError {
  if (error instanceof ZoeAuthError) return error;
  const value = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/timeout|timed out|ETIMEDOUT/i.test(value)) return new ZoeAuthError('NETWORK_TIMEOUT');
  return new ZoeAuthError('CLOUD_UNAVAILABLE');
}

export function isZoeAuthError(error: unknown): error is ZoeAuthError { return error instanceof ZoeAuthError; }

export function getAuthSessionStatus(store: AuthSessionStore = diskAuthSessionStore, authFileExists = existsSync(AUTH_HOME())): AuthSessionStatus {
  const session = store.load();
  if (!session) return { authenticated: false, code: authFileExists ? 'MALFORMED_LOCAL_SESSION' : 'UNAUTHENTICATED', tokenNearExpiry: false, refreshTokenAvailable: false };
  if (!structurallyValid(session)) return { authenticated: false, code: 'MALFORMED_LOCAL_SESSION', tokenNearExpiry: false, refreshTokenAvailable: false };
  return { authenticated: true, tokenNearExpiry: tokenExpiresSoon(session.accessToken), refreshTokenAvailable: Boolean(session.refreshToken) };
}

export function getAuthErrorMessage(error: unknown): { reason: string; suggestion: string } | null {
  if (!isZoeAuthError(error)) return null;
  switch (error.code) {
    case 'UNAUTHENTICATED': return { reason: 'Authentication required.', suggestion: 'Run: zoe login' };
    case 'SESSION_EXPIRED': case 'REFRESH_REJECTED': return { reason: 'Your Zoe Cloud session has expired.', suggestion: 'Run: zoe login' };
    case 'CLOUD_UNAVAILABLE': return { reason: 'Zoe Cloud is temporarily unavailable.', suggestion: 'Your local session was preserved. Try again.' };
    case 'NETWORK_TIMEOUT': return { reason: 'The Zoe Cloud request timed out.', suggestion: 'Your local session was preserved. Try again.' };
    case 'MALFORMED_AUTH_RESPONSE': return { reason: 'Zoe Cloud returned an invalid authentication response.', suggestion: 'Your local credentials were not overwritten.' };
    case 'MALFORMED_LOCAL_SESSION': return { reason: 'Local Zoe authentication data is invalid.', suggestion: 'Run: zoe login' };
    default: return { reason: 'Zoe Cloud authentication is misconfigured.', suggestion: 'Run: zoe doctor' };
  }
}

export function isZoeCloudUnauthorized(error: unknown): boolean {
  const value = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /AUTH_UNAUTHORIZED|\bunauthori[sz]ed\b|\b401\b/i.test(value);
}

export function isZoeCloudSessionExpiredError(error: unknown): boolean {
  return (error instanceof ZoeAuthError && (error.code === 'SESSION_EXPIRED' || error.code === 'REFRESH_REJECTED')) || (error instanceof Error && error.message === ZOE_SESSION_EXPIRED_MESSAGE);
}

export function createAuthenticatedRequestHelper(
  getClient: () => any,
  store: AuthSessionStore = diskAuthSessionStore,
  onSessionInvalid: () => void = () => {},
): <T>(request: (client: any) => Promise<T>) => Promise<T> {
  let refreshInFlight: Promise<void> | null = null;

  const refresh = async (client: any): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const current = store.load();
      if (!current?.refreshToken) {
        store.clear?.();
        onSessionInvalid();
        throw new ZoeAuthError('SESSION_EXPIRED');
      }
      try {
        const response = await client.auth.refreshSession({ refreshToken: current.refreshToken });
        const refreshed = response?.data;
        if (response?.error) {
          store.clear?.();
          onSessionInvalid();
          throw new ZoeAuthError('REFRESH_REJECTED');
        }
        if (!refreshed?.accessToken) throw new ZoeAuthError('MALFORMED_AUTH_RESPONSE');
        const session: StoredAuthSession = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || current.refreshToken,
          session: { ...(current.session || {}), ...refreshed, refreshToken: refreshed.refreshToken || current.refreshToken },
        };
        store.save(session);
        applyAuthSession(client, session);
        debugAuth('session refreshed');
      } catch (error) {
        const typed = classifyAuthFailure(error);
        debugAuth(`session refresh failed: ${typed.code}`);
        throw typed;
      }
    })();
    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  };

  return async <T>(request: (client: any) => Promise<T>): Promise<T> => {
    const client = getClient();
    const session = store.load();
    if (!session) throw new ZoeAuthError('UNAUTHENTICATED');
    if (!structurallyValid(session)) throw new ZoeAuthError('MALFORMED_LOCAL_SESSION');
    applyAuthSession(client, session);
    if (tokenExpiresSoon(session.accessToken)) await refresh(client);
    try {
      return await request(client);
    } catch (error) {
      if (!isZoeCloudUnauthorized(error)) throw error;
      await refresh(client);
      try {
        return await request(client);
      } catch (retryError) {
        if (isZoeCloudUnauthorized(retryError)) {
          store.clear?.();
          onSessionInvalid();
          throw new ZoeAuthError('SESSION_EXPIRED');
        }
        throw retryError;
      }
    }
  };
}

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

const authenticatedZoeCloudRequest = createAuthenticatedRequestHelper(() => getInsForgeClient(), diskAuthSessionStore, clearSession);

export function withAuthenticatedZoeCloudRequest<T>(request: (client: any) => Promise<T>): Promise<T> {
  return authenticatedZoeCloudRequest(request);
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
      diskAuthSessionStore.save({ session: enrichedSession, accessToken, refreshToken });
    }
  } catch {
    // ignore
  }
}

function restoreAuthSession(client: any): void {
  const saved = diskAuthSessionStore.load();
  if (saved) applyAuthSession(client, saved);
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

export async function getOpenRouterKeyFromSecrets(): Promise<string> {
  throw new Error('Direct OpenRouter access is disabled. Models are available through Zoe Cloud.');
}

/*
 * Model credentials intentionally never leave Zoe Cloud. The CLI does not
 * expose a direct OpenRouter provider or ask users for provider API keys.
 */
/* export async function getOpenRouterKeyFromSecrets(): Promise<string> {
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
} */

export async function getCurrentUser() {
  try {
    const resp: any = await withAuthenticatedZoeCloudRequest((client) => client.auth.getCurrentUser());
    return resp.data?.user || null;
  } catch {
    return null;
  }
}

export type LogoutResult = { cloudRevocationFailed: boolean };

export async function logoutWithServices(options: {
  getClient: () => any;
  store: AuthSessionStore;
  clearLegacy: () => void;
  clearInMemory?: () => void;
}): Promise<LogoutResult> {
  let cloudRevocationFailed = false;
  try {
    const client = options.getClient();
    if (typeof client.auth.signOut === 'function') {
      const result = await client.auth.signOut();
      if (result?.error) cloudRevocationFailed = true;
    }
    if (typeof client.auth.clearCredentials === 'function') await client.auth.clearCredentials();
  } catch {
    cloudRevocationFailed = true;
  } finally {
    options.store.clear?.();
    options.clearLegacy();
    options.clearInMemory?.();
  }
  return { cloudRevocationFailed };
}

export async function logout(): Promise<LogoutResult> {
  return logoutWithServices({
    getClient: getInsForgeClient,
    store: diskAuthSessionStore,
    clearLegacy: clearSession,
    clearInMemory: () => { insforgeClient = null; },
  });
}

export interface ZoeModel {
  model_id: string;
  display_name: string;
  provider: string;
  description: string;
  tier: 'free' | 'pro' | 'team';
}

export async function getModelCatalog(): Promise<ZoeModel[]> {
  try {
    const result: any = await withAuthenticatedZoeCloudRequest((client) => client.database
      .from('zoe_models')
      .select('model_id, display_name, provider, description, tier')
      .eq('enabled', true)
      .order('sort_order', { ascending: true }));

    if (result.error) throw new Error(result.error.message);
    const models = (result.data || []) as ZoeModel[];

    return models.length > 0 ? models : fallbackModelCatalog();
  } catch {
    // Keep the CLI usable during a temporary cloud/catalog outage.
    return fallbackModelCatalog();
  }
}

export async function getAvailableModels(): Promise<string[]> {
  const catalog = await getModelCatalog();
  return catalog.map((model) => model.model_id);
}

function fallbackModels(): string[] {
  return fallbackModelCatalog().map((model) => model.model_id);
}

function fallbackModelCatalog(): ZoeModel[] {
  return [
    { model_id: 'deepseek/deepseek-v4-flash', display_name: 'DeepSeek Flash', provider: 'DeepSeek', description: 'Rápido y económico para tareas diarias.', tier: 'free' },
    { model_id: 'deepseek/deepseek-v4-pro', display_name: 'DeepSeek Pro', provider: 'DeepSeek', description: 'Mayor calidad para tareas complejas.', tier: 'pro' },
    { model_id: 'anthropic/claude-sonnet-4-5', display_name: 'Claude Sonnet', provider: 'Anthropic', description: 'Excelente para razonamiento y código.', tier: 'pro' },
    { model_id: 'openai/gpt-4o', display_name: 'GPT-4o', provider: 'OpenAI', description: 'Modelo general de alta capacidad.', tier: 'pro' },
    { model_id: 'openai/gpt-4o-mini', display_name: 'GPT-4o Mini', provider: 'OpenAI', description: 'Rápido para tareas pequeñas.', tier: 'free' },
    { model_id: 'google/gemini-2.0-flash', display_name: 'Gemini Flash', provider: 'Google', description: 'Rápido y eficiente para contexto amplio.', tier: 'free' },
    { model_id: 'qwen/qwen-2.5-coder-32b-instruct', display_name: 'Qwen Coder', provider: 'Qwen', description: 'Especializado en programación.', tier: 'free' },
    { model_id: 'tencent/hy3:free', display_name: 'Tencent HY3', provider: 'Tencent', description: 'Modelo gratuito de Tencent.', tier: 'free' },
    { model_id: 'nvidia/nemotron-3-ultra-550b-a55b:free', display_name: 'NVIDIA Nemotron 3 Ultra', provider: 'NVIDIA', description: 'Modelo gratuito de NVIDIA.', tier: 'free' },
    { model_id: 'poolside/laguna-m.1:free', display_name: 'Poolside Laguna M.1', provider: 'Poolside', description: 'Modelo gratuito para programación.', tier: 'free' },
    { model_id: 'google/gemma-4-31b-it:free', display_name: 'Gemma 4 31B IT', provider: 'Google', description: 'Modelo gratuito de Google.', tier: 'free' },
    { model_id: 'qwen/qwen3-next-80b-a3b-instruct:free', display_name: 'Qwen3 Next 80B', provider: 'Qwen', description: 'Modelo gratuito para instrucciones y código.', tier: 'free' },
  ];
/* return [
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
    'tencent/hy3:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'poolside/laguna-m.1:free',
    'google/gemma-4-31b-it:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
  ]; */
}
