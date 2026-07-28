# Zoe CLI — Agent Runtime

Current lifecycle: prompt capture → `extractUserIntent` → project snapshot → structured plan → approval when required → Cloud builder/tool calls → file and command validation → reviewer → final status.

`agent.ts` enforces a builder read/write policy and tracks writes; `execution-plan.ts` validates paths, user constraints and commands; `RuntimeController` blocks `SUCCESS` while pending steps or failed validation remain. Existing tests cover exact headline extraction, planner constraints, stale edits, pending actions and several semantic honesty regressions.

The target lifecycle is:

`Prompt → normalize → understand workspace → plan → approval → execute tools → verify files → run commands → semantic review → honest final state`.

Cancellation, rollback and continuation need explicit event and checkpoint contracts. Backups exist for edits, but task rollback is not yet a complete transactional system.

## ZOE-004 audit reference

`16_RUNTIME_AUDIT.md` maps the current split task/chat pipelines, controller duplication and recommended ZOE-005 orchestration boundary. No runtime target design is implemented by this audit.

ZOE-005 implements that boundary without replacing Planner, Builder, Reviewer or tools. `RuntimeController` remains the structured state authority.
# ZOE-009 cooperative cancellation

Cancellation checks occur before Planner, Runtime, tool batches, validation commands and Reviewer, plus between individual tool calls. Current atomic work finishes before cancellation propagates. No rollback or forced process termination is provided.

## ZOE-010 checkpoint-safe stages

The checkpoint contract represents Preview, Planning, Runtime, ToolExecution, Validation, Reviewer, Rendering and Cleanup. It records completed and remaining stages but does not schedule, persist or resume them. Runtime behavior is unchanged.

## ZOE-011 persistence boundary

Checkpoint storage can durably save and inspect canonical metadata, but Runtime does not load, restore or execute it. No runtime scheduling behavior changed.

## ZOE-012 lifecycle capture

Structured execution reports completion of ToolExecution, Validation and Reviewer safe boundaries through an optional metadata callback. The callback only captures checkpoints; it cannot alter runtime state, skip work or restore execution.

## ZOE-013 drift boundary

Workspace drift analysis is separate from Runtime. It reports checkpoint compatibility only and cannot schedule, restore or execute any stage.

## ZOE-014 resume boundary

Resume is an explicit post-tool continuation coordinator, not a second runtime. It accepts only READY checkpoints whose ToolExecution boundary is complete and whose workspace is COMPATIBLE. It may continue Validation, Reviewer, Rendering and Cleanup through explicit adapters; it never invokes Planner, RuntimeController or tool batches.

## ZOE-015/ZOE-016 Git metadata boundary

The runtime receives Git state only through its existing immutable WorkspaceContext. Inspection failure is metadata, not a task failure. Conflicts are visible in preview and block Safe Resume, while normal execution and TaskOutcome ownership remain unchanged.
