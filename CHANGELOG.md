# Changelog

All notable changes to this project are documented here.

## v1.1.0 - 2026-05-03

### Added

- Added support for model variant params (effort level) in `--model`, `--set-model`, and `CURSOR_MODEL`. Use `id[:k=v,k=v]` syntax — for example `--model gpt-5:reasoning_effort=low` or `/cursor:setup --set-model gpt-5:reasoning_effort=high,verbosity=low`. The setup report's "Default" row and "Available models" list now display canonical selectors that round-trip back into `--set-model`.
- Added `validateModel` param-key/value validation against the catalog's `parameters` schema, so `--set-model gpt-5:reasoning_effort=extreme` fails fast with the allowed values listed.

### Changed

- A malformed `CURSOR_MODEL` env var now emits a one-line stderr warning and falls through to the persisted default, instead of being silently ignored.
- An explicit empty value (`--model ""` / `--set-model ""`) now throws a clear `UsageError` instead of being silently ignored.

## v1.0.2 - 2026-05-03

### Changed

- Made `~/.claude/cursor-login` the primary recommended setup path for storing the Cursor API key in the OS keychain.
- Clarified the README and `/cursor:setup` guidance with explicit keychain and environment-variable commands.
- Improved `--login` failure output with keychain troubleshooting, including WSL/Linux Secret Service package guidance.

## v1.0.1 - 2026-05-03

### Added

- Added `~/.claude/cursor-login` as a convenience helper for local, masked API-key entry.
- Added explicit plugin manifest versioning so installed plugins update only when the release version changes.
- Added release workflow validation that requires the `v*` tag to match `plugins/cursor/.claude-plugin/plugin.json`.

### Changed

- Improved `/cursor:setup --login` typing feedback by showing `*` per character with working backspace.
- Updated setup onboarding to strongly recommend `CURSOR_API_KEY` or `~/.claude/cursor-login` instead of pasting API keys into Claude Code chat.
- Updated README quick start with a simple copy/edit/paste command for setting `CURSOR_API_KEY`.
- Bumped `@cursor/sdk` from `1.0.11` to `1.0.12`.

### Fixed

- Fixed `~/.claude/cursor-login` symlink resolution so the helper works when invoked through the bootstrap-created symlink.

## v1.0.0 - 2026-05-03

### Added

- Initial 1.0.0 release of the Cursor plugin for Claude Code.
