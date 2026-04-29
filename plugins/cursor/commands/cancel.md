---
description: Cancel an active cursor-plugin-cc job.
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

# /cursor:cancel

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/dist/cursor-companion.mjs cancel $ARGUMENTS
```

Required: a job id.

If the run is in-process, calls `run.cancel()` (capability-checked). If the
run was started in `--background` mode by a different CLI invocation, the
in-memory Run object is gone — the job record is marked cancelled with
`reason: "run-not-active"`, but the underlying SDK run may still be live.

Exit code 0 on cancel, 1 on any failure with a reason printed to stderr.
