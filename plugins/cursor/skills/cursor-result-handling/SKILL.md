---
name: cursor-result-handling
description: How to present Cursor agent output back to the user. Loaded automatically when processing results from cursor-companion.
---

# Default behavior

When a Cursor task finishes (via `cursor-rescue` or `/cursor:task`):

1. **Show the deliverables verbatim**. Don't paraphrase the agent's
   summary; the user wants to see what Cursor actually said.
2. **Surface the exit code**. If non-zero, lead with that and the reason
   (timeout, cancelled, expired, parse error).
3. **List file changes**. If `--write` was on, the diff lives in the
   workspace. Run `git status` and show what was modified — don't claim
   "Cursor edited X" without verifying.

# Reviews

For `/cursor:review` and `/cursor:adversarial-review`:

1. Lead with the **verdict** (`approve` / `needs-attention`).
2. Quote findings ordered by severity (critical → high → medium → low).
3. Include `file:line` for each finding — it's the high-signal bit.
4. Don't filter out low-severity items unless the user asked to.

# Caveats to flag

- **Background runs**: the CLI returns the job id immediately. Tell the user
  to check `/cursor:status` and `/cursor:result <id>` later — don't pretend
  the run is done.
- **Cancelled / expired**: the job did not complete. Show whatever partial
  log was captured.
- **Parse failures**: when review JSON parsing fails, the CLI prints the
  raw output. Pass it through unmodified — don't try to extract structure
  yourself.
