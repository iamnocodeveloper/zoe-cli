# ZOE-007 — Direct Command Permissions

## Status

Implemented. Direct terminal commands entered in Zoe now pass through `command-permission-policy.ts` before the existing terminal executor runs them.

## Policy boundary

This is a deterministic policy boundary, not an operating-system sandbox. It normalizes and tokenizes commands, detects chains and shell operators, classifies risk, checks workspace-path signals using the canonical WorkspaceContext, and returns an immutable typed decision. Unknown commands require confirmation and no approval persists beyond one exact execution.

Read-only commands execute without a prompt. File redirection, unknown scripts, network commands, package modifications, process/system control, workspace escape and destructive patterns require a prompt. Package installs, updates and removals always require explicit approval; global installs and removals are high risk. Destructive external commands are blocked by policy. Reinforced cases require typing `CONFIRM`.

## Scope and limitations

The policy recognises common Windows, PowerShell and Unix-like patterns, but it cannot provide OS isolation or perfectly interpret arbitrary shell syntax. It does not execute commands during classification, persist approvals, expose command output in debug logs, or change AI-tool permissions.

## Evidence

The deterministic test matrix covers read-only commands, redirection, package actions, destructive commands, chains, remote-pipe execution, workspace escape and unknown-command confirmation requirements.
