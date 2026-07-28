# Zoe CLI — Decision Log

## 2026-07-25 — Preserve current architecture

Status: Approved. Context: audit found functional Commander, TypeScript, InsForge, planner/runtime and tool boundaries. Options: rebuild, framework replacement, incremental stabilization. Chosen option: incremental stabilization. Reason: preserve working behavior and avoid migration risk. Consequence: all changes are scoped tasks. Owner approval: approved.

## 2026-07-25 — Official v1 login

Status: Approved. Context: browser GitHub OAuth exists. Options: browser OAuth, device-code, BYOK. Chosen option: InsForge GitHub browser OAuth. Reason: existing official path. Consequence: device code deferred. Owner approval: approved.

## 2026-07-25 — Permissions and mode

Status: Approved. Chosen option: package installation is a separate confirmation; execution mode remains inferred and visible. Consequence: ZOE-007 and ZOE-013 must preserve automatic routing. Owner approval: approved.

## 2026-07-25 — Memory and platforms

Status: Approved. Chosen option: local-first memory and minimum Cloud context; Windows is the required private-preview platform. Consequence: retention controls and macOS/Linux support remain deferred. Owner approval: approved.

## Pending decisions

- Status: Pending owner decision — token storage migration requirement/timeline.
- Status: Pending owner decision — task checkpoint retention and deletion behavior.
- Status: Pending owner decision — first external connector.
- Status: Pending owner decision — telemetry policy.
- Status: Pending owner decision — npm dependency vulnerability remediation scope.

## 2026-07-25 — ZOE-002 authentication findings

Status: Accepted audit evidence; no production design selected. Context: source, SDK v1.4.3 and deterministic tests were inspected. Findings: config-only login gates are false positives; registered logout and config cleanup are split; refresh network/malformed failures become expiry. Chosen option: defer behavioral change to narrowly scoped ZOE-003. Consequences: live Cloud validation remains blocked pending owner-authorized browser session. Owner approval: ZOE-002 approved.

## 2026-07-25 — ZOE-003 centralized credential ownership

Status: Implemented, pending owner live validation. Chosen option: adapt the existing authenticated-request helper with typed errors, preserving browser OAuth, retry count and token rotation. Consequences: config metadata cannot authenticate; local cleanup survives Cloud logout failure; device-code remains deferred. Owner approval: approved.

## 2026-07-25 — ZOE-004 runtime audit

Status: Completed audit. Decision: do not replace Planner, Builder, Reviewer or tools; stabilize ownership through a narrow orchestrator task. Evidence: `16_RUNTIME_AUDIT.md`. Owner approval: approved.

## 2026-07-25 — ZOE-005 canonical task boundary

Status: Implemented, pending owner live validation. Chosen option: adapt existing conversational and structured pipelines through one context/outcome boundary and renderer. Consequence: structured RuntimeController gates are preserved; direct terminal commands remain deferred. Owner approval: approved.
# ZOE-007 — Direct commands use deterministic per-command permissions

Status: Accepted owner decision. Package modification requires explicit approval; unknown commands are never auto-approved; this remains a policy boundary, not a sandbox.
