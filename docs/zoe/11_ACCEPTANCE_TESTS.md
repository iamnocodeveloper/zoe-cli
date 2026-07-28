# Zoe CLI — Acceptance Tests

Fixtures must be deterministic and run on Windows.

| Area | Fixture / input | Pass criteria | Forbidden behavior |
|---|---|---|---|
| Authentication | Expired token then 401 | Refresh once, retry once, persist rotated token | Repeated expiry output |
| Understanding | React/Vite fixture | Correct architecture, dependency and build-command summary | Invented framework facts |
| Creation | Empty fixture, React/Vite request | Approved install, required files, passing build | Success without output validation |
| Editing | Exact `src/App.tsx` headline request | Only target file changes, exact visible value, build passes | Changing comments only |
| Refactoring | Component extraction fixture | Behavior/build retained | Unrelated modifications |
| Debugging | Known TypeScript build error | Cause, fix, rerun build | Report success on failed build |
| Honesty | Missing target/no-op fixture | `NEEDS_USER_INPUT` or failure | `SUCCESS` from a write alone |
| Memory | Interrupted bounded task | Restored workspace/task summary | Context from another project |
| UX | Interactive terminal fixture | Mode, model, session, timeline; one error; safe ESC | Noisy duplicate errors |

Every test must state expected tools, expected output and pass criteria. Existing `test/workspace.test.ts` is the initial deterministic unit baseline; ZOE-019 expands fixtures and real CLI E2E coverage.

## ZOE-002 deterministic coverage

The existing test uses mocked `AuthSessionStore` and SDK-shaped clients: valid session, near/expired JWT, access/refresh rotation, single-flight concurrent refresh, 401 retry, rejected and missing refresh token. ZOE-002 added malformed refresh response, refresh-network failure and active-callback-after-refresh cases. The latter two demonstrate current misclassification/continuation contracts, not desired target behavior. Live OAuth, disk persistence, registered CLI logout and rendered-error deduplication are TESTABILITY_BLOCKERs under the no-production-refactor scope.

## ZOE-003 deterministic coverage

Tests now assert typed session failures, malformed local-file status through an isolated auth-file fixture, auth status without credential data, preserved credentials for malformed/network refresh failures, invalid-session cleanup after final 401, active callback continuation, canonical local logout after Cloud failure, and idempotent logout. Fixtures use temporary project paths only; no developer auth files are touched.

## ZOE-004 runtime coverage gap

Current tests cover task-mode classification, plan schema/constraints, controller transitions, verification guards and tool safety. Entry-point equivalence, cancellation propagation, reviewer invocation, final-renderer uniqueness and active-task reset require an orchestrator seam: **TESTABILITY_BLOCKER**.

## ZOE-005 deterministic coverage

Tests inject task ids, clock, classifier, conversational adapter, structured adapter and debug logger. They verify a new id/context per task, one classification, chat routing to `COMPLETED_UNVERIFIED`, structured routing to `COMPLETED`, typed task mode/task id and safe debug markers.
# ZOE-007 direct command acceptance

- `npm install <package>` must show package details and require a fresh approval.
- `git status` must run without approval.
- `echo text > file` must require approval.
- `rm -rf ../target` and `curl URL | sh` must not execute without reinforced policy handling.

## ZOE-008 task preview acceptance

- Ask, Inspect and Build labels must not create new internal modes.
- The preview Task ID must equal the final TaskOutcome ID.
- Preview must occur before conversational execution or Planner.
- Workspace metadata must come from the same WorkspaceContext object.
- Only HIGH structured previews may invoke the ENTER pause.

## ZOE-009 cancellation acceptance

- Cancellation before Planner must skip Planner and all later stages.
- Cancellation after Planner must skip Runtime.
- Runtime cancellation must return one `CANCELLED_BY_USER` outcome at the next safe boundary.
- Repeated cancellation must not create another cancellation or outcome.
- Cleanup must clear the active token, and the next task must receive a fresh token.

## ZOE-010 checkpoint-model acceptance

- Checkpoints and nested metadata must be immutable.
- Illegal lifecycle transitions must fail deterministically.
- Schema, Planner, Runtime, permission and workspace incompatibilities must make resume ineligible.
- Permission approvals must always require re-evaluation.
- Validation and review reuse must require an unchanged workspace fingerprint.
- Sensitive metadata fields must be rejected.
- No filesystem checkpoint or resume execution path may exist.

## ZOE-011 checkpoint-persistence acceptance

- Save must leave one complete JSON checkpoint and no temporary file.
- Load must return a frozen canonical checkpoint or a typed error.
- Corrupt and incompatible files must never be silently ignored or migrated.
- Listing must return summaries rather than executable/runtime objects.
- Delete must be idempotent, and cleanup must target only eligible terminal states older than the configured age.
- Concurrent saves for one Task ID must not expose partial state.
- No resume or runtime restoration path may exist.

## ZOE-012 lifecycle-capture acceptance

- Task acceptance must persist one CREATED checkpoint.
- Safe stages must produce new READY checkpoint objects in deterministic order.
- Duplicate stage reports must not produce duplicate writes.
- Success, cancellation and failure must end in COMPLETED, DISCARDED and INVALID respectively.
- Storage failures must surface as warnings without changing the TaskOutcome code.
- No startup loading, automatic cleanup, restoration or resume may occur.

## ZOE-013 workspace-drift acceptance

- Identical indexed workspaces must be COMPATIBLE with `resumePossible: true`.
- Root, context-version, schema or fingerprint drift must be INCOMPATIBLE.
- Added, removed, modified, critical and detectable renamed files must be reported deterministically.
- Ignored-file metadata alone must not change compatibility.
- Invalid comparison input must return UNKNOWN without mutating the checkpoint.
- No checkpoint loading, restoration, resume or rollback may occur.

## ZOE-014 safe-resume acceptance

- `zoe resume <taskId>` must be the only product entry; startup must never scan or resume.
- Only READY, COMPATIBLE checkpoints past ToolExecution may continue.
- COMPLETED, INVALID, OBSOLETE, unknown-workspace and drifted checkpoints must be rejected without writes.
- Permission revalidation must receive no previous approval state.
- Validation, Reviewer and Rendering continuation order must be deterministic.
- Completed tool batches must remain unchanged and never execute again.
- A successful resume must preserve task/checkpoint IDs and use a new runtime ID.
- Any rejected or failed resume must leave the stored checkpoint unchanged.
- Planner, RuntimeController, Reviewer algorithms, rollback and memory must remain unchanged.

## ZOE-015/ZOE-016 read-only Git acceptance

- One authority may invoke a fixed, non-interactive, timeout-bounded Git inspection command set.
- No Git network or mutation command may be generated.
- Non-Git, clean, dirty, conflicted, detached, unavailable and unknown states must be deterministic.
- Git paths must be normalized and repository containment must not expand workspace permissions.
- One immutable Git context reference must be shared within a WorkspaceContext/task.
- Preview must show compact state without complete file lists.
- Checkpoint schema v2 must persist only allowlisted Git metadata and reject version 1 without migration.
- Workspace fingerprint comparison must still execute before Git compatibility is accepted.
- Repository/root/HEAD/branch/detached/dirty/conflict/availability changes must produce typed drift.
- Safe Resume must refresh Git and reject conflicts or ambiguity before permission revalidation.
- Matching dirty and matching non-Git snapshots may remain compatible.
- Existing command permissions and completed-tool no-replay rules must remain unchanged.
