import type { AuthSessionStatus } from './insforge.js';

export type OAuthAttemptResult = 'COMPLETED' | 'CANCELLED' | 'FAILED';
export type ModelAuthGateResult = 'AUTHENTICATED' | 'AUTH_REQUIRED' | 'SESSION_EXPIRED' | 'OAUTH_CANCELLED' | 'RESUBMIT_REQUIRED';

export interface ModelAuthGateDependencies {
  status(): AuthSessionStatus;
  startOAuth(): Promise<OAuthAttemptResult>;
}

export function createModelAuthGate(deps: ModelAuthGateDependencies) {
  let oauthInFlight: Promise<OAuthAttemptResult> | null = null;
  const oauthOnce = async (): Promise<OAuthAttemptResult> => {
    if (!oauthInFlight) oauthInFlight = deps.startOAuth().finally(() => { oauthInFlight = null; });
    return oauthInFlight;
  };

  return {
    async authorize(hasOriginalPrompt: boolean): Promise<ModelAuthGateResult> {
      const initial = deps.status();
      if (initial.authenticated) {
        if (initial.tokenNearExpiry && !initial.refreshTokenAvailable) return 'SESSION_EXPIRED';
        return 'AUTHENTICATED';
      }
      const oauth = await oauthOnce();
      if (oauth === 'CANCELLED') return 'OAUTH_CANCELLED';
      if (oauth !== 'COMPLETED' || !deps.status().authenticated) return 'AUTH_REQUIRED';
      return hasOriginalPrompt ? 'RESUBMIT_REQUIRED' : 'AUTHENTICATED';
    },
  };
}

export async function runAuthenticatedModelRequest<T>(
  prompt: string,
  gate: ReturnType<typeof createModelAuthGate>,
  createTask: (prompt: string) => Promise<T>,
): Promise<{ auth: ModelAuthGateResult; task?: T; preservedPrompt?: string }> {
  const auth = await gate.authorize(Boolean(prompt));
  if (auth !== 'AUTHENTICATED') return { auth, preservedPrompt: prompt };
  return { auth, task: await createTask(prompt) };
}
