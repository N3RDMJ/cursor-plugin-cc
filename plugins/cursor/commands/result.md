---
description: Print a completed job's result text. Defaults to the most recent terminal job in the current workspace.
argument-hint: '[<job-id>] [--log] [--json]'
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:result

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs result $ARGUMENTS
```

Without an argument, prints the most recent terminal (`completed` / `failed` /
`cancelled`) job for this workspace — the same shape codex-plugin-cc's
`/codex:result` uses. Pass a job id (from `/cursor:status`) to target a
specific job.

Flags:
- `--log` — print the streaming event log captured while the run was alive
- `--json` — emit the full JobRecord

If the resolved job hasn't finished, exits 1. Surface the output verbatim.
