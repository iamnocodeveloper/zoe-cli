# Zoe CLI — Private Preview Release Checklist

## Required release gate

- [ ] Clean Windows installation with Node.js 18+.
- [ ] `npm.cmd install`, test, typecheck and build pass from lockfile.
- [ ] npm package contents and executable entry point validated.
- [ ] Browser OAuth login, restart persistence, refresh, 401 retry, failed refresh and logout verified.
- [ ] Owner validates typed Cloud-unavailable, timeout and malformed-auth recovery messages; local credentials remain intact where specified.
- [ ] Session state is visible; errors appear once.
- [ ] Project scan, summary, file explanation and Git state verified.
- [ ] Approved project creation, precise editing, refactoring and debugging fixtures pass.
- [ ] Build/tests are run where available; failed validation cannot report success.
- [ ] Permission prompts protect writes, commands, package installation and destructive operations.
- [ ] Interruption and resume behavior is verified or explicitly excluded from preview.
- [ ] All production AI entry points use one verified task outcome path; direct terminal-command permission policy is explicitly decided.
- [ ] Owner validates one final outcome per conversational and structured task, including after a failed task.
- [ ] Local memory/privacy behavior, secret handling and data deletion are documented.
- [ ] Version, changelog, known issues, rollback and support instructions are ready.
- [ ] Dependency vulnerability review completed. Status: Pending owner decision on remediation scope.

macOS and Linux validation are future targets, not first-preview blockers. No release proceeds with an unresolved critical authentication, data-loss, secret-exposure or dishonest-success defect.
# ZOE-007 direct command gate

- [ ] Verify read-only direct command execution on Windows.
- [ ] Verify package installation prompt, denial and one-command approval scope.
- [ ] Verify destructive and workspace-escape commands do not execute unexpectedly.

## ZOE-008 task preview gate

- [ ] Verify Ask and Build previews appear before execution on Windows.
- [ ] Verify preview and final outcome display the same Task ID.
- [ ] Verify HIGH structured task pause does not grant tool or command permission.

## ZOE-009 cancellation gate

- [ ] Verify first Ctrl+C cancels only the active task at a safe boundary.
- [ ] Verify repeated Ctrl+C during cancellation does not duplicate the outcome.
- [ ] Verify completed file/command work remains and no rollback is claimed.
- [ ] Verify a subsequent task starts with a fresh uncancelled token.

## ZOE-010 checkpoint contract gate

- [ ] Confirm checkpoint schema/version mismatch is rejected.
- [ ] Confirm workspace changes invalidate validation and review reuse.
- [ ] Confirm prior permission approvals are never treated as current approval.
- [ ] Confirm no checkpoint files, database, persistence or resume command were introduced.

## ZOE-011 checkpoint storage gate

- [ ] Verify atomic save/load in a private-preview Windows home directory.
- [ ] Verify corrupt and version-mismatched files return typed errors.
- [ ] Verify cleanup is explicit and does not run during startup.
- [ ] Inspect stored JSON and confirm it contains metadata only.
- [ ] Confirm no resume, restoration or rollback command exists.

## ZOE-012 lifecycle capture gate

- [ ] Verify one CREATED checkpoint appears when an AI task is accepted.
- [ ] Verify stage updates atomically replace only that task checkpoint.
- [ ] Verify completed, cancelled and failed tasks end with the correct checkpoint state.
- [ ] Simulate storage failure and confirm task execution continues with a warning.
- [ ] Confirm no checkpoint is loaded or executed during startup.

## ZOE-013 workspace drift gate

- [ ] Verify identical checkpoint/current workspaces report COMPATIBLE.
- [ ] Verify workspace version and critical manifest changes report INCOMPATIBLE.
- [ ] Verify added, removed and renamed file details are deterministic.
- [ ] Verify ignored-file-only metadata does not create fingerprint drift.
- [ ] Confirm drift analysis never loads, mutates or executes a checkpoint.

## ZOE-014 safe resume gate

- [ ] Verify resume occurs only after `zoe resume <taskId>`.
- [ ] Verify READY and COMPATIBLE checks run before permission revalidation.
- [ ] Verify validation commands require fresh `--approve-validation`.
- [ ] Verify completed tool batches are not replayed.
- [ ] Verify pending Reviewer without a safe adapter is rejected.
- [ ] Verify rejection leaves the checkpoint file byte-for-byte unchanged.
- [ ] Verify successful completion preserves checkpoint/task lineage and records a new runtime ID in the outcome.
- [ ] Confirm no automatic resume, rollback, replay or startup scan exists.

## ZOE-015/ZOE-016 Git safety gate

- [ ] Verify clean, dirty, nested, non-Git and detached preview using disposable repositories.
- [ ] Verify staged/unstaged/untracked counts without printing full paths.
- [ ] Confirm inspector commands contain no fetch, pull, push or mutation verbs.
- [ ] Confirm timeout and missing Git do not fail a normal task.
- [ ] Inspect schema-v2 JSON and confirm no remote/config/identity/diff/output metadata.
- [ ] Confirm a version-1 checkpoint returns `CheckpointVersionMismatch`.
- [ ] Verify unchanged and matching-dirty Git states remain compatible.
- [ ] Verify HEAD, branch, repository relationship, untracked path and conflict changes reject resume.
- [ ] Confirm Git rejection happens before permission revalidation and no completed tool batch repeats.
- [ ] Confirm the Zoe repository was not mutated during validation.

## ZOE-017 npm alpha gate

- [x] Package version is `0.4.0-alpha.0`; registry confirms it is unpublished.
- [x] `publishConfig` enforces public access and alpha tag.
- [x] Explicit files allowlist excludes source, tests, `.env`, internal docs, tarballs and source maps.
- [x] `npm.cmd ci`, tests, typecheck, build and `git diff --check` pass.
- [x] `npm audit` reports zero vulnerabilities after the bounded transitive fix.
- [x] Pack and publish dry-runs pass.
- [x] Real tarball was generated outside the repository and independently inspected.
- [x] Local and isolated-global tarball installations pass on Windows paths with spaces/Unicode.
- [x] Installed local/global `zoe.cmd` help and version pass.
- [x] Real isolated checkpoint, drift, resume and Git scenarios were exercised.
- [x] README, LICENSE, CHANGELOG, SECURITY and limitations are included.
- [ ] Live authenticated Ask/Inspect smoke test — blocked pending owner OAuth session.
- [ ] `npm.cmd whoami` — blocked by E401 until owner authenticates.
- [ ] Owner review/staging of the dirty worktree.
- [ ] Separate owner approval for actual `npm.cmd publish --access public --tag alpha`.
