# Cursor Prompt Anti-Patterns

Avoid these when prompting Cursor / composer-2.

## Vague task framing

Bad:

```text
Take a look at this and let me know what you think.
```

Better:

```xml
<task>
Review this change for material correctness and regression risks.
</task>
```

## Missing output contract

Bad:

```text
Investigate and report back.
```

Better:

```xml
<structured_output_contract>
Return:
1. root cause
2. evidence (file:line)
3. smallest safe next step
</structured_output_contract>
```

## No follow-through default

Bad:

```text
Debug this failure.
```

Better:

```xml
<default_follow_through_policy>
Keep going until you have enough evidence to identify the root cause
confidently.
</default_follow_through_policy>
```

## Asking for more reasoning instead of a better contract

Bad:

```text
Think harder. Be very thorough. Don't miss anything.
```

Better:

```xml
<verification_loop>
Before finalizing, verify the answer matches the observed evidence and
the task requirements.
</verification_loop>
```

## Mixing unrelated jobs in one run

Bad:

```text
Review this diff, fix the bug you find, update the docs, and suggest a
roadmap.
```

Better:

- One job per run.
- Run the review, then run a fix prompt with `--resume-last`, then start
  a fresh task for docs.

## Pasting whole files

Bad:

```text
Here's the entire auth.ts file: ...
```

Better:

- Cursor has the workspace. Reference paths instead.
- Pass `--prompt-file` for long task statements; don't inline file bodies.

## Telling Cursor which tools to use

Bad:

```text
Use grep then read then edit then run tests.
```

Better:

- State the goal and the success signal.
- Let the agent choose its tools.

## Unsupported certainty

Bad:

```text
Tell me exactly why production failed.
```

Better:

```xml
<grounding_rules>
Ground every claim in the provided context or tool outputs.
Label hypotheses as hypotheses.
</grounding_rules>
```

## Stale resume

Bad: continuing on `--resume-last` after the direction has changed
materially. The prior thread still carries the old framing and Cursor
will drift.

Better: start a fresh `task` run when the goal has changed, even if the
repository is the same.

## Restating a long prompt on resume

Bad: pasting the original 2000-token prompt verbatim alongside a tiny
follow-up.

Better: send only the delta instruction. The previous turn is still in
the agent's context.
