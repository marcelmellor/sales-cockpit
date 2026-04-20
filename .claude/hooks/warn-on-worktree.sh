#!/bin/bash
# SessionStart hook: abort if the session is running inside a git worktree.
# Per AGENTS.md, all development must happen in the main checkout at
# /Users/mellor/Development/sales-cockpit. The dev server runs from there and
# cannot see changes made in a worktree.

cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

if [[ "$cwd" == *"/.claude/worktrees/"* ]]; then
  cat <<EOF
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"STOP IMMEDIATELY — POLICY VIOLATION:\n\nThis session is running inside a git worktree (cwd: $cwd).\n\nPer AGENTS.md, ALL development for the sales-cockpit project must happen in the main checkout at /Users/mellor/Development/sales-cockpit — NEVER in a worktree. The user's dev server runs from the main checkout and cannot see changes made here. Any files you edit will be invisible to the running app.\n\nDO NOT start any task. Instead, tell the user to restart Claude Code from /Users/mellor/Development/sales-cockpit without worktree isolation, then end this session."}}
EOF
fi
