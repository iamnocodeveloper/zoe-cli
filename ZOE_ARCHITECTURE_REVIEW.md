# Zoe CLI Architecture Review

Date: 2026-07-16  
Scope: current Zoe workspace compared with the public repositories for Codebuff, OpenCode, Aider, and Cline. This is an architectural review, not an implementation guide. It intentionally does not reproduce source code, prompts, or proprietary/business logic.

## Executive conclusion

Zoe should continue with a simplified, runtime-owned architecture for the Public Preview. It should not adopt multi-agent orchestration, broad framework support, plugins, or a new UI now. The reliability gap is narrower and more important: one authoritative task state, one tool dispatcher, evidence-based completion, deterministic verification gating, and bounded repair.

The comparison supports a focused direction:

1. Keep a structured plan and deterministic user constraints.
2. Make one runtime state machine the sole owner of execution and final status.
3. Treat model output as proposals for tool calls, never proof of completion.
4. Record every read, write, command, diff, and verification as execution evidence.
5. Gate verification and completion on physically confirmed planned actions.

## 1. Execution pipeline

| Stage | Codebuff | OpenCode | Aider | Cline | Zoe today | Assessment for Zoe |
| --- | --- | --- | --- | --- | --- | --- |
| User request | Routes requests through an agent workflow. | Creates a session/message with structured parts. | Conversational request over a Git-backed workspace. | Task/session request in Plan or Act mode. | Chat/task classification, then createPlan. | Good split, but task mode must reliably lead to one executor. |
| Context gathering | Specialized file-picker/research agents can gather context. | Session tools and project rules provide context incrementally. | Repo map plus named files and chat history. | Workspace context, mentions, rules, and tool outputs. | Project description, snapshot, tech stack, file summary, cache. | Add explicit context provenance and freshness metadata; do not add more agents. |
| Discovery | File picker identifies relevant files before editor work. | Read/list/search tools are session parts. | Tree-sitter repo map prioritizes important symbols/files. | File/search/terminal/browser tools discover incrementally. | Snapshot and generic tools. | Existing snapshot is sufficient for Public Preview; prioritize reliable refresh over broader discovery. |
| Planning | Planner agent can hand work to editor/reviewer. | Plan mode is optional; sessions carry parts and permissions. | Mostly edit-oriented; planning is conversational rather than a mandatory planner artifact. | Explicit Plan then Act separation. | Structured JSON plan, deterministic constraints, repair once. | Zoe is stronger than Aider here but must make the plan executable state, not display-only JSON. |
| Execution | Editor agent produces edits and commands. | Processor dispatches typed tool calls and records results. | Applies model edit formats against repository files. | Act mode dispatches tools with approval/checkpoints. | processToolCalls parses model markup and invokes executeTool. | Main weakness: execution can end without satisfying pending plan actions. |
| Verification | Reviewer agent and tests. | Tool results/session evidence can drive follow-up. | Auto lint/test and repair loops are core. | Watches command output and compiler/linter errors. | Build commands plus an LLM review. | Runtime evidence should be primary; reviewer text must be advisory only. |
| Repair | Workflow/agent dependent. | Retry parts and session continuation. | Test/lint errors are fed back for repair. | Error output drives tool-based fixes. | Bounded retries exist but were previously detached from pending actions. | Keep bounded retries, keyed per action and failure class. |
| Completion | Workflow and tool outcomes. | Session lifecycle and structured parts. | Git diff, tests, and chat result. | Task completion plus checkpoint/diff. | ExecutionRuntime and RuntimeController both participate. | Consolidate final ownership in one runtime. |

Codebuff publicly documents a File Picker, Planner, Editor, and Reviewer sequence. That is a useful conceptual pipeline, but it is not a reason for Zoe to add specialized agents now. Zoe can achieve the reliability benefit with deterministic phases in one runtime. Codebuff also provides E2E testing guidance, which reinforces that interactive-agent behavior must be exercised outside unit tests.

OpenCode models a session as ordered structured parts, including tool, retry, patch, snapshot, and step parts. This is a stronger event model than a plain transcript: it makes later decisions traceable to observable actions. Zoe should adopt the event/evidence concept, not OpenCode's wider server/agent ecosystem.

Aider is comparatively direct: it anchors work in the repository, applies edits, and runs configured lint/test commands. Its important lesson is not planning complexity; it is that an edit is followed by concrete verification and errors are fed back into the editing loop.

Cline separates planning from acting and makes approval/checkpoints visible. Its useful architectural lesson is that an execution mode must have a clear authority boundary: planning explores, acting changes the workspace.

## 2. Runtime ownership

Codebuff delegates much of sequencing to agent workflows. The LLM and agent definitions have substantial control, although tools and workflow steps are programmatic.

OpenCode has a stronger runtime/session owner. Its processor, permission evaluation, session messages, and event bus treat model messages as parts in a managed session.

Aider is a controlled conversational loop. The model chooses edits, but repository state, edit formats, Git integration, linting, and tests constrain what can be accepted.

Cline has a task runtime with explicit Plan/Act modes, approvals, tool lifecycle, and checkpoints. The model proposes actions; the host executes and records them.

Zoe should be runtime-owned. The model may propose a plan or a tool call, but it must never decide that a file action, verification, repair, or final status is complete. In the current workspace, RuntimeController and ExecutionRuntime overlap. This is the most important maintainability risk: one represents richer structured state while the other produces the final task status. The Public Preview should converge on one authoritative runtime state and one finish decision.

## 3. Context engineering

Codebuff uses task-specific agents for file selection and supports project knowledge files. OpenCode loads hierarchical project/global rules from AGENTS.md and related compatible conventions. Aider builds a token-budgeted repository map and exposes refresh policies. Cline uses workspace mentions, project rules, task context, and live tool results.

Zoe already gathers project description, a snapshot, tech stack, file summary, user intent, and conversation memory. It also has a read cache and a fresh-read path for edits. The essential missing concept is a context ledger:

- Every context item should identify source path, filesystem version or content hash, capture time, and truncation status.
- A write invalidates all cached entries for that path.
- An edit must use a fresh disk read, and its result must be tied to the exact content version read.
- Tool output, not an earlier model summary, is the source of truth after a command or write.
- Context must have explicit budgets: snapshot summary, selected files, current file, command output, and conversation summary each get independent limits.

Aider's map-token and map-refresh controls are a useful example of an explicit context budget. Zoe does not need a full tree-sitter map immediately; a bounded file summary plus selected-file hashes is enough for the Public Preview.

## 4. Tool execution

Codebuff exposes tools through workflow/agent definitions. OpenCode normalizes work into typed message parts and evaluates permissions before tool use. Aider separates edit application from shell/test execution and uses repository/Git state as a guardrail. Cline presents each tool action, approval, output, and checkpoint as task evidence.

Zoe's executeTool is the right central seam: it normalizes aliases, validates Zod arguments, requests permission, invokes the implementation, and converts failures to a result string. That dispatcher must remain the only write/shell path.

Required reliability properties for Zoe:

- A normalized ToolCall record: call id, requested tool, normalized arguments, permission decision, start/end time, result classification, and evidence paths.
- Read, write, and command tools remain distinct capability classes.
- Writes return physical evidence: resolved path, pre-write hash, post-write hash, and whether the planned action was modify or create.
- Shell commands record cwd, command, timeout, exit code, stdout/stderr truncation, and whether they were a required validation command.
- Tool failures are typed, not inferred from prose: invalid arguments, denied, missing target, stale edit, command failure, timeout, and internal error.

Zoe's current XML/JSON parsing compatibility is acceptable short term, but both formats must feed the same normalized dispatcher and evidence recorder. No direct tool call path should bypass it.

## 5. Planner

Codebuff uses a planner agent among specialized workflows. OpenCode offers planning mode but supports interactive session execution. Aider does not depend on a mandatory formal plan. Cline has an explicit user-facing Plan mode before Act mode.

Zoe's structured ExecutionPlan is appropriate for the Public Preview. Its deterministic UserIntent constraints are a meaningful advantage when they are applied after parsing and before execution. The recently added normalization of safe risks values is also the correct pattern: normalize only harmless presentation fields, then apply exact schema validation.

Planner rules for Zoe:

- Validate every untrusted plan field locally.
- Only normalize safe, non-authoritative presentation fields.
- Reject malformed files, commands, requirements, and userConstraints rather than repairing their shape silently.
- Overlay deterministic user constraints only after the candidate has passed structural validation.
- Repair once with exact local validation errors; then return NEEDS_USER_INPUT and execute nothing.
- Convert the accepted plan directly into pending runtime actions. A displayed plan is not an executed plan.

## 6. Verification

Aider uses lint/test commands and can feed failures back into repair. Cline watches terminal output, compiler/linter errors, diffs, and checkpoints. Codebuff describes a reviewer phase and test execution. OpenCode's structured tool/session history enables evidence-based verification rather than relying only on final text.

Zoe should verify in this order:

1. Each planned create/modify action has a successful tool result and a changed post-write filesystem hash.
2. Every required file/requirement verification is checked against current disk state.
3. Required validation commands run only after all planned file actions are complete.
4. Command results are stored in the authoritative execution state.
5. Runtime decides SUCCESS only when no pending steps remain and all required evidence passes.
6. LLM review is optional advisory output; it must not create or erase completion evidence.

This directly prevents the observed failure mode where npm run build passes on an unchanged project. A passing build proves only that the pre-existing project builds; it does not prove that the requested change was made.

## 7. Repair

Codebuff can use different agents/workflows for correction. OpenCode records retries as structured session parts. Aider feeds test/lint errors back into the edit loop. Cline uses command output and active task state to continue repair.

Zoe already has a bounded repair counter. It should make retry policy explicit:

| Failure class | Evidence used | Maximum | Terminal result |
| --- | --- | --- | --- |
| No write produced for a pending file action | Pending action, latest file content, exact requirement | 3 total action attempts | FAILED with the required modification message |
| Stale old_text edit | Fresh disk content and failed edit result | 1 focused repair after reread | FAILED for that action if still stale |
| Build/test failure after writes | Captured command output and affected files | 1 Public Preview repair pass | FAILED with stored build evidence |
| Invalid planner output | Local Zod errors | 1 planner repair | NEEDS_USER_INPUT |
| Permission denial | User decision | 0 automatic retries | CANCELLED or NEEDS_USER_INPUT, never success |

The key pattern from Aider and Cline is evidence-driven repair. Do not ask the model to repair from a generic summary when the exact compiler output, changed files, and pending action are available.

## 8. Memory

Codebuff supports knowledge.md and agent definitions. OpenCode uses AGENTS.md at project and global scope, with compatible fallbacks. Aider persists chat history and supports a repository map/configuration. Cline supports project rules and task/session history.

Zoe has project conversation memory and session controls. For Public Preview, persistent memory should remain small and reviewable:

- Read a committed project instruction file if present, preferably AGENTS.md plus a Zoe-compatible fallback policy.
- Store only session transcript summaries and execution evidence under Zoe-owned session storage.
- Never treat session memory as permission or constraint authority.
- Keep deterministic project discovery separate from conversational memory.

Do not add autonomous long-term memory now. The essential reliability gain is a committed project instruction file and reproducible execution logs.

## 9. User experience

Codebuff shows agent/task progression. OpenCode exposes session/tool parts and permission flows. Aider keeps the user close to Git diffs and command output. Cline distinguishes Plan/Act, presents per-action approval, and supplies checkpoints/diff review.

For Zoe, the necessary experience is operational rather than cosmetic:

- Show the accepted constrained plan before writes.
- Show each pending action and its state: pending, awaiting permission, executed, verified, failed.
- Ask permission once per governed action, accepting only y/yes, n/no, a/always.
- Print build command/result and preserve it in the final summary.
- On failure, state the failed action, observed evidence, remaining pending actions, and safe next step.

The current progress messages are useful. No terminal redesign is required.

## 10. Critical reliability differences

The following capabilities materially improve reliability and are absent or incomplete in Zoe:

1. One authoritative runtime state/finalizer. Zoe currently has overlapping RuntimeController and ExecutionRuntime responsibilities.
2. Immutable execution evidence. Tool results are mostly strings rather than normalized records with hashes, exit codes, and timestamps.
3. Stable file-version tracking. Fresh reads exist, but no content hash binds an edit proposal to the content it was generated from.
4. Checkpoints/rollback. Cline's snapshots make recovery from a bad autonomous task possible.
5. Git-aware change boundary. Aider's Git/diff orientation gives a robust answer to exactly what changed.
6. Context budget and refresh policy. Aider's repo-map controls are a mature example; Zoe has summaries/caches without a formal budget ledger.
7. Typed retry taxonomy. Zoe has bounded retries but needs separate policies for plan invalidity, no-write behavior, stale edits, command failures, and authentication failure.
8. Non-interactive execution contract. Cline documents an explicit headless/auto-approval mode. Zoe currently denies writes when stdin is not a TTY, which is safe but prevents deterministic automation testing unless an explicit mode is designed.
9. Durable project instructions. AGENTS.md/knowledge/rules support is common; Zoe should adopt only a simple, committed instruction-file reader.
10. Authentication refresh evidence. The observed AUTH_UNAUTHORIZED path needs a refresh-once/retry-once policy with an unambiguous safe terminal error.

## 11. Recommendations

### Immediate: Public Preview

1. Make one runtime state machine authoritative. Merge or delegate RuntimeController and ExecutionRuntime so only one component creates pending actions, records evidence, runs validation gates, and sets SUCCESS/FAILED/NEEDS_USER_INPUT/CANCELLED.
2. Add a normalized execution-event log behind executeTool. Include planned action id, normalized arguments, permission outcome, result class, physical file hash when applicable, and command exit evidence.
3. Complete file actions only from verified write evidence, never from a successful read, file existence, model prose, or a passing build.
4. Enforce validation ordering: no build/test command until all required file actions are completed or the runtime has failed.
5. Keep the three-attempt per-action rule and return a typed failure with the exact pending action.
6. Implement refresh-once/retry-once for authenticated Cloud requests and emit the required login instruction on failure.
7. Add a small AGENTS.md reader with explicit size limit and path scope. Do not add a skill/plugin ecosystem.
8. Create deterministic fixture-based E2E tests for React/Vite TypeScript, including an interactive permission harness or explicit test-only permission adapter.

### Next Version

1. Add content hashes and atomic write evidence for all file operations.
2. Add Git diff summary and optional checkpoint before a task; do not require Git to perform a task.
3. Introduce typed tool-result objects internally and render them as text only at the UI boundary.
4. Add an optional, bounded repo map or symbol index for context selection.
5. Separate command policy from model instructions with allowlisted validation commands and cwd restrictions.
6. Add fault-injection tests for provider errors, stale writes, timeout, denied permission, and interrupted repair.

### Future

1. Add opt-in checkpoints/rollback modeled after Cline's safety outcome, not its UI.
2. Add stronger repository-wide semantic context similar to Aider's map after Public Preview execution is stable.
3. Consider specialized agents only if measured evaluation data shows a single runtime cannot meet accuracy targets. Codebuff demonstrates potential value, but this would add cost and failure modes.
4. Consider a structured session/event protocol similar to OpenCode if Zoe later needs multiple clients or resumable remote runs.

## 12. Scores

Scores are relative to these mature open-source agents and assess the current Zoe workspace, not product potential.

| Area | Zoe score | Rationale |
| --- | ---: | --- |
| Architecture | 5/10 | Clear modules exist for planning, tools, permissions, runtime, and memory, but duplicate runtime ownership obscures invariants. |
| Runtime | 4/10 | Runtime constraints and bounded retries are emerging, but finalization and evidence are split across ExecutionRuntime and RuntimeController. |
| Planner | 6/10 | Structured plan, deterministic constraints, local schema validation, and one repair are sound for Preview scope. |
| Execution | 4/10 | A normalized dispatcher exists, but model turns have been able to end without completing pending actions; action evidence remains incomplete. |
| Verification | 4/10 | Build verification exists, but it was not sufficiently gated on completed writes and an LLM reviewer is too influential. |
| Repair | 4/10 | Bounded loops and stale-edit handling exist, but retry policies are not yet a coherent failure taxonomy. |
| Developer experience | 5/10 | Progress, plans, permissions, and summaries exist; missing reliable diff/checkpoint and actionable execution evidence lowers trust. |
| Reliability | 3/10 | Real validation exposed AUTH_UNAUTHORIZED and no-write execution failures. The system correctly avoids claiming success in several cases, but cannot yet complete the core flow reliably. |
| Maintainability | 5/10 | TypeScript and modules help, but overlapping runtime abstractions and string-based result handling increase regression risk. |

## 13. Final verdict

Continue with the current product direction, but simplify the execution architecture before expanding capability.

Do not adopt Codebuff-style multi-agent orchestration for Public Preview. Do not copy Aider edit formats or Cline/OpenCode workflows. Adopt only these proven architectural patterns:

- Aider: repository-grounded edits followed by concrete lint/test feedback.
- Cline: clear Plan/Act authority, tool approvals, and recoverable evidence/checkpoints.
- OpenCode: structured session/tool/retry event records and centrally evaluated permissions.
- Codebuff: explicit pipeline roles as runtime phases, not necessarily separate agents.

The reliable Zoe architecture is a single constrained task runtime:

Request -> deterministic constraints -> schema-validated plan -> pending actions -> normalized approved tools -> physical evidence -> required validation -> bounded repair -> one runtime final state.

That pattern directly addresses every observed Public Preview blocker without broadening scope.

## Sources reviewed

- https://github.com/CodebuffAI/codebuff
- https://github.com/anomalyco/opencode
- https://github.com/aider-ai/aider
- https://github.com/cline/cline
- https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/rules.mdx
- https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts
- https://github.com/aider-ai/aider/blob/main/README.md
- https://github.com/aider-ai/aider/blob/main/aider/website/assets/sample.aider.conf.yml
- https://github.com/cline/cline/blob/main/docs/cline-cli/overview.mdx
