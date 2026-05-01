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

CRITICAL: After presenting review or task findings, STOP. Do not make any
code changes. Do not fix any issues. You MUST explicitly ask the user which
issues, if any, they want fixed before touching a single file. Auto-applying
fixes from a review or task output is strictly forbidden, even if the fix
is obvious.

# Reviews

For `/cursor:review` and `/cursor:adversarial-review`:

1. Lead with the **verdict** (`approve` / `needs-attention`).
2. Quote findings ordered by severity (critical → high → medium → low).
3. Include `file:line` for each finding — it's the high-signal bit.
4. Don't filter out low-severity items unless the user asked to.

# Failure handling

- For `cursor:cursor-rescue`, do not turn a failed or incomplete Cursor run
  into a Claude-side implementation attempt. Report the failure and stop.
- If Cursor was never successfully invoked, do not generate a substitute
  answer at all.
- If the helper reports that setup or authentication is required, direct the
  user to `/cursor:setup` and do not improvise alternate auth flows.

# Evidence boundaries

- Preserve evidence boundaries. If Cursor marked something as an inference,
  uncertainty, or follow-up question, keep that distinction.
- Do not promote Cursor's tentative suggestions into definitive statements.

# Caveats to flag

- **Background runs**: the CLI returns the job id immediately. Tell the user
  to check `/cursor:status` and `/cursor:result <id>` later — don't pretend
  the run is done.
- **Cancelled / expired**: the job did not complete. Show whatever partial
  log was captured.
- **Parse failures**: when review JSON parsing fails, the CLI prints the
  raw output. Pass it through unmodified — don't try to extract structure
  yourself.
