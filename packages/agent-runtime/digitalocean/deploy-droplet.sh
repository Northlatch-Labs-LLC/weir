#!/usr/bin/env bash
# Creates the $4 droplet from cloud-init.yaml. NOT RUN. Refuses without DEPLOY_CONFIRMED=1, which
# is the Master's word. Requires: DO_TOKEN_FILE (a file, never printed), SSH_PUBLIC_KEY_FILE,
# REGISTRY_IMAGE (registry.digitalocean.com/<registry>/weir-agent-runtime@sha256:<digest>).
set -euo pipefail
if [ "${DEPLOY_CONFIRMED:-}" != "1" ]; then
  echo "deploy-droplet.sh: refused — DEPLOY_CONFIRMED is not 1. Nothing was run." >&2; exit 1
fi
: "${DO_TOKEN_FILE:?path to the DigitalOcean token file}"
: "${SSH_PUBLIC_KEY_FILE:?path to the operator's SSH public key}"
: "${REGISTRY_IMAGE:?registry image reference pinned by digest}"
REGION="${REGION:-fra1}"; SIZE="${SIZE:-s-1vcpu-512mb-10gb}"; NAME="${NAME:-weir-agent-first}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_DATA="$(sed -e "s#SSH_PUBLIC_KEY#$(cat "$SSH_PUBLIC_KEY_FILE")#" -e "s#REGISTRY_IMAGE#${REGISTRY_IMAGE}#" "$HERE/cloud-init.yaml")"
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
