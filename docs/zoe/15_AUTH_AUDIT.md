# Zoe CLI — ZOE-002 Authentication Root-Cause Audit

Audit date: 2026-07-25. Scope: investigation, deterministic tests and documentation only. No production authentication behavior was changed.

## CURRENT BEHAVIOR

### Data model and authority

| Location | Written data | Readers / authority |
|---|---|---|
| `~/.zoe/auth.json` | Top-level `accessToken`, optional `refreshToken`, optional `session` containing SDK session fields/user | `loadStoredAuthSession()` is authoritative for authenticated Cloud requests, refresh and SDK restoration |
| `~/.zoe/config.json` | `session.user`, `email`, `projectId`, placeholder `token: "zoe-cloud"`, optional `apiKey`, `lastLogin`; plus model/display settings | `requireAuth()`, `isAuthenticated()`, `getAuthUser()`, chat startup, `whoami`, legacy login/logout |
| In-memory InsForge client | Access token, possible refresh token and SDK user/session | `getInsForgeClient()` singleton; cleared on successful core logout |

The local audit environment had neither file, so no credential values were read or printed. `auth.json` writes are temp-file then rename (atomic replacement); `config.json` writes directly and is not atomic.

### Login sequence

`loginWithGithub()` creates an SDK client, calls `getCurrentUser()`, then starts GitHub PKCE OAuth with `redirectTo: http://localhost:3456/callback`. The callback obtains `insforge_code`, invokes `exchangeOAuthCode(code, codeVerifier)`, calls `getCurrentUser()`, then `persistAuthSession()` extracts token-manager/session values into `auth.json`. It returns a placeholder legacy token (`zoe-cloud`), and both `login.ts` and `requireAuth()` write user/email metadata to `config.json`.

### Authenticated-request and refresh sequence

`withAuthenticatedZoeCloudRequest()` wraps the Cloud AI stream in `agent.ts`, `getCurrentUser()`, and model catalog database reads. It loads `auth.json`, applies tokens to the SDK, parses JWT payload `exp` and treats expiry within 60 seconds as refresh-needed. Expiry is JWT absolute `exp * 1000`; there is no `expiresIn`, SDK timestamp or server metadata fallback. A malformed/non-JWT access token is treated as expiring.

The installed `@insforge/sdk` v1.4.3 contract returns `{ data: RefreshSessionResponse | null, error }`; in server mode it sends the supplied refresh token as `{ refresh_token }` to `/api/auth/refresh?client_type=mobile` and accepts camel-case response fields such as `accessToken` and optional `refreshToken`. Zoe's helper expects that camel-case response shape, retains the old refresh token if rotation is omitted, and writes the complete new record atomically.

`refreshInFlight` serializes refreshes for every call that passes through the one module-level `authenticatedZoeCloudRequest` helper. It does not cover SDK-internal refreshes or any future direct Cloud client use. The first recognized 401 triggers refresh and one retry; a recognized 401 after retry becomes `ZOE_SESSION_EXPIRED_MESSAGE`.

### Logout sequence

`src/cli/commands/logout.ts` calls core `insforge.logout()`, which asks the SDK to clear credentials, deletes `auth.json`, and nulls the singleton. This command does **not** clear `config.json`; it prints success even if its core cleanup catches an error. A separate legacy `logout()` exported by `src/cli/commands/login.ts` does call `clearSession()`, but it is not registered by `src/cli/index.ts`. Therefore the shipped `zoe logout` leaves user/email and legacy token metadata in config.

## CONFIRMED DEFECTS

### CLI_STATE_BUG — stale false-positive authentication

- Evidence: `requireAuth()` and `isAuthenticated()` return authenticated when only `config.session.user` and `email` exist; chat startup checks only `session.user`. They never require usable `auth.json` token material.
- Reproduction: preserve config user/email, remove or corrupt `~/.zoe/auth.json`, then invoke chat or a command guarded by `requireAuth()`.
- Impact: Zoe presents a signed-in user and begins a task, only to fail at the first Cloud call.
- Confidence: High.
- Recommended fix: ZOE-003 makes token/session validity authoritative and migrates legacy profile metadata to non-auth display data.

### CLI_LOGOUT_BUG / LEGACY_MIGRATION_BUG — registered logout leaves stale config

- Evidence: `index.ts` imports logout from `commands/login.ts`, while `commands/logout.ts` is unregistered. The registered legacy function clears `auth.json` through core logout then `config.json`; the unregistered standalone command is the one that only calls core logout. This split API is confusing and allows stale metadata depending on import/use path.
- Reproduction: execute registered `zoe logout`; inspect config key presence without printing values.
- Impact: restart retains a false-positive logged-in state.
- Confidence: High.
- Recommended fix: ZOE-003 owns one logout path and atomically clears/migrates every local representation after successful local cleanup.

### CLI_REFRESH_BUG — network and malformed refresh are reported as expired sessions

- Evidence: `createAuthenticatedRequestHelper()` catches every refresh exception, including timeout/network errors and malformed responses, then throws `ZOE_SESSION_EXPIRED_MESSAGE`. New deterministic tests prove both cases.
- Reproduction: expired JWT with valid refresh token; make `refreshSession()` throw `network timeout`, or return no `accessToken`.
- Impact: users are told to login when Zoe Cloud is unavailable or a backend response is invalid.
- Confidence: High.
- Recommended fix: ZOE-003 preserves typed network/timeout/backend errors and normalizes only confirmed authorization failures.

## UNCONFIRMED RISKS

- SDK_CONTRACT_MISMATCH: source/type contract matches Zoe's `accessToken`/`refreshToken` expectation, but actual production backend response and rotation have not been observed.
- CLOUD_BACKEND_BUG / CLOUD_CONFIGURATION_ISSUE: OAuth redirect and production refresh policy were not tested.
- `getCurrentUser()` swallows every failure and returns `null`; Cloud outage is indistinguishable from logged-out state to its callers.
- `persistAuthSession()` silently ignores inability to inspect SDK internals; login can return a profile while `auth.json` is absent.
- Active task state is only in process/local conversation handling; refresh success continues the current callback (covered deterministically), but failed refresh has no task checkpoint/recovery contract.
- SDK internal refresh and direct network paths are outside Zoe's helper. `ui/commands.ts` calls OpenRouter directly for model discovery but is not an authenticated Zoe Cloud path.
- TEST_COVERAGE_GAP: `runTaskWithPipeline()` and `runAgentWithDisplay()` duplicate the text-based error mapping. For one direct invocation they are mutually exclusive; `insforge.ts` only emits a generic debug message when `ZOE_DEBUG=true`, and `agent.ts` does not render errors. Therefore this audit cannot confirm that one thrown error prints twice. Repeated observed output may be multiple failed requests/tasks or an unobserved caller path. A task-scoped rendered-error test is blocked by private handlers; ZOE-005 should remove this ambiguity.

## LIVE VALIDATION

**LIVE_VALIDATION_BLOCKED.** `~/.zoe/auth.json` and `~/.zoe/config.json` are absent in the audit environment, and controlled browser OAuth requires an owner-signed-in GitHub session. Needed: an owner-authorized test account/session and permission to complete the browser flow. No tokens, users or Cloud configuration were accessed or changed.

## TARGET BEHAVIOR (NOT IMPLEMENTED)

ZOE-003 should introduce a narrow SessionManager adapter that: makes token material the only auth-validity source; exposes typed `unauthorized`, `network`, `timeout`, and `malformed-response` outcomes; uses the existing single-flight strategy; persists rotated credentials atomically; retains legacy profile only as display metadata; clears all local auth representations predictably; and supplies one task-scoped user error. It must retain browser OAuth, existing endpoint/retry count, local-first storage and Windows support.

## ZOE-003 resolution

Implemented as an adaptation of the existing helper, not a provider replacement. `ZoeAuthError` provides typed outcomes; `auth.json` is authoritative; canonical logout clears both credential and legacy auth metadata; and chat uses one shared renderer. Browser OAuth remains unchanged. Live validation remains pending owner execution. Device-code authentication: **Status: Deferred**.

## Migration and security

Migrate a valid legacy profile only after authenticating a usable token; do not infer login from user/email. Preserve a recovery path for malformed files. Tokens are not printed by normal auth debug messages; new tests confirm debug text omits token values. However, refresh tokens are plaintext JSON under the user profile: **SECURITY_RISK**, to be addressed only by an approved future storage task. No credentials were exposed by ZOE-002.

## TESTABILITY_BLOCKER

The current private disk helpers, singleton and private chat handlers prevent deterministic tests for actual `auth.json`/`config.json` mutation, registered CLI logout, and one task-level rendered error without refactoring production seams. Those scenarios are documented for ZOE-003/005; no seam was added during this audit.
