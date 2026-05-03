#!/usr/bin/env bash
# Store a Cursor API key in the OS keychain for cursor-plugin-cc.
# Run from any terminal: ./plugins/cursor/scripts/cursor-login.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

exec node "$PLUGIN_ROOT/scripts/bundle/cursor-companion.mjs" setup --login
