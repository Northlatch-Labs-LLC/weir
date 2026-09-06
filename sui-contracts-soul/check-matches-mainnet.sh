#!/usr/bin/env bash
# Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
#
# Prove that this directory is the contract running on mainnet.
#
# WHY THIS EXISTS. Until 2026-09-06 this directory held a DIFFERENT contract from the deployed
# one — 50 functions against the chain's 108, a MasterCap settlement instead of a LedgerCap one,
# and a seven-day epoch instead of the chain's. Nothing compared the two, so nothing said so, and
# a transaction built by reading these sources would have been built against a contract that does
# not exist. That is the whole defect: not a wrong file, but a wrong file nobody could notice.
#
# The check is a byte comparison, not a signature comparison. Matching function names would still
# have passed with an inverted comparison or a changed constant inside a body.
#
#   ./check-matches-mainnet.sh              build and compare against the pinned digest (offline)
#   ./check-matches-mainnet.sh --chain      also fetch the module from mainnet and compare to that
#
# Run it after any edit to sources/. If it fails, this directory and mainnet have parted company;
# either the edit is unpublished (expected while preparing an upgrade) or the wrong file is here
# again. Publishing a new version means re-pinning the digest below in the same commit.

set -euo pipefail
cd "$(dirname "$0")"

# sha256 of build/northlatch_soul/bytecode_modules/soul.mv, which with Published.toml present
# carries the published address and so equals the module's bytes on chain exactly.
PINNED="437030125dae2d2bde15239ff0c3df8fe224d2e6fe26009d79116ae52d215ba3"
PACKAGE="0x8d6567ed7bf34d99eefefe745c3a282fd89a12fdcd77e6bd10b19b35b599635f"
MV="build/northlatch_soul/bytecode_modules/soul.mv"

# A release build, never a test build: `sui move test` compiles #[test_only] code in and the
# artefact is 99 bytes longer. Removing build/ first is what makes that impossible to inherit.
rm -rf build
sui move build --silence-warnings >/dev/null

BUILT="$(shasum -a 256 "$MV" | cut -d' ' -f1)"
if [ "$BUILT" != "$PINNED" ]; then
  echo "soul: REFUSED — this directory does not build the pinned module." >&2
  echo "  built  $BUILT" >&2
  echo "  pinned $PINNED" >&2
  exit 1
fi
echo "soul: build matches the pinned digest $PINNED"

if [ "${1:-}" = "--chain" ]; then
  CHAIN="$(curl -sS -X POST https://graphql.mainnet.sui.io/graphql \
    -H 'Content-Type: application/json' \
    -d "{\"query\":\"query { object(address: \\\"$PACKAGE\\\") { asMovePackage { module(name: \\\"soul\\\") { bytes } } } }\"}" \
    | python3 -c 'import sys,json,base64,hashlib; d=json.load(sys.stdin); b=d["data"]["object"]["asMovePackage"]["module"]["bytes"]; print(hashlib.sha256(base64.b64decode(b)).hexdigest())')"
  if [ "$CHAIN" != "$BUILT" ]; then
    echo "soul: REFUSED — mainnet does not match this build." >&2
    echo "  chain $CHAIN" >&2
    echo "  built $BUILT" >&2
    exit 1
  fi
  echo "soul: mainnet $PACKAGE serves these exact bytes"
fi
