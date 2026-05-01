---
description: Reattach to an existing Cursor agent and continue the conversation.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:resume

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/cursor-companion.mjs resume $ARGUMENTS
```

Resume a durable Cursor agent. The agent keeps the context from prior runs,
so follow-up prompts skip rebuilding the workspace map.

Usage:

- `<agent-id> <prompt>` — resume a specific agent with a follow-up prompt
- `--last <prompt>`     — resume the most recent task agent for this workspace
- `--list`              — print known agent ids from the local job index
- `--list --remote`     — query the SDK for durable agents (local runtime by
                          default; combine with `--cloud` for cloud-runtime
                          agents — that needs `CURSOR_API_KEY`)
- `--limit <n>` and `--json` apply to `--list`

Inherits the same flags as `/cursor:task`: `--write`, `--background`, `--force`,
`--cloud`, `--model <id>`, `--timeout <ms>`, `--json`.

Model resolution: `--model` flag > `CURSOR_MODEL` env > persisted default
(set via `/cursor:setup --set-model <id>`) > built-in fallback.

Default policy is read-only — pass `--write` to allow file modifications.

Surface the output verbatim. If `--list` returns `(no resumable agents)`, the
workspace has no recorded agentIds yet — start with `/cursor:task` first.
