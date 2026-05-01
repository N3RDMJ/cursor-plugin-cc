---
description: Validate the cursor-plugin-cc runtime — Node, API key, account, models. Manage credentials and the Stop review gate.
argument-hint: '[--login|--logout] [--enable-gate|--disable-gate] [--set-model <id>|--clear-model] [--json]'
allowed-tools: Bash(node:*), Bash(printf:*), Bash(rm:*)
---

# /cursor:setup

## When `--login` is passed

Do NOT run the CLI directly. Present **two options** to the user:

### Option A — Secure hidden input (recommended)

Tell the user they can enter their key securely via hidden input by running
this command in their Claude Code prompt. Present it ready to copy:

```
! node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" setup --login
```

The key never appears in the conversation — it is read as hidden terminal
input, validated via `Cursor.me()`, and stored in the OS keychain.

### Option B — Paste in chat (convenient)

If the user prefers, they can paste the key directly in the conversation.
Warn them: "Note: the key will be visible in this conversation's transcript.
It is sent to the Cursor API for validation and stored in your OS keychain."

Once the user provides the key, write it to a temp file and pipe it to the
CLI so it stays out of process arguments:

```bash
printf '%s' '<THE_KEY>' > /tmp/.cursor-key-$$ && node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" setup --login < /tmp/.cursor-key-$$ ; rm -f /tmp/.cursor-key-$$
```

Report the result to the user. If it succeeded, tell them the key is stored
in their OS keychain. If it failed, relay the error.

**Do not** echo the key back or include it in any output beyond the command.

## When `--logout` is passed

Run the CLI directly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" setup --logout
```

Surface the output verbatim to the user.

## All other flags (default self-check)

Run the CLI directly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" setup $ARGUMENTS
```

Pass `--json` for machine-readable output. If anything fails (API key missing,
network error, model catalog empty), the exit code is non-zero and the failure
rows print on stdout. No further action needed — surface the output verbatim
to the user.

## Credential management

The plugin resolves the Cursor API key in this order:

1. `process.env.CURSOR_API_KEY`
2. OS keychain (macOS Keychain, Linux Secret Service via `secret-tool`)
3. Error with setup instructions

Manage the keychain credential via:

- `--login` — two paths: hidden terminal input (secure, recommended) or
  paste-in-chat (convenient). Both validate via `Cursor.me()` and store in
  the OS keychain.
- `--logout` — remove the stored key from the OS keychain.

The setup output's "API key" row reports the active key source (`env`,
`keychain`, or an error message). The `--json` output includes `apiKey.source`.

## Stop review gate

The Stop review gate is opt-in per workspace. When enabled, every time
Claude Code is about to stop, a Cursor agent reviews the working-tree diff
and may block the stop with `needs-attention` findings. Toggle it via:

- `--enable-gate` — turn the gate on for the current workspace
- `--disable-gate` — turn the gate off

The setup output's "Stop gate" row reports the current state.

## Default model

When `/cursor:task`, `/cursor:resume`, or any other command runs without an
explicit `--model <id>`, the plugin resolves a default in this order:

1. `--model <id>` flag on the command (per-invocation override)
2. `CURSOR_MODEL` environment variable
3. The persisted user-wide default (set via `--set-model`)
4. Built-in fallback (`composer-2`)

Manage the persisted default via `/cursor:setup`:

- `--set-model <id>` — validate `<id>` against the live catalog and persist
  it as the default for every workspace. Subsequent runs use it unless
  overridden.
- `--clear-model` — remove the persisted default and revert to the built-in
  fallback.

The setup output's "Default" row shows the active model id and where it
came from (`from --model`, `from CURSOR_MODEL env`, `from persisted default`,
or `built-in fallback`).
