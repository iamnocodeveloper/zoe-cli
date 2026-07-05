import { getSession, saveSession } from './config.js';
import { loginWithGithub, getCurrentUser } from './insforge.js';

export interface AuthResult {
  success: boolean;
  user?: {
    name?: string;
    email?: string;
    projectId?: string;
  };
  error?: string;
}

export async function requireAuth(): Promise<AuthResult> {
  const session = getSession();
  if (session.user && session.email) {
    return {
      success: true,
      user: {
        name: session.user,
        email: session.email,
        projectId: session.projectId,
      },
    };
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
  const session = getSession();
  return !!(session.user && session.email);
}

export function getAuthUser(): { name?: string; email?: string; projectId?: string } | null {
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
