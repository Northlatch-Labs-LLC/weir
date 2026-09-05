#!/usr/bin/env bash
# Creates the $4 droplet from cloud-init.yaml. NOT RUN. Refuses without DEPLOY_CONFIRMED=1, which
# is the Master's word. Requires: DO_TOKEN_FILE (a file, never printed), SSH_PUBLIC_KEY_FILE,
# REGISTRY_IMAGE (registry.digitalocean.com/<registry>/weir-agent-runtime@sha256:<digest>).
#
# The non-ASCII guard is scripts/check-ascii.py, run against the RENDERED user-data (after the
# SSH_PUBLIC_KEY/REGISTRY_IMAGE substitution below), never the template. Two defects this closes,
# both verified on this laptop: (1) the prior guard was `LC_ALL=C grep -qP '[^\x00-\x7F]'` —
# macOS's system `/usr/bin/grep` has no `-P`, exits 2 ("invalid option -- P"), and inside
# `if grep -qP ...; then` that exit is swallowed, so the guard never fired and reported a file
# holding U+0080 as clean; (2) that guard also scanned the template, but cloud-init only ever
# sees the rendered user_data DigitalOcean is handed — a byte introduced by substitution (an odd
# key file, an odd image reference) would have passed a template-only check.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_ASCII="$HERE/../scripts/check-ascii.py"

if [ "${1:-}" = "--plan" ]; then
  echo "deploy-droplet.sh --plan: prints what would be created. No API call is made; nothing exists yet."
  echo "  region:      ${REGION:-fra1}"
  echo "  size:        ${SIZE:-s-1vcpu-512mb-10gb}"
  echo "  name:        ${NAME:-weir-agent-first}"
  echo "  image ref:   ${REGISTRY_IMAGE:-<unset — required at create time, must be pinned by sha256 digest>}"
  echo "  do token:    ${DO_TOKEN_FILE:-<unset — a file path, never printed even when set>}"
  echo "  ssh key:     ${SSH_PUBLIC_KEY_FILE:-<unset — the operators SSH public key file>}"
  echo "  cloud-init:  $HERE/cloud-init.yaml, rendered and checked ASCII-only (scripts/check-ascii.py) before create"
  # TODO(step 6): this is a stub for the plan asked for at
  # work/rnd/agent/2026-09-05-executive-heron-v2-decided.md §3 step 6 — a full plan names every
  # resource with region/size/slug, every firewall rule, uid/gid 10001, every path with its owner
  # and mode, and every credential with its source pile and destination path, with no API call,
  # for the Master to read before anything is created. Not built here; this stub only proves the
  # flag exists and is inert.
  exit 0
fi

if [ "${DEPLOY_CONFIRMED:-}" != "1" ]; then
  echo "deploy-droplet.sh: refused — DEPLOY_CONFIRMED is not 1. Nothing was run." >&2; exit 1
fi
: "${DO_TOKEN_FILE:?path to the DigitalOcean token file}"
: "${SSH_PUBLIC_KEY_FILE:?path to the operators SSH public key}"
: "${REGISTRY_IMAGE:?registry image reference pinned by digest}"
REGION="${REGION:-fra1}"; SIZE="${SIZE:-s-1vcpu-512mb-10gb}"; NAME="${NAME:-weir-agent-first}"

USER_DATA="$(sed -e "s#SSH_PUBLIC_KEY#$(cat "$SSH_PUBLIC_KEY_FILE")#" -e "s#REGISTRY_IMAGE#${REGISTRY_IMAGE}#" "$HERE/cloud-init.yaml")"

USER_DATA_TMP="$(mktemp)"
trap 'rm -f "$USER_DATA_TMP"' EXIT
printf '%s' "$USER_DATA" > "$USER_DATA_TMP"
if ! python3 "$CHECK_ASCII" "$USER_DATA_TMP"; then
  echo "deploy-droplet.sh: refused - the rendered user-data failed the ASCII check above; cloud-init would apply nothing" >&2
  exit 1
fi

python3 - "$DO_TOKEN_FILE" "$NAME" "$REGION" "$SIZE" "$USER_DATA" <<'PY'
import json, sys, urllib.request
tok = open(sys.argv[1]).read().strip()
body = {"name": sys.argv[2], "region": sys.argv[3], "size": sys.argv[4], "image": "debian-12-x64",
        "user_data": sys.argv[5], "monitoring": True, "tags": ["weir-agent", "beat"]}
req = urllib.request.Request("https://api.digitalocean.com/v2/droplets", data=json.dumps(body).encode(),
      headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=30) as r:
    d = json.load(r)["droplet"]; print("droplet", d["id"], d["name"], d["region"]["slug"], d["size_slug"], d["status"])
PY
echo "next, by hand over SSH: place /srv/agent/config.json and /srv/agent/.security.yml (0600), docker login the registry, then wait for the first cron beat."
