---
description: Delegate investigation, an explicit fix request, or follow-up task to a Cursor agent
argument-hint: "[--background|--wait] [--resume-last|--fresh] [--model <id>] [--write] [what Cursor should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
disable-model-invocation: true
---

Invoke the `cursor:cursor-rescue` subagent via the `Agent` tool (`subagent_type: "cursor:cursor-rescue"`), forwarding the raw user request as the prompt.
`cursor:cursor-rescue` is a subagent, not a skill — do not call `Skill(cursor:cursor-rescue)` or `Skill(cursor:rescue)`. The command runs inline so the `Agent` tool stays in scope.
The final user-visible response must be Cursor's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `cursor:cursor-rescue` subagent in the background.
- If the request includes `--wait`, run the `cursor:cursor-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model` is a runtime-selection flag. Preserve it for the forwarded `task` call, but do not treat it as part of the natural-language task text.
- If the request includes `--resume-last`, do not ask whether to continue. The user already chose.
- If the request includes `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting Cursor, check for a resumable agent from this workspace by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" resume --list --json --limit 1 2>/dev/null
```

- If that command outputs a non-empty agent list (at least one agent ID), use `AskUserQuestion` exactly once to ask whether to continue the current Cursor thread or start a new one.
- The two choices must be:
  - `Continue current Cursor thread`
  - `Start a new Cursor thread`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current Cursor thread (Recommended)` first.
- Otherwise put `Start a new Cursor thread (Recommended)` first.
- If the user chooses continue, add `--resume-last` before routing to the subagent.
- If the user chooses a new thread, do not add `--resume-last`.
- If the helper reports no available agent, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Cursor companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll `/cursor:status`, fetch `/cursor:result`, call `/cursor:cancel`, summarize output, or do follow-up work of its own.
- Leave model unset unless the user explicitly asks for one.
- Leave `--resume-last` and `--fresh` in the forwarded request. The subagent handles that routing when it builds the `task` command.
- If the helper reports that Cursor is not configured or `CURSOR_API_KEY` is missing, stop and tell the user to run `/cursor:setup`.
- If the user did not supply a request, ask what Cursor should investigate or fix.

Model resolution: `--model` flag > `CURSOR_MODEL` env > persisted default (set via `/cursor:setup --set-model <id>`) > built-in fallback.
