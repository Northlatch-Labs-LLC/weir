#!/usr/bin/env bash
# Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
#
# Runs ONE beat: check the config against the rules, then one PicoClaw one-shot turn.
# No gateway, no listener, no long-running process. Exits with picoclaw's own exit code.
#
# Config path comes from $PICOCLAW_CONFIG (PicoClaw's own env var — see docs/guides/configuration.md).
# If unset, falls back to picoclaw/config.template.json relative to this package, which is a
# template and will not itself point at a real workspace on another machine — copy it first.
#
# THE LOCK. A single mkdir-based lock at runs/.lock refuses a second, overlapping beat rather than
# letting two picoclaw processes race the same workspace and config (Security finding A7). v1 read
# ANY mkdir failure as "another beat is running": on the droplet the runs directory was root-owned
# and the container ran as another uid, so every beat got EACCES, reported a phantom running beat
# and exited 75 — for ever, silently (CTO §1 defect 4). The two cases are now told apart by whether
# the lock directory exists after the failure, and they exit with different, named codes.
#
# THE CHILD'S ENVIRONMENT. PicoClaw is spawned under `env -i` with exactly the variables
# bin/check-rules.ts names in STDIO_ENV_ALLOWLIST, read from that file rather than repeated here.
# A stdio MCP server is a child of PicoClaw and inherits PicoClaw's environment; on the host that
# environment is where a decrypted model credential lives for the length of a beat. Everything not
# on the allow-list — including that credential — stops at this line (CTO §2.8a).

set -euo pipefail

# Exit codes, named. `sysexits.h` meanings, so an operator reading a systemd log knows which is
# which without reading this file.
EXIT_LOCK_BUSY=75         # EX_TEMPFAIL — EEXIST: another beat holds the lock. Try again later.
EXIT_LOCK_UNAVAILABLE=74  # EX_IOERR   — anything else (EACCES, EROFS, ENOENT): the lock could not
                          #              be created at all. This is a broken installation, not a
                          #              busy one, and retrying will never clear it.
EXIT_REFUSED=1            # a rule, a missing heartbeat file, or a picoclaw binary that is not there.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_PATH="${PICOCLAW_CONFIG:-$PACKAGE_ROOT/picoclaw/config.template.json}"
HEARTBEAT_FILE="${WEIR_AGENT_HEARTBEAT_FILE:-$PACKAGE_ROOT/picoclaw/workspace/HEARTBEAT.md}"
PICOCLAW_BIN="${PICOCLAW_BIN:-picoclaw}"
RUNS_DIR="${WEIR_AGENT_RUNS_DIR:-$PACKAGE_ROOT/runs}"
LOCK_DIR="$RUNS_DIR/.lock"

# The rule checker is TypeScript and runs with no build step: node strips the types itself. An
# image that ships a compiled checker overrides the whole command with WEIR_CHECK_RULES_CMD; the
# override is split on whitespace, so it is a command and its flags, not a path with spaces in it.
if [ -n "${WEIR_CHECK_RULES_CMD:-}" ]; then
  # shellcheck disable=SC2206
  CHECK_RULES=($WEIR_CHECK_RULES_CMD)
else
  CHECK_RULES=(node "$SCRIPT_DIR/check-rules.ts")
fi

mkdir -p "$RUNS_DIR"

# --- the lock -------------------------------------------------------------------------------
set +e
LOCK_ERR="$(mkdir "$LOCK_DIR" 2>&1)"
LOCK_STATUS=$?
set -e
if [ "$LOCK_STATUS" -ne 0 ]; then
  if [ -d "$LOCK_DIR" ]; then
    echo "beat.sh: refused — another beat is already running (lock held at $LOCK_DIR)" >&2
    exit "$EXIT_LOCK_BUSY"
  fi
  echo "beat.sh: refused — the lock at $LOCK_DIR could not be created and does not exist: $LOCK_ERR" >&2
  echo "beat.sh: this is not a busy beat. Check the owner and mode of $RUNS_DIR against the uid this beat runs as." >&2
  exit "$EXIT_LOCK_UNAVAILABLE"
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [ ! -f "$HEARTBEAT_FILE" ]; then
  echo "beat.sh: refused — heartbeat file not found at $HEARTBEAT_FILE" >&2
  exit "$EXIT_REFUSED"
fi

# The exact argv picoclaw is about to run, built once so the rule check inspects the real command
# line rather than its own (Security finding A6) — a checker that reads its own argv instead of
# the checked program's proves nothing.
PICOCLAW_ARGS=(agent -m "$(cat "$HEARTBEAT_FILE")")

echo "beat.sh: checking rules against $CONFIG_PATH" >&2
"${CHECK_RULES[@]}" "$CONFIG_PATH" -- "${PICOCLAW_ARGS[@]}"
# check-rules exits 1 and this script stops here (set -e) if any rule is violated.

# --- the child's environment ------------------------------------------------------------------
# One source of truth: the allow-list is read from the checker, never copied into this file.
ENV_ALLOWLIST="$("${CHECK_RULES[@]}" --print-stdio-env-allowlist)"

# `env -i` empties the environment, so picoclaw must be found before it is cleared.
PICOCLAW_PATH="$(command -v "$PICOCLAW_BIN" || true)"
if [ -z "$PICOCLAW_PATH" ]; then
  echo "beat.sh: refused — picoclaw binary \"$PICOCLAW_BIN\" is not on PATH" >&2
  exit "$EXIT_REFUSED"
fi

ENV_ASSIGNMENTS=()
while IFS= read -r VAR_NAME; do
  [ -z "$VAR_NAME" ] && continue
  # The list comes from a file in this package, but a name that is not a shell identifier would be
  # an assignment of some other shape; refuse rather than pass it on.
  if ! [[ "$VAR_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    echo "beat.sh: refused — \"$VAR_NAME\" is not a valid environment variable name" >&2
    exit "$EXIT_REFUSED"
  fi
  # PICOCLAW_CONFIG is set from this beat's own config path below, not inherited.
  [ "$VAR_NAME" = "PICOCLAW_CONFIG" ] && continue
  if [ -n "${!VAR_NAME+set}" ]; then
    ENV_ASSIGNMENTS+=("$VAR_NAME=${!VAR_NAME}")
  fi
done <<EOF
$ENV_ALLOWLIST
EOF
ENV_ASSIGNMENTS+=("PICOCLAW_CONFIG=$CONFIG_PATH")

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$RUNS_DIR/$TIMESTAMP.log"

echo "beat.sh: one beat, config=$CONFIG_PATH, log=$LOG_FILE" >&2

set +e
env -i "${ENV_ASSIGNMENTS[@]}" "$PICOCLAW_PATH" "${PICOCLAW_ARGS[@]}" >"$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

echo "beat.sh: picoclaw exited $EXIT_CODE, log at $LOG_FILE" >&2
exit "$EXIT_CODE"
