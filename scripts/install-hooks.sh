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
# Then prove the scanner refuses something, because a guard that has never refused anything is not
# known to protect anything. Plant a key-shaped string made of filler characters, watch the commit
# be refused, and remove it:
#
#   printf 'const PLANTED = "suiprivkey1%s";\n' "$(printf 'q%.0s' $(seq 59))" > packages/daemon/planted.ts
#   git add packages/daemon/planted.ts
#   git commit -m "planted"        # MUST be refused, naming packages/daemon/planted.ts
#   git rm --cached -q packages/daemon/planted.ts && rm packages/daemon/planted.ts
#   git status --porcelain         # MUST be empty again
set -euo pipefail
cd "$(dirname "$0")/.."
git config core.hooksPath scripts/git-hooks
chmod +x scripts/git-hooks/*
printf 'core.hooksPath -> %s\n' "$(git config core.hooksPath)"
for h in scripts/git-hooks/*; do printf '  %s\n' "$(basename "$h")"; done
