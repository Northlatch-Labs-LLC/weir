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

# The hooks are tracked as mode 100755, so a fresh clone gets them executable and this chmod is a
# belt-and-braces no-op. It was NOT always so: they were committed 100644, git ignored them with a
# hint rather than an error, and this line quietly fixed only the checkout it ran in — which is
# precisely the failure this script exists to prevent, wearing the script's own clothes.
chmod +x scripts/git-hooks/*

# Prove the guard refuses. A hook that has never refused anything is not known to protect anything,
# and it took a probe that silently planted an empty string to notice this was untested.
if ! python3 scripts/scan-secrets.py --selftest >/dev/null 2>&1; then
  printf 'scan-secrets --selftest FAILED. The hooks are installed but the scanner is not trustworthy.\n' >&2
  exit 1
fi
printf 'core.hooksPath -> %s\n' "$(git config core.hooksPath)"
for h in scripts/git-hooks/*; do printf '  %s\n' "$(basename "$h")"; done
