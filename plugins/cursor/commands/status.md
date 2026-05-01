---
description: Show active and recent Cursor jobs for this workspace, including review-gate status
argument-hint: '[job-id] [--wait] [--timeout-ms <ms>] [--json]'
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" status $ARGUMENTS
```

If the user did not pass a job ID:
- Render the command output as a single Markdown table for the current and past runs in this session.
- Keep it compact. Do not include progress blocks or extra prose outside the table.
- Preserve the actionable fields from the command output, including job ID, kind, status, elapsed or duration, summary, and follow-up commands.

If the user did pass a job ID:
- Present the full command output to the user.
- Do not summarize or condense it.

Filters available: `--type <task|review|adversarial-review>`,
`--status <pending|running|completed|failed|cancelled>`, `--limit <n>`.
`--json` emits machine-readable output.

When passing a `<job-id>`, `--wait` blocks until the job reaches a terminal
state (`completed`/`failed`/`cancelled`). Tune with `--timeout-ms <ms>`
(default 240000) and `--poll-ms <ms>` (default 1000). On timeout, exit code
is 1 and the last-known job state is still printed.
