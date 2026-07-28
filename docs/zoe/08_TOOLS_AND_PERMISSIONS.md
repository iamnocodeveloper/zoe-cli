# Zoe CLI — Tools and Permissions

Current tools: read (`list_directory`, `read_file`, `glob_files`, `grep_files`, `get_project_context`); write (`write_file`, `edit_file`, `create_directory`); command (`run_command`). Paths are workspace-constrained and protected paths are blocked. Existing permissions are read, write, shell and destructive.

Target capabilities: `READ_ONLY`, `WORKSPACE_WRITE`, `COMMAND_EXECUTION`, `PACKAGE_INSTALL`, `GIT_READ`, `GIT_WRITE`, `NETWORK`, `EXTERNAL_CONNECTOR`. Read-only is automatic; writes and commands require confirmation; package installs require their own explicit confirmation; destructive commands require per-action confirmation. Non-interactive execution denies unapproved mutating actions.

Commands require workspace CWD, bounded timeout and output limits. Block destructive filesystem, Git and database operations by default. Record tool/action audit events locally. ZOE-013 implements this taxonomy without expanding tool scope.

The alpha package preserves these boundaries. Package installation remains a distinct confirmation category, read-only Git awareness grants no mutation permission, and Safe Resume always revalidates permissions. Packaging does not add shell or network authority.

## ZOE-004 audit reference

`executeTool()` is the canonical registry/executor permission boundary. Interactive terminal commands in `chat.ts` bypass it; this is documented in `16_RUNTIME_AUDIT.md` and deferred to the permission task.
