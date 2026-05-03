#!/usr/bin/env bash
# Store a Cursor API key in the OS keychain for cursor-plugin-cc.
# Run from any terminal: ./plugins/cursor/scripts/cursor-login.sh

# Resolve symlinks so this works when invoked via ~/.claude/cursor-login
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

exec node "$PLUGIN_ROOT/scripts/bundle/cursor-companion.mjs" setup --login
