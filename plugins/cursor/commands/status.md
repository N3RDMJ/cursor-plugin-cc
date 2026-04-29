---
description: Show cursor-plugin-cc job table for the current workspace.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:status

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/cursor-companion.mjs status $ARGUMENTS
```

With no arguments: prints a table of recent jobs (id, type, status, age,
summary). With a job id positional: prints the full job detail.

Filters available: `--type <task|review|adversarial-review>`,
`--status <pending|running|completed|failed|cancelled>`, `--limit <n>`.
`--json` emits machine-readable output.

Surface the output verbatim.
