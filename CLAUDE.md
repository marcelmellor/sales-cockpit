Single Source of Truth lies in `AGENTS.md`.
@AGENTS.md

## Claude-Code-specific overrides

- Worktree policy (see AGENTS.md) is enforced via hooks in `.claude/settings.json` —
  `warn-on-worktree.sh` (SessionStart) and `block-worktree-write.sh` (PreToolUse on
  Edit/Write/MultiEdit/NotebookEdit). If either fires, that is by design: abort the
  task and instruct the user to restart Claude Code from the main checkout.
