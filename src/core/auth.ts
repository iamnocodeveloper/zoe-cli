import { getSession, saveSession } from './config.js';
import { getAuthSessionStatus, loginWithGithub, type AuthErrorCode } from './insforge.js';

export interface AuthResult {
  success: boolean;
  user?: {
    name?: string;
    email?: string;
    projectId?: string;
  };
  error?: string;
  code?: AuthErrorCode;
}

export async function requireAuth(): Promise<AuthResult> {
  const session = getSession();
  const status = getAuthSessionStatus();
  if (status.authenticated) {
    return {
      success: true,
      user: {
        name: session.user,
        email: session.email,
        projectId: session.projectId,
      },
    };
  }

  if (status.code === 'MALFORMED_LOCAL_SESSION') {
    return { success: false, code: status.code, error: 'Local Zoe authentication data is invalid.' };
  }

  console.log('\n🔐  Setting up authentication...\n');

  try {
    const result = await loginWithGithub();

    saveSession({
      user: result.user.name || result.user.email,
      email: result.user.email,
      projectId: result.projectId,
    });

    return {
      success: true,
      user: {
        name: result.user.name,
        email: result.user.email,
        projectId: result.projectId,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function isAuthenticated(): Promise<boolean> {
  return getAuthSessionStatus().authenticated;
}

export function getAuthUser(): { name?: string; email?: string; projectId?: string } | null {
  if (!getAuthSessionStatus().authenticated) return null;
  const session = getSession();
  if (!session.user || !session.email) {
    return null;
  }
  return {
    name: session.user,
    email: session.email,
    projectId: session.projectId,
  };
}
