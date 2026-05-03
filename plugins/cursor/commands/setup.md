---
description: Validate the cursor-plugin-cc runtime — Node, SDK, API key, account, models. Manage credentials and the Stop review gate.
argument-hint: '[--install] [--login|--logout] [--enable-gate|--disable-gate] [--set-model <id>|--clear-model] [--json]'
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:setup

## When `--install` is passed

Run the CLI directly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" setup --install
```

This reruns `npm install --omit=dev` in the plugin root and persists a status
file alongside the plugin's `node_modules/`. Use it when the SDK row in the
default report is `fail` (typical cause: the `SessionStart` bootstrap hook
hit a network or permissions error and silently swallowed it).

Surface the output verbatim. On success the next `/cursor:setup` should show
`SDK | ok |`.

## When `--login` is passed

Do **not** ask for the Cursor API key in chat by default. First give a strong
warning and recommend one of the local setup paths:

"Do not paste your Cursor API key into this Claude Code conversation unless you
are comfortable with it being visible in the session transcript and sent through
Claude Code's normal prompt flow. The safer options are:

1. Run `~/.claude/cursor-login` from a separate terminal, which prompts locally
   with masked input and stores the key in the OS keychain.
2. Set it once in your shell profile as `CURSOR_API_KEY`, then restart Claude Code."

Show the script command as the recommended `--login` path:

```
~/.claude/cursor-login
```

If the user wants the environment-variable path instead, give them a readable
command they can copy, replace the placeholder value in, and run in their normal
terminal:

```bash
echo 'export CURSOR_API_KEY="YOUR_CURSOR_API_KEY_HERE"' >> ~/.bashrc
```

Tell them to replace `YOUR_CURSOR_API_KEY_HERE` with their Cursor API key, use
`~/.zshrc` instead if they use zsh, and start a new Claude Code session
afterward.

If the user asks to paste the key into chat anyway, repeat that this exposes the
key to the Claude Code transcript and normal prompt flow. Do not handle the key
in-chat unless the user explicitly accepts that risk; prefer directing them to
the local script or environment-variable setup.

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
rows print on stdout. Surface the output verbatim to the user.

If the **SDK** row is `fail`, recommend `/cursor:setup --install` as the
remediation. The default report includes a remediation hint at the bottom in
that case.

If the **API key** row is `fail`, do **not** immediately ask the user to paste
their Cursor API key. Recommend the set-once options first:

1. `~/.claude/cursor-login` in a separate terminal for local masked input and OS
   keychain storage.
2. `CURSOR_API_KEY` in their shell profile, then restart Claude Code.

Mention paste-in-chat only as a last resort, with the strong warning from the
`--login` section.

## Credential management

The plugin resolves the Cursor API key in this order:

1. `process.env.CURSOR_API_KEY`
2. OS keychain (macOS Keychain, Linux Secret Service via `secret-tool`)
3. Error with setup instructions

Manage the keychain credential via:

- `--login` — recommended set-once keychain path. Prefer `~/.claude/cursor-login`
  from a separate terminal so the key is entered locally with masked input.
- `CURSOR_API_KEY` — environment-variable fallback. Add it to a shell profile or
  a local environment manager before starting Claude Code.
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
