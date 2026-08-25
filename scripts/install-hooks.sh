#!/usr/bin/env bash
# Point git at the tracked hooks. Run once per clone, and after any `git init`.
#
# .git/hooks is not version controlled, so the three guards this repository relies on — the secret
# scanner, the private-remote check and the commit-message check — do not exist in a fresh clone or
# in another session's worktree. They were installed by hand on one machine, which meant every
# other checkout committed with no guard at all and nothing said so.
#
#   bash scripts/install-hooks.sh
#
# Then prove the scanner still refuses what it should and still ignores what it should, because a
# guard that has never refused anything is not known to protect anything — and one that has only
# been made quieter has been disabled rather than corrected:
#
#   python3 scripts/scan-secrets.py --selftest    # both directions, every validated rule
#   python3 scripts/scan-secrets.py --all         # this tree, EXPECT: CLEAN
#
# A key-shaped string of filler characters is NOT enough to test this scanner any more, and that is
# the point: the bech32 rule verifies the checksum, so only a format-valid value trips it. The
# selftest builds one from 33 zero bytes — correct in every respect and provably nobody's key.
set -euo pipefail
cd "$(dirname "$0")/.."
git config core.hooksPath scripts/git-hooks
chmod +x scripts/git-hooks/*
printf 'core.hooksPath -> %s\n' "$(git config core.hooksPath)"
for h in scripts/git-hooks/*; do printf '  %s\n' "$(basename "$h")"; done
