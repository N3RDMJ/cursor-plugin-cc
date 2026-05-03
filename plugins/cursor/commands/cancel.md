---
description: Cancel an active cursor-plugin-cc job.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:cancel

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/bundle/cursor-companion.mjs cancel $ARGUMENTS
```

Required: a job id.

**Clean cancel:** if the run is owned by this CLI process, calls
`run.cancel()` (capability-checked) and the agent stops.

**Split-brain limitation:** if the run was started in `--background` mode by a
different CLI invocation, the in-memory Run object is gone. The job record is
marked `cancelled` with `reason: "run-not-active"`, but the underlying SDK
run may keep going to completion. The companion prints a warning to stderr
when this happens and the JSON shape includes `"splitBrain": true`. To
actually stop the work, use `/cursor:resume <agent-id>` to reattach and send
a stop prompt — the agent id is on the job record (`/cursor:status <job-id>`).

Exit code 0 on cancel, 1 on any failure with a reason printed to stderr.
