---
name: cursor-result-handling
description: How to present Cursor agent output back to the user. Loaded automatically when processing results from cursor-companion.
---

## Presenting Cursor Results

When you receive output from a Cursor agent run (via cursor-companion or the cursor-rescue subagent):

1. **Preserve structure** — Cursor's output includes tool calls, file edits, terminal output, and reasoning. Present them in order, preserving the original grouping.

2. **Stop after presenting** — Do not automatically apply fixes, run follow-up commands, or continue working based on Cursor's suggestions. Let the user decide next steps.

3. **Flag conflicts** — If Cursor's output contradicts your prior analysis, explicitly call out the disagreement and present both perspectives.

4. **Summarize findings, not process** — Show what Cursor found or changed, not the step-by-step of how it got there. Skip tool call noise unless it's diagnostically relevant.

5. **Attribute clearly** — Prefix Cursor's findings with "Cursor agent:" or similar so the user knows which agent produced which analysis.

## When Cursor Made File Changes (`--write` mode)

1. List all files modified with a one-line summary of each change
2. Run `lsp_diagnostics` on modified files
3. Run project tests if they exist
4. Report results — do not silently fix issues Cursor introduced
