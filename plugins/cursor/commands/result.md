---
description: Print a completed job's result text.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:result

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/cursor-companion.mjs result $ARGUMENTS
```

Required: a job id (from `/cursor:status`).

Flags:
- `--log` — print the streaming event log captured while the run was alive
- `--json` — emit the full JobRecord

If the job hasn't finished, exits 1. Surface the output verbatim.
