# Cursor Plugin for Claude Code

[![CI](https://github.com/N3RDMJ/cursor-plugin-cc/actions/workflows/ci.yml/badge.svg)](https://github.com/N3RDMJ/cursor-plugin-cc/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js->=18-3c873a?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

Use [Cursor](https://cursor.com) as a second AI agent from inside [Claude Code](https://claude.ai/code) — for code reviews, task delegation, and background jobs.

## Why?

- **Stay in your flow.** Reviews and tasks run from the same terminal where you're already working with Claude. No window-switching.
- **Two models, one conversation.** Claude frames the task with full conversation context, Cursor executes it, Claude acts on the result.
- **Background jobs.** Kick off a long-running Cursor task with `--background`, keep working, check back with `/cursor:status`.
- **Structured reviews.** Machine-readable verdicts (`approve` / `needs-attention`) with line-level findings that Claude can act on directly.
- **Automatic context.** The plugin reads your `git diff`, detects your branch, resolves your workspace root, and passes it all to Cursor.

## Prerequisites

- [Cursor](https://cursor.com) subscription with API access ([docs](https://docs.cursor.com/agents))
- [Node.js](https://nodejs.org) 18+

## Quick Start

**Install the plugin:**

```bash
/plugin marketplace add /path/to/cursor-plugin-cc
/plugin install cursor@cursor-plugin-cc
/reload-plugins
```

**Set up your API key once:**

Recommended: store the key in your OS keychain with the local helper. Run this
from a normal terminal (outside Claude Code); it prompts with masked input and
keeps the key out of Claude Code chat:

```bash
~/.claude/cursor-login
```

If you prefer an environment variable, copy this command, replace
`YOUR_CURSOR_API_KEY_HERE` with your actual Cursor API key, then paste it into
your normal terminal:

```bash
echo 'export CURSOR_API_KEY="YOUR_CURSOR_API_KEY_HERE"' >> ~/.bashrc
```

Use `~/.zshrc` instead of `~/.bashrc` in the command if you use zsh.

If keychain storage fails on WSL/Linux, install Secret Service support and retry:

```bash
sudo apt-get install gnome-keyring libsecret-tools dbus-user-session
```

> [!WARNING]
> Avoid pasting API keys into Claude Code conversations. Chat-pasted keys can be
> visible in session transcripts and travel through Claude Code's normal prompt
> flow. Use `CURSOR_API_KEY` or `~/.claude/cursor-login` instead.

**Verify:**

```bash
/cursor:setup
```

**First run:**

```bash
/cursor:review --background
/cursor:status
/cursor:result
```

## Commands

### `/cursor:review`

Structured read-only code review. Returns an `approve` or `needs-attention` verdict with line-level findings.

```bash
/cursor:review                    # uncommitted changes
/cursor:review --base main        # branch diff against main
/cursor:review --staged           # staged changes only
/cursor:review --background       # run in background
```

> [!NOTE]
> Multi-file reviews can take a while. Use `--background` for larger diffs.

### `/cursor:adversarial-review`

Steerable review that challenges design choices, assumptions, and tradeoffs — not just defects.

```bash
/cursor:adversarial-review
/cursor:adversarial-review --base main challenge whether this caching design is right
/cursor:adversarial-review --background look for race conditions
```

### `/cursor:task`

Delegate an implementation task to Cursor. Read-only by default — pass `--write` to allow file modifications.

```bash
/cursor:task "Refactor auth to use async/await"
/cursor:task "Fix the flaky test" --write
/cursor:task "Investigate the build failure" --background
/cursor:task --prompt-file spec.md --write
/cursor:task "Quick analysis" --model claude-4-opus --timeout 60000
```

You can also ask naturally:

```
Ask Cursor to redesign the database connection to be more resilient.
```

> [!NOTE]
> Long tasks benefit from `--background`. Check progress with `/cursor:status`.

### `/cursor:resume`

Continue a conversation with an existing Cursor agent.

```bash
/cursor:resume --list                          # discover agent IDs
/cursor:resume --list --remote                 # query SDK for durable agents
/cursor:resume agent-abc123 "now do X"         # continue a specific agent
/cursor:resume --last "and then Y" --write     # follow up on most recent run
```

Accepts all `/cursor:task` flags (`--write`, `--background`, `--model`, etc.).

### `/cursor:status`

Show running and recent jobs for the current workspace.

```bash
/cursor:status                                 # job table
/cursor:status task-abc123                     # single job detail
/cursor:status task-abc123 --wait              # block until finished
```

Supports `--type`, `--status`, `--limit` filters and `--json` output.

### `/cursor:result`

Retrieve the final output for a finished job. Defaults to the most recent terminal job.

```bash
/cursor:result                    # most recent finished job
/cursor:result task-abc123        # specific job
/cursor:result --log              # streaming event log
```

### `/cursor:cancel`

Cancel an active background job.

```bash
/cursor:cancel                    # cancel most recent active job
/cursor:cancel task-abc123        # cancel specific job
```

### `/cursor:setup`

Validate runtime configuration and manage credentials, the review gate, and the default model.

```bash
/cursor:setup                     # self-check
/cursor:setup --login             # store API key in OS keychain (local terminal recommended)
/cursor:setup --logout            # remove stored key
/cursor:setup --install           # reinstall SDK dependencies
/cursor:setup --enable-gate       # enable Stop review gate
/cursor:setup --disable-gate      # disable Stop review gate
/cursor:setup --set-model <id>    # set persistent default model
/cursor:setup --clear-model       # revert to built-in default
```

> [!TIP]
> For the keychain login flow, run `~/.claude/cursor-login` directly from a
> normal terminal instead of `/cursor:setup --login` inside Claude Code. The
> standalone script prompts with masked input locally, so your API key never
> passes through Claude Code's chat. It's a thin wrapper around
> `plugins/cursor/scripts/cursor-login.sh` and is symlinked into `~/.claude/`
> by the plugin's bootstrap step.

## Stop Review Gate

An opt-in hook that runs a Cursor review every time Claude is about to stop. If the review finds critical issues, the stop is blocked so Claude can address them first.

```bash
/cursor:setup --enable-gate
/cursor:setup --disable-gate
```

> [!WARNING]
> The review gate can create a long-running Claude/Cursor loop. It counts against your Cursor usage. Only enable it when actively monitoring the session.

## Typical Flows

**Review before shipping:**
```bash
/cursor:review
```

**Hand a problem to Cursor:**
```bash
/cursor:task "investigate why the build is failing" --write
```

**Background work:**
```bash
/cursor:task "investigate the flaky test" --background
/cursor:status
/cursor:result
```

**Get a second opinion:**
```bash
/cursor:adversarial-review --base main
```

## How It Works

The plugin wraps [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk) to communicate with Cursor's agent runtime. It manages the full lifecycle: agent creation, streaming events, job persistence, and session cleanup.

### Credential Resolution

| Priority | Source |
|----------|--------|
| 1 | `CURSOR_API_KEY` environment variable |
| 2 | OS keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager) |
| 3 | Error with setup instructions |

For the easiest durable setup, put `CURSOR_API_KEY` in your shell profile or use
`~/.claude/cursor-login` once to store it in the OS keychain. API keys are
scrubbed from plugin logs and error output, but you should still avoid pasting
keys into Claude Code chat because chat text can appear in session transcripts.

### Model Resolution

| Priority | Source |
|----------|--------|
| 1 | `--model` flag on the command |
| 2 | `CURSOR_MODEL` environment variable |
| 3 | Persisted default (`/cursor:setup --set-model`) |
| 4 | Built-in fallback (`composer-2`) |

### State and Storage

Job state persists across sessions:

```
~/.claude/cursor-plugin/<workspace-slug>/
  state.json          # job index (50 most recent)
  <jobId>.json        # per-job result
  <jobId>.log         # streaming event log
  session.json        # session metadata
  gate.json           # review gate config
```

Override the root with `CURSOR_PLUGIN_STATE_ROOT`.

### Agent Handoff

Delegated tasks can be resumed from either surface:

- **Claude Code:** `/cursor:resume <agent-id>`
- **Cursor CLI:** `cursor-agent resume <agent-id>`

`/cursor:status` and `/cursor:result` print these handoff hints inline.

### Session Cleanup

When Claude Code's `SessionEnd` fires, the plugin cancels any still-active jobs for the workspace to prevent orphan agents from burning Cursor usage. Set `CURSOR_PLUGIN_KEEP_BACKGROUND_JOBS=1` to opt out.

## Development

Load the plugin directly from your working tree during development:

```bash
claude --plugin-dir ./plugins/cursor
```

Edit files, then `/reload-plugins` inside the session. No install or cache involved.

```bash
npm test              # unit + CLI tests (369 tests)
npm run typecheck     # tsc --noEmit
npm run check         # Biome lint + format
npm run build         # tsc + esbuild bundle
```

### Releasing

Tag-driven via GitHub Actions. Push a `v*` tag to run CI and create a release:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The plugin uses explicit semver in `plugins/cursor/.claude-plugin/plugin.json`.
Claude Code only updates installed users when that `version` changes, so commits
landing on `main` do not auto-load unless they are part of a version bump. The
release workflow validates that the `v*` tag matches the plugin manifest version.

## FAQ

**Do I need a separate Cursor account?**
Yes. The plugin requires a Cursor subscription with API access.

**Does the plugin modify my files?**
Only with explicit `--write`. All review commands are read-only.

**What models can I use?**
Run `/cursor:setup` to see your account's available models. Default is `composer-2`.

**Will the review gate drain my usage?**
It can. The gate runs a Cursor review on every Claude Stop. Only enable it when actively monitoring.
