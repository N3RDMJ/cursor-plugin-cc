---
description: Reattach to an existing Cursor agent and continue the conversation.
argument-hint: '<agent-id|--last|--list> [prompt] [--write] [--background] [--model <id[:k=v,...]>]'
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:resume

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" resume $ARGUMENTS
```

Resume a durable Cursor agent. The agent keeps the context from prior runs,
so follow-up prompts skip rebuilding the workspace map.

Usage:

- `<agent-id> <prompt>` — resume a specific agent with a follow-up prompt
- `--last <prompt>`     — resume the most recent task agent for this workspace
- `--list`              — print known agent ids — merges this workspace's
                          local job index with the SDK's durable agent list
                          (local runtime). Soft-fails on SDK errors with a
                          stderr footer.
- `--list --local`      — only show this workspace's job index (skips the SDK)
- `--list --remote`     — only show the SDK's durable agents (local runtime by
                          default; combine with `--cloud` for cloud-runtime
                          agents — that needs `CURSOR_API_KEY`)
- `--limit <n>` and `--json` apply to `--list`. The merged-mode JSON shape is
  `{local: [...], remoteOnly: [...], remoteError: string | null}`. Pass
  `--local --json` for the flat array of local rows.

Inherits the same flags as `/cursor:task`: `--write`, `--background`, `--force`,
`--cloud`, `--model <id[:k=v,...]>`, `--timeout <ms>`, `--json`.

Model resolution: `--model` flag > `CURSOR_MODEL` env > persisted default
(set via `/cursor:setup --set-model <id[:k=v,...]>`) > built-in fallback.

Append `:key=value[,key=value]` to a model id to set variant params such as
reasoning effort (e.g. `--model gpt-5:reasoning_effort=low`). See
`/cursor:setup` for the catalog of available models and variants.

Default policy is read-only — pass `--write` to allow file modifications.

Return the command stdout verbatim, exactly as-is. Do not paraphrase,
summarize, or add commentary.

If the command fails with an authentication error or missing API key, tell
the user to run `/cursor:setup`.

If `--list` returns `(no resumable agents)`, the workspace has no recorded
agentIds yet — tell the user to start with `/cursor:task` first.
