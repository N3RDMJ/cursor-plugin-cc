# Changelog

All notable changes to this project are documented here.

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
