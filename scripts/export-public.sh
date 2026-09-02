#!/bin/bash
# Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
# Refresh the public sibling repository from this monorepo.
#
# The public repository carries the six Apache-2.0 libraries and the two BUSL-1.1 Move packages
# and nothing operational. This script is the exact list of what crosses and what does not, so the
# next export is a run of this file rather than a memory of the last one.
#
#   scripts/export-public.sh /path/to/weir-protocol
#
# It copies, then prints every line in the destination that names an internal document path,
# a deployment identifier or a desk phrase. A non-empty list is a stop, not a warning: fix the
# source here first (the two trees must stay identical in the files they share), then run again.
# The destination's own README, LICENSE, NOTICE, CONTRIBUTING, SECURITY, package.json, lockfile and
# workflows are its own and are not touched.
set -euo pipefail
DEST=${1:?destination checkout of the public repository}
SRC=$(cd "$(dirname "$0")/.." && pwd)

rsync -a --delete \
  --exclude node_modules --exclude dist --exclude '.env*' --exclude '*.tsbuildinfo' \
  --exclude build \
  --exclude 'deploy/install-cos.sh' --exclude 'deploy/social-startup.sh' --exclude 'deploy/provision-social-vm.sh' \
  --exclude 'deploy/prover-startup.sh' --exclude 'deploy/projectx-harvest.service' --exclude 'deploy/projectx-harvest.timer' \
  --exclude 'deploy/io.protocolx.harvest.plist' --exclude 'cloudbuild.yaml' \
  --exclude 'deploy/UPGRADE-CEREMONY.md' --exclude 'deploy/MULTISIG-RECOVERY-CARD.md' \
  "$SRC/packages/sdk" "$SRC/packages/policy" "$SRC/packages/signer" "$SRC/packages/agent" "$SRC/packages/mcp" "$SRC/packages/daemon" \
  "$DEST/packages/"
rsync -a --delete --exclude build "$SRC/sui-contracts" "$SRC/sui-contracts-mind" "$DEST/"
for f in write-sdk-fingerprint.mjs sdk-src-fingerprint.mjs sdk-freshness.mjs every-package-is-tested.mjs scan-secrets.py secret-allowlist.json; do
  cp "$SRC/scripts/$f" "$DEST/scripts/$f"
done
cp "$SRC/.dockerignore" "$DEST/.dockerignore"

echo "== lines that must not cross (empty is the only acceptable output) =="
grep -rn -I -E "the Master|his order|his ruling|/Users/admin|operations/|projectx-daemon-prod|europe-west2|msig-|prj_[A-Za-z0-9]{8}|team_[A-Za-z0-9]{8}" \
  --exclude-dir=node_modules --exclude-dir=build --exclude-dir=.git "$DEST/packages" "$DEST/sui-contracts" "$DEST/sui-contracts-mind" \
  | grep -v "this order" || true
echo "== then, in $DEST: pnpm install && pnpm test; python3 scripts/scan-secrets.py --all; gitleaks detect --no-git; commit; push =="
