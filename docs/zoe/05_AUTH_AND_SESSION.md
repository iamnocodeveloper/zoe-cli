# Zoe CLI — Authentication and Session

Current v1 login is InsForge GitHub OAuth through a browser callback in `loginWithGithub()` (`src/core/insforge.ts`). Access and refresh tokens are persisted in `~/.zoe/auth.json`; profile metadata is also saved through `config.ts` in `~/.zoe/config.json`.

`createAuthenticatedRequestHelper()` applies stored credentials, refreshes tokens within a 60-second skew, serializes concurrent refreshes, retries a 401 once, and emits `ZOE_SESSION_EXPIRED_MESSAGE` after failed refresh. Unit coverage covers valid, near-expiry, expired, rejected, 401 and concurrent refresh paths.

Root-cause hypothesis: authentication validity is represented both by token material and legacy user/email metadata. `requireAuth()` can consider the latter sufficient while Cloud access later discovers expiry; multiple layers can render the same error.

## ZOE-002 evidenced findings

This is confirmed, not merely a hypothesis: config-only user/email is accepted by `requireAuth()` and chat startup; registered logout leaves config metadata because the clearing command implementation is not the registered command; and every refresh exception is converted to session expiration. SDK source inspection confirms the expected refresh response field names in v1.4.3, but production backend behavior remains unvalidated. `auth.json` persistence uses temp-file rename and retains rotated refresh tokens; `config.json` does not have equivalent atomic persistence. See `15_AUTH_AUDIT.md`.

## ZOE-003 implemented behavior

`auth.json` is the sole credential authority. `config.json` user/email remains compatibility display metadata and cannot prove authentication. `ZoeAuthError` distinguishes unauthenticated, session expired, refresh rejected, Cloud unavailable, timeout, malformed response, malformed local session and configuration errors. Refresh retains the 60-second JWT skew, single-flight execution, atomic writes, rotation and one 401 retry. Network/timeout/malformed responses preserve credentials; rejected refresh and final 401 clear credential plus legacy auth metadata. Logout is idempotent and clears local credentials/config even if Cloud revocation fails.

Device-code authentication: **Status: Deferred**. OS credential storage is also deferred; refresh tokens remain local plaintext JSON for this preview.

## Alpha release validation

The installed-package smoke test used an isolated Windows user profile. `zoe whoami` reported unauthenticated without leaking credentials, and the login entry/help resolved. Existing mock coverage validates expiry and refresh behavior. Live GitHub OAuth was not performed during packaging and remains an owner smoke test; npm authentication is separate and was unavailable.
