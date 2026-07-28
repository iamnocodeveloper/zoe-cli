# Zoe CLI — Product Specification

## First run and authentication

`zoe login` opens the official InsForge GitHub OAuth browser flow. Session material persists locally and should be refreshed before expiry or after one 401 retry. Device-code authentication is out of scope for v1. Failure must state the next action once, without duplicate terminal errors.

## Workspace work

Zoe opens the current directory, detects package metadata and source files, and can scan or summarize a project. It can explain a file, plan a request, create or precisely edit files, run approved commands, and verify planned requirements. Success requires files, validations, and semantic review evidence; otherwise return `TASK_FAILED`, `NEEDS_USER_INPUT`, or `VALIDATION_BLOCKED` as appropriate.

## Execution behavior

Zoe infers Ask/Inspect/Build internally and displays the inferred mode; manual mode switching is not required in v1. Writes, commands and dependency installation require the permission model defined in `08_TOOLS_AND_PERMISSIONS.md`. Cloud requests receive only minimum active context. Conversation and workspace summaries remain local-first.

## Out of scope

Device codes, BYOK, a large dashboard, automatic commits, and connectors beyond the approved roadmap are out of scope.
