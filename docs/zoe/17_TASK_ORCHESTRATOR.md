# ZOE-005 — Canonical Task Orchestrator

## IMPLEMENTED

`src/core/task-orchestrator.ts` is the single AI-task boundary. Each call creates a fresh `TaskContext` with task id, normalized input, mode, entry point, workspace root, start time and task metadata. It classifies once, delegates to either the existing `runAgent()` conversational adapter or the existing `createPlan()` / `executeRuntimeV2()` structured adapter, converts evidence to `TaskOutcome`, catches typed auth errors, emits safe `ZOE_DEBUG` task markers, and returns without rendering.

`TaskOutcome` codes are `COMPLETED`, `COMPLETED_UNVERIFIED`, `PARTIALLY_COMPLETED`, `CANCELLED_BY_USER`, `PERMISSION_DENIED`, `PLANNING_FAILED`, `EXECUTION_FAILED`, `TOOL_FAILED`, `VALIDATION_FAILED`, `REVIEW_FAILED`, `CLOUD_UNAVAILABLE`, `AUTH_REQUIRED`, and `INTERNAL_ERROR`.

`src/cli/task-result-renderer.ts` is the final renderer for orchestrated tasks. Chat and the legacy `run` adapter delegate to the orchestrator. Conversational completion is explicitly `COMPLETED_UNVERIFIED`; structured completion still depends on existing RuntimeController gates.

## PRESERVED

Planner, Builder-like tool-call processing, Reviewer, tool registry, permissions, RuntimeController, browser OAuth, auth helper, conversation memory and terminal visual style are preserved. `ExecutionRuntime` remains internal/legacy; RuntimeController is authoritative for structured final state.

## DEFERRED

Cancellation, rollback, task persistence/resume, direct terminal-command permission unification, workspace refresh after mutation, classifier quality improvements and typed tool results remain deferred. Device-code authentication: Status: Deferred.

## UNVERIFIED_LIVE

Owner must validate browser OAuth, conversational response, structured task, failed validation, back-to-back task isolation, logged-out task, scan outside orchestration and unchanged direct terminal commands.

## Manual validation

1. Start Zoe and ask an explanation-only question; observe one unverified final outcome.
2. Submit a simple coding task; observe its plan and one structured final result.
3. Cause a validation failure; confirm no success result.
4. Submit another task immediately; confirm no stale failure state.
5. Log out, submit a task, log in, and retry.
6. Run `zoe scan` and a direct terminal command; both remain outside AI orchestration.

## Proposed ZOE-006

Unify direct terminal command execution with the permission boundary. It is the highest confirmed remaining safety divergence and can be addressed without changing AI orchestration, cancellation or memory.
