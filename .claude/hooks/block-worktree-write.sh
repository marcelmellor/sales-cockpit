#!/bin/bash
# PreToolUse hook: block any Edit/Write that targets a path inside a git worktree.
# Per AGENTS.md, development must happen in the main checkout so the dev server
# sees all changes. Writing into a worktree silently produces ghost changes.

path=$(python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

if [[ "$path" == *"/.claude/worktrees/"* ]]; then
  echo "BLOCKED: '$path' is inside a git worktree. Per AGENTS.md all development must happen in the main checkout at /Users/mellor/Development/sales-cockpit. Restart Claude Code from there without worktree isolation." >&2
  exit 2
fi
exit 0
