/**
 * Single source of truth for the Zoe Cloud backend.
 *
 * Resolution order:
 *   1. ZOE_CLOUD_URL environment variable (for development / build-time override)
 *   2. Built-in default (production)
 *
 * IMPORTANT: Do NOT change the default to point at any other service.
 * The auth flow is hardcoded for this domain's OAuth provider.
 */

const ZOE_CLOUD_DEFAULT = 'https://2ydpqd44.us-east.insforge.app';

export interface ZoeCloudConfig {
  baseUrl: string;
}

export function getZoeCloudConfig(): ZoeCloudConfig {
  const envUrl = process.env.ZOE_CLOUD_URL?.trim();
  return {
    baseUrl: envUrl && envUrl.length > 0 ? envUrl : ZOE_CLOUD_DEFAULT,
  };
}

export const ZOE_STATUS_PAGE = 'https://getzoe.cloud/status';

export function getZoeCloudUnreachableError(): Error {
  return new Error(
    'Unable to connect to Zoe Cloud.\n' +
    `Please check your internet connection or visit:\n${ZOE_STATUS_PAGE}`
  );
}
