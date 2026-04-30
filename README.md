# cursor-plugin-cc

A [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin that delegates implementation tasks
and code reviews to a [Cursor](https://cursor.com) AI agent via [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk).

Mirrors the architecture of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) but
targets Cursor instead of Codex.

## What you get

| Slash command | What it does |
|---------------|--------------|
| `/cursor:setup` | Verify Node, `CURSOR_API_KEY`, account, model catalog. Toggle the Stop review gate. |
| `/cursor:task <prompt>` | Send an implementation task to Cursor (read-only by default; pass `--write` to allow edits). |
| `/cursor:resume <agent-id\|--last\|--list> [prompt]` | Reattach to an existing Cursor agent and continue the conversation. |
| `/cursor:review` | Structured review of the working-tree diff (`approve` / `needs-attention` + findings). |
| `/cursor:adversarial-review` | Same shape, but the agent challenges design choices instead of hunting defects. |
| `/cursor:status [job-id]` | List recent jobs (or show one in detail). |
| `/cursor:result <job-id>` | Print the persisted output of a completed job. |
| `/cursor:cancel <job-id>` | Cancel an active run. |

A `cursor-rescue` subagent wraps `/cursor:task --write` for cases where Claude wants to delegate
a hard problem to Cursor in the middle of a turn.

The plugin also installs a **Stop review gate** (opt-in): when enabled, every Stop is gated on a
Cursor review of Claude's working-tree changes. Critical findings block the stop and Claude has to
address them before finishing.

## Requirements

- Node.js >= 18
- A Cursor API key (Cursor subscription required) — see
  [Cursor Agents docs](https://docs.cursor.com/agents) for how to provision one.
- Git (the plugin reads `git diff` / `git status` for context)

Export the key before launching Claude Code:

```bash
export CURSOR_API_KEY=key_...
```

## Installation

From this repository's marketplace:

```text
/plugin marketplace add /path/to/cursor-plugin-cc
/plugin install cursor@cursor-plugin-cc
```

After installation, run `/cursor:setup` to verify everything is wired up.

## Quick start

```text
/cursor:setup                       # confirm Node, API key, models
/cursor:task "Refactor auth module" --write
/cursor:review                      # review the working-tree diff
/cursor:status                      # see recent jobs
/cursor:result task-abcdef123456    # retrieve a job's output
```

### Stop review gate

```text
/cursor:setup --enable-gate         # turn on for this workspace
/cursor:setup --disable-gate        # turn off
```

The gate is per-workspace and disabled by default. State lives in
`~/.claude/cursor-plugin/<workspace-slug>/gate.json`.

## Subcommand flags

`task`:

| Flag | Effect |
|------|--------|
| `--write` | Allow file modifications (default: read-only analysis). |
| `--resume-last` | Resume the most recent task agent for this workspace. |
| `--background` | Start the run, return the job id, exit. |
| `--force` | Expire any wedged active local run before sending. |
| `--cloud` | Run against the detected GitHub origin in Cursor's cloud. |
| `--model <id>` | Override the default model (`composer-2`). |
| `--timeout <ms>` | Cancel if the run exceeds this duration. |
| `--json` | Emit the final result as a single JSON line. |

`resume`:

| Flag | Effect |
|------|--------|
| `--last` | Resume the most recent task agent for this workspace (skip `<agent-id>`). |
| `--list` | Print known agent ids for this workspace, then exit. |
| `--limit <n>` | With `--list`: cap the number of rows (default 10). |
| `--write`, `--background`, `--force`, `--cloud`, `--model <id>`, `--timeout <ms>`, `--json` | Same as `task`. |

```text
/cursor:resume --list                       # discover agent ids
/cursor:resume agent-abc123 "now do X"      # continue a specific agent
/cursor:resume --last "and then Y" --write  # follow up on the most recent run
```

`review` / `adversarial-review`:

| Flag | Effect |
|------|--------|
| `--staged` | Review only staged changes (`git diff --cached`). |
| `--base <ref>` | Diff against `<ref>` instead of the working tree. |
| `--model <id>`, `--timeout <ms>`, `--json` | Same as `task`. |

## Where state lives

```
~/.claude/cursor-plugin/<workspace-slug>/
├── state.json          # job index (50 most recent retained)
├── <jobId>.json        # per-job persisted result
├── <jobId>.log         # per-job streaming events
├── session.json        # current Claude Code session
└── gate.json           # per-workspace Stop review gate config
```

Override the root with `CURSOR_PLUGIN_STATE_ROOT=/some/path` (handy for tests and dev).

The plugin **never persists `CURSOR_API_KEY`** to disk. Error messages and per-job logs are
scrubbed of the key before they're written, so a transient SDK failure that happens to embed the
key in a request URL won't leak into job state.

## How it's organized

```
plugins/cursor/
├── .claude-plugin/plugin.json     # plugin manifest
├── commands/                       # /cursor:* slash command markdown
├── agents/                         # subagent forwarders
├── hooks/hooks.json                # SessionStart/End + Stop review gate
├── skills/                         # context docs Claude reads
├── scripts/                        # TypeScript runtime (.mts → .mjs)
│   ├── cursor-companion.mts        # CLI entry
│   ├── session-lifecycle-hook.mts
│   ├── stop-review-gate-hook.mts
│   ├── commands/                   # one handler per subcommand
│   └── lib/                        # cursor-agent, state, render, git, retry, …
└── package.json
```

Slash command markdown files are prompt instructions for Claude — they're not executable. All
runtime logic lives under `scripts/`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, test commands, and the conventional-commit
expectation.

## License

MIT — see [LICENSE](./LICENSE).
