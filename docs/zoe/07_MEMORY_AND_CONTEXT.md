# Zoe CLI — Memory and Context

Memory is local-first. `memory.ts` persists conversation state; `session.ts` supplies JSONL message helpers; `intelligence.ts` persists workspace scan data in `.zoe/project-intelligence.json`. The Cloud receives only active model context required for execution.

v1 must retain workspace summary, selected model, conversation summary and active task checkpoint only when useful; it must not persist provider keys or unrelated repository content. Context must be compacted and scoped to the active workspace to prevent stale cross-project context.

Status: Pending owner decision on retention duration, user-visible deletion controls, and whether task checkpoints may contain tool output. ZOE-008 will establish minimal workspace memory; ZOE-009 will add recoverable task state.
