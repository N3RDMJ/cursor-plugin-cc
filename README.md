# Cursor plugin for Claude Code

Use Cursor from inside Claude Code for code reviews or to delegate tasks to Cursor's AI agent.

This plugin is for Claude Code users who want an easy way to use Cursor from the workflow they already have.

## Why a Plugin Instead of Just the CLI?

Cursor has its own editor and CLI, so why wrap it in a Claude Code plugin?

- **Stay in your flow.** You don't have to switch windows or learn a separate tool. Reviews and tasks run from the same terminal session where you're already working with Claude.
- **Two models, one conversation.** Claude sees the full conversation context. When it delegates to Cursor, it can frame the task precisely — and when Cursor comes back, Claude can act on the result immediately. You get a second opinion without copy-pasting context between tools.
- **Background jobs with zero setup.** Kick off a long-running Cursor task with `--background`, keep working with Claude, and check back with `/cursor:status`. No tmux, no second terminal.
- **Structured review output.** The plugin parses Cursor's review into a machine-readable verdict (`approve` / `needs-attention`) with line-level findings. Claude can read and act on these directly — or the Stop review gate can block automatically on critical issues.
- **Automatic context passing.** The plugin reads your `git diff`, detects your default branch, resolves your workspace root, and passes all of it to Cursor. You type `/cursor:review` and it just works.

If you already use Cursor standalone and don't need these integrations, you don't need this plugin. But if Claude Code is your primary workflow and you want Cursor as a second agent you can call on without context-switching, this is the shortest path.

## What You Get

- `/cursor:review` for a structured read-only review
- `/cursor:adversarial-review` for a steerable challenge review
- `/cursor:task`, `/cursor:resume`, `/cursor:status`, `/cursor:result`, and `/cursor:cancel` to delegate work and manage background jobs
- An optional **Stop review gate** that blocks Claude's Stop on critical findings

## Requirements

- **Cursor subscription with an API key.** See the [Cursor Agents docs](https://docs.cursor.com/agents) for how to provision one.
- **Node.js 18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add /path/to/cursor-plugin-cc
```

Install the plugin:

```bash
/plugin install cursor@cursor-plugin-cc
```

Reload plugins:

```bash
/reload-plugins
```

Set up your API key using one of these options:

**Option A — Store in OS keychain (recommended)**

```bash
/cursor:setup --login
```

Claude will walk you through it — either via secure hidden input or by pasting the key in chat. The key is validated against the Cursor API and stored in your OS keychain.

**Option B — Environment variable**

```bash
export CURSOR_API_KEY=key_...
```

Then verify everything is working:

```bash
/cursor:setup
```

`/cursor:setup` will tell you whether Cursor is ready. It verifies Node.js, the API key, your account, and the available model catalog.

After install, you should see:

- the slash commands listed below
- the `cursor:cursor-rescue` subagent in `/agents`

One simple first run is:

```bash
/cursor:review --background
/cursor:status
/cursor:result
```

## Usage

### `/cursor:review`

Runs a structured Cursor review on your current work. Returns an `approve` or `needs-attention` verdict with line-level findings.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. Use `--staged` for staged-only changes. It also supports `--background` and `--json`. It is not steerable and does not take custom focus text. Use [`/cursor:adversarial-review`](#cursoradversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/cursor:review
/cursor:review --base main
/cursor:review --staged
/cursor:review --background
```

This command is read-only and will not perform any changes.

### `/cursor:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/cursor:review`, including `--base <ref>` for branch review. It also supports `--background` and `--json`. Unlike `/cursor:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, race conditions, or reliability

Examples:

```bash
/cursor:adversarial-review
/cursor:adversarial-review --base main challenge whether this was the right caching design
/cursor:adversarial-review --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/cursor:task`

Sends an implementation task to a Cursor agent.

Use it when you want Cursor to:

- implement a feature or refactor
- investigate a bug
- take a pass with a different model

By default the task runs **read-only** (analysis only). Pass `--write` to allow file modifications.

> [!NOTE]
> Depending on the task and the model, these tasks might take a long time. It's generally recommended to use `--background` or move the agent to the background.

Examples:

```bash
/cursor:task "Refactor the auth module to use async/await"
/cursor:task "Fix the flaky integration test" --write
/cursor:task "Investigate why the build fails" --background
/cursor:task --prompt-file spec.md --write
/cursor:task "Quick analysis" --model claude-4-opus --timeout 60000
```

You can also just ask for a task to be delegated to Cursor:

```text
Ask Cursor to redesign the database connection to be more resilient.
```

### `/cursor:resume`

Reattaches to an existing Cursor agent and continues the conversation.

Use it when you want to:

- follow up on a previous task
- send additional instructions to a running agent
- discover which agents are available

Examples:

```bash
/cursor:resume --list                          # discover agent IDs
/cursor:resume --list --remote                 # query the SDK for durable agents
/cursor:resume agent-abc123 "now do X"         # continue a specific agent
/cursor:resume --last "and then Y" --write     # follow up on the most recent run
```

It accepts all `task` flags (`--write`, `--background`, `--model`, etc.).

### `/cursor:status`

Shows running and recent Cursor jobs for the current workspace.

Examples:

```bash
/cursor:status
/cursor:status task-abc123
/cursor:status task-abc123 --wait              # block until the job finishes
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

Supports `--type`, `--status`, and `--limit` filters. Use `--wait` with `--timeout-ms` and `--poll-ms` to block until a job reaches a terminal state.

### `/cursor:result`

Shows the final stored output for a finished job.

Examples:

```bash
/cursor:result
/cursor:result task-abc123
```

### `/cursor:cancel`

Cancels an active background Cursor job.

Examples:

```bash
/cursor:cancel
/cursor:cancel task-abc123
```

### `/cursor:setup`

Checks whether Cursor is configured and ready. Verifies Node.js, `CURSOR_API_KEY`, your Cursor account, and the available model catalog.

You can also use `/cursor:setup` to manage the review gate and default model.

#### Enabling the review gate

```bash
/cursor:setup --enable-gate
/cursor:setup --disable-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Cursor review of Claude's working-tree changes. If that review finds critical issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Cursor loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

#### Setting a default model

```bash
/cursor:setup --set-model claude-4-opus
```

Resolution order: `--model` flag > `CURSOR_MODEL` env var > saved config > `composer-2`.

## Typical Flows

### Review Before Shipping

```bash
/cursor:review
```

### Hand a Problem to Cursor

```bash
/cursor:task "investigate why the build is failing" --write
```

### Start Something Long-Running

```bash
/cursor:adversarial-review --background
/cursor:task "investigate the flaky test" --background
```

Then check in with:

```bash
/cursor:status
/cursor:result
```

## Cursor Integration

The plugin wraps the [`@cursor/sdk`](https://www.npmjs.com/package/@cursor/sdk) to communicate with Cursor's agent runtime. Authentication uses your Cursor API key, resolved in this order: `CURSOR_API_KEY` env var, OS keychain (via `/cursor:setup --login`), or error with setup instructions. The key is scrubbed from all logs and error messages.

### State and Storage

Job state is persisted to the filesystem so results survive across sessions:

```
~/.claude/cursor-plugin/<workspace-slug>/
├── state.json          # job index (50 most recent)
├── <jobId>.json        # per-job result
├── <jobId>.log         # streaming event log
├── session.json        # current session metadata
└── gate.json           # review gate config
```

Override the root with `CURSOR_PLUGIN_STATE_ROOT` (useful for tests and development).

### Moving the Work Over to Cursor

Delegated tasks can be resumed directly in Cursor by using the agent ID from `/cursor:status` or `/cursor:result`. Use `/cursor:resume <agent-id>` to continue from Claude Code, or open the agent in Cursor's own UI.

## FAQ

### Do I need a separate Cursor account?

Yes. This plugin requires a Cursor subscription with API access. Run `/cursor:setup --login` to store your key in the OS keychain, or export it as `CURSOR_API_KEY`. Then run `/cursor:setup` to verify.

### Does the plugin modify my files?

Only when you explicitly pass `--write` to `/cursor:task` or `/cursor:resume`. All review commands are read-only.

### What models can I use?

Run `/cursor:setup` to see the available model catalog from your Cursor account. The default is `composer-2`, overridable via `--model`, `CURSOR_MODEL` env var, or `/cursor:setup --set-model`.

### Will the review gate drain my usage?

It can. The gate runs a Cursor review on every Claude Stop, which counts against your Cursor usage limits. Only enable it when you plan to actively monitor the session.
