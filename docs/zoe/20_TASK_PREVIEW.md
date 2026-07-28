# ZOE-008 — Task Intent Visibility and Execution Preview

## Status

Implemented for AI task entry points. Before either conversational or structured execution begins, Zoe renders a deterministic, execution-scoped preview using the TaskContext already created by the canonical Task Orchestrator.

## Read-only lifecycle hook

`TaskRunOptions.onPreview` is invoked immediately after TaskContext creation, ID generation and existing mode classification, and before conversational execution, Planner, Runtime, tools, Reviewer or validation. It receives a frozen TaskContext copy with the canonical WorkspaceContext reference. The callback cannot alter classification or execution ownership; renderer failures are logged safely and do not stop or redirect execution.

## Preview model

`task-preview.ts` maps existing `CHAT_MODE` and `TASK_MODE` values to presentation labels only: Ask, Inspect and Build. Inspect is a deterministic presentation label for structured, analysis-only input without mutation signals; it is not an execution mode.

The immutable preview includes the existing Task ID, pipeline label, workspace name/language/framework, predicted project changes, expected validation, permission expectations, LOW/MEDIUM/HIGH complexity, expected output and timestamp. It does not call AI, rescan the workspace or request permission.

## Rendering and pause

`task-preview-renderer.ts` owns the shared terminal layout used by chat and the legacy run adapter. Only HIGH-complexity structured tasks may pause for ENTER when the terminal is interactive. This pause is usability feedback and grants no security permission; ZOE-007 remains authoritative for command approval.

## Deterministic limitations

The preview is based on task wording, existing classification and WorkspaceContext metadata before Planner runs. Consequently, file-change, validation and permission fields are expectations rather than guarantees. Exact planned files and commands remain visible through the existing plan and permission renderers.
