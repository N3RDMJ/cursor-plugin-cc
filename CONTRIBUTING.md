# Contributing to cursor-plugin-cc

Thanks for taking the time to look. This file covers the dev loop, how tests are organized, and
the small-but-firm conventions for commits and PRs.

## Dev setup

```bash
npm ci                         # install deps + bootstrap husky
npm run typecheck              # tsc --noEmit
npm run check                  # biome check (lint + format, read-only)
npm run check:fix              # biome check --write (autofix)
npm run build                  # tsc -p tsconfig.build.json (writes .mjs into scripts/dist/)
npm run test                   # vitest run
npm run test:watch             # vitest in watch mode
```

You don't need a Cursor API key for the unit and CLI test suites — only the `tests/integration/`
suite touches the real SDK and it auto-skips when `CURSOR_API_KEY` is not set.

To exercise the live SDK locally:

```bash
export CURSOR_API_KEY=key_...
npx vitest run tests/integration/
```

## Project layout

- `plugins/cursor/scripts/**/*.mts` — all runtime code (TypeScript, ESM-only)
- `plugins/cursor/commands/*.md` — slash command markdown (prompt docs, not executable)
- `plugins/cursor/agents/*.md` — subagent forwarders
- `plugins/cursor/skills/**/SKILL.md` — context docs Claude reads
- `tests/unit/` — fast unit tests against single modules
- `tests/cli/` — exercises the full subcommand pipelines with the mocked SDK
- `tests/integration/` — live SDK; gated behind `CURSOR_API_KEY`
- `tests/helpers/` — shared mock factory and IO sinks
- `tests/fixtures/` — canned diffs, reviews, jobs

`PLAN.md` is the source of truth for outstanding work. When you finish a checklist item, tick the
box in the same change that lands the work — the project enforces this convention through code
review.

## Conventions

- **No `any`, `@ts-ignore`, or `@ts-expect-error`.** Biome enforces the first; the others are
  caught in review.
- **No emojis in code or commit messages.**
- **Conventional commits** for every commit and PR title:
  `feat: …`, `fix: …`, `chore: …`, `refactor: …`, `test: …`, `docs: …`, `ci: …`, `build: …`,
  `perf: …`, `style: …`, `revert: …`. Husky enforces the format on commit; CI enforces it on PR
  titles.
- **Slash commands and subagents stay thin.** All logic belongs in `scripts/` so it's typed and
  tested. Markdown docs build one shell command and forward stdout.
- **Comments are sparse.** Only add a comment when the *why* is non-obvious — invariants,
  workarounds, hidden constraints. Don't restate what the code does.

## Running the plugin during development

```bash
npm run build
node plugins/cursor/scripts/dist/cursor-companion.mjs setup
node plugins/cursor/scripts/dist/cursor-companion.mjs status
```

To install the local build into Claude Code for end-to-end testing:

```text
/plugin marketplace add /absolute/path/to/cursor-plugin-cc
/plugin install cursor@cursor-plugin-cc
```

## Pull requests

1. Branch from `main` (`feat/short-name`, `fix/...`, etc.).
2. Keep PRs focused — one feature or one fix.
3. Update `PLAN.md` in the same commit that implements the work it tracks.
4. Run `npm run check && npm run typecheck && npm test` before pushing.
5. CI runs `check → typecheck → build → test` on Node 22. The integration job runs only on `main`
   pushes when `CURSOR_API_KEY` is configured as a repo secret.

## Releases

This package is **not** published to npm — it's distributed as a Claude Code plugin via the
top-level `.claude-plugin/marketplace.json`. To cut a release:

1. Bump `version` in `plugins/cursor/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
2. Commit (`chore: release vX.Y.Z`).
3. Tag (`git tag vX.Y.Z && git push --tags`).
4. Create a GitHub release with notes.

That's all — `/plugin install` reads from the marketplace manifest at the tagged ref.

## Reporting issues

Open a GitHub issue with: what you ran, what you expected, what happened, and the output of
`/cursor:setup --json`. If the failure was during a job, include the contents of the relevant
`~/.claude/cursor-plugin/<workspace>/<jobId>.log` (it's already scrubbed of your API key).
