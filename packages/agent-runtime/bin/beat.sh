#!/usr/bin/env bash
# Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
#
# Runs ONE beat: check the config against the rules, then one PicoClaw one-shot turn.
# No gateway, no listener, no long-running process. Exits with picoclaw's own exit code.
#
# Config path comes from $PICOCLAW_CONFIG (PicoClaw's own env var — see docs/guides/configuration.md).
# If unset, falls back to picoclaw/config.template.json relative to this package, which is a
# template and will not itself point at a real workspace on another machine — copy it first.
#
# A single mkdir-based lock at runs/.lock refuses a second, overlapping beat (exit 75, EX_TEMPFAIL)
# rather than letting two picoclaw processes race the same workspace and config (Security finding
# A7). The lock is released by the trap on every exit path, including a killed script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_PATH="${PICOCLAW_CONFIG:-$PACKAGE_ROOT/picoclaw/config.template.json}"
HEARTBEAT_FILE="${WEIR_AGENT_HEARTBEAT_FILE:-$PACKAGE_ROOT/picoclaw/workspace/HEARTBEAT.md}"
PICOCLAW_BIN="${PICOCLAW_BIN:-picoclaw}"
RUNS_DIR="$PACKAGE_ROOT/runs"
LOCK_DIR="$RUNS_DIR/.lock"

mkdir -p "$RUNS_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "beat.sh: refused — another beat is already running (lock held at $LOCK_DIR)" >&2
  exit 75
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [ ! -f "$HEARTBEAT_FILE" ]; then
  echo "beat.sh: refused — heartbeat file not found at $HEARTBEAT_FILE" >&2
  exit 1
fi

# The exact argv picoclaw is about to run, built once so the rule check inspects the real command
# line rather than its own (Security finding A6) — a checker that reads its own argv instead of
# the checked program's proves nothing.
PICOCLAW_ARGS=(agent -m "$(cat "$HEARTBEAT_FILE")")

echo "beat.sh: checking rules against $CONFIG_PATH" >&2
node "$SCRIPT_DIR/check-rules.mjs" "$CONFIG_PATH" -- "${PICOCLAW_ARGS[@]}"
# check-rules.mjs exits 1 and this script stops here (set -e) if any rule is violated.

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$RUNS_DIR/$TIMESTAMP.log"

echo "beat.sh: one beat, config=$CONFIG_PATH, log=$LOG_FILE" >&2

set +e
PICOCLAW_CONFIG="$CONFIG_PATH" "$PICOCLAW_BIN" "${PICOCLAW_ARGS[@]}" >"$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

echo "beat.sh: picoclaw exited $EXIT_CODE, log at $LOG_FILE" >&2
exit "$EXIT_CODE"
