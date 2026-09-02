#!/bin/bash
# Built-by: @projectx.sui /|\ · Co-authored-by: Claude
#
# Everything ProjectX Social runs, reconstructed on every boot.
#
# # The rule for this machine
#
# **If it is not in this file, it does not survive a reboot.**
#
# Instance metadata is durable. This file is that metadata.
#
# # No secret appears here
#
# Secrets are fetched at boot from Secret Manager into /run, which is tmpfs — so they exist only
# while the machine is up, never on disk, and never inside a unit file that `systemctl cat` prints.

set -uo pipefail
exec > >(logger -t social-startup) 2>&1
echo "social-startup: begin"

PROJECT=projectx-daemon-prod
REGISTRY=europe-west2-docker.pkg.dev/projectx-daemon-prod/projectx
PUBLISHER_DIR=/var/lib/walrus-publisher
SOCIAL_DIR=/var/lib/projectx-social

mkdir -p "$PUBLISHER_DIR"/{config,subwallets} "$SOCIAL_DIR" /run/walrus-publisher /run/projectx-social

# `--restart always` on everything. The containers this replaces had no restart policy, so a crash
# left them down until somebody noticed — which, for the harvest timer, was never.
run() {
  local name=$1; shift
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --restart always --name "$name" --network host "$@" >/dev/null
}

# --- one secret, fetched by name ---------------------------------------------------------------
secret() {
  local tok
  tok=$(curl -s -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
  curl -s -H "Authorization: Bearer $tok" \
    "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/$1/versions/latest:access" \
    | python3 -c 'import sys,json,base64;print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode(),end="")'
}

umask 077
printf 'WALRUS_JWT_SECRET=%s\n'             "$(secret walrus-publisher-jwt)"        > /run/walrus-publisher/secrets.env
printf 'TUNNEL_TOKEN=%s\n'                  "$(secret social-cloudflared-token)"    > /run/walrus-publisher/tunnel.env
printf 'PROJECTX_DAEMON_SIGNER_SECRET=%s\n' "$(secret projectx-social-signer)"      > /run/projectx-social/secrets.env
printf 'PROJECTX_DAEMON_DATABASE_URL=%s\n'  "$(secret projectx-social-journal-url)" >> /run/projectx-social/secrets.env
chmod 600 /run/walrus-publisher/secrets.env /run/walrus-publisher/tunnel.env /run/projectx-social/secrets.env

# --- Walrus configuration ----------------------------------------------------------------------
# Fetched once and kept: the file names the mainnet system objects, and a stale copy fails with
# "the specified Walrus system object does not exist", which reads like an outage rather than a
# configuration age problem.
if [ ! -s "$PUBLISHER_DIR/config/client_config.yaml" ]; then
  curl -sS https://docs.wal.app/setup/client_config.yaml -o "$PUBLISHER_DIR/config/client_config.yaml"
  sed -i 's/^default_context: testnet/default_context: mainnet/' "$PUBLISHER_DIR/config/client_config.yaml"
fi

# --- the Walrus publisher ----------------------------------------------------------------------
#
# Bound to 127.0.0.1, never 0.0.0.0. It holds a funded wallet, and Walrus's own guidance is that an
# open publisher on mainnet can be drained by anyone who reaches it. The tunnel runs on this host,
# so loopback is reachable to it and to nothing else.
#
# `--jwt-expiring-sec 60` MUST equal LIFETIME_SECONDS in packages/web/lib/publisher-token.ts. The
# publisher requires `exp - iat` to EQUAL this value rather than fall under it, and rejects every
# token otherwise with "the expiration in the query does not match the token" — a message naming
# the query, which is not involved. Changing one side alone is a total upload outage.
#
# Started only once a wallet exists. A publisher with no wallet exits on boot and `--restart always`
# then renders it as a crash loop, which reads like a broken deployment rather than a missing step.
if [ -s "$PUBLISHER_DIR/wallets" ]; then
  run walrus-publisher \
    --env-file /run/walrus-publisher/secrets.env \
    -v "$PUBLISHER_DIR":/w \
    --entrypoint /bin/sh \
    mysten/walrus-service:mainnet -c '/opt/walrus/bin/walrus \
      --config /w/config/client_config.yaml --context mainnet publisher \
      --bind-address 127.0.0.1:31416 \
      --sub-wallets-dir /w/subwallets \
      --n-clients 2 \
      --jwt-decode-secret "$WALRUS_JWT_SECRET" \
      --jwt-verify-upload \
      --jwt-expiring-sec 60 \
      --wallet /w/wallets'
else
  echo "social-startup: NO PUBLISHER WALLET at $PUBLISHER_DIR/wallets — uploads will fail closed"
fi

# --- the tunnel, last, so what it fronts is already listening -----------------------------------
run social-cloudflared --env-file /run/walrus-publisher/tunnel.env \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run

# --- hourly harvest tick -------------------------------------------------------------------------
# Rebuilt here every boot, because /etc does not keep it.
cat > "$SOCIAL_DIR/harvest-public.env" <<'PUBLIC'
PROJECTX_SOCIAL_GRPC_URL=https://fullnode.mainnet.sui.io:443
PROJECTX_SOCIAL_PACKAGE_ID=0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d
PROJECTX_SOCIAL_LATEST_PACKAGE_ID=0xdc6dbb96885ba049c5d860d0b775b9e968cf9053a227861ae006f22e352884b5
PROJECTX_DAEMON_TICK_SECONDS=3600
PROJECTX_DAEMON_MAX_DISCOVERY_PAGES=20
PROJECTX_DAEMON_GAS_BUDGET_MIST=20000000
PUBLIC

cat > /etc/systemd/system/projectx-social-harvest.service <<UNIT
[Unit]
Description=ProjectX Social harvest daemon (one tick)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStartPre=-/usr/bin/docker rm -f projectx-social-harvest
ExecStart=/usr/bin/docker run --rm --name projectx-social-harvest --network host \\
  --env-file ${SOCIAL_DIR}/harvest-public.env \\
  --env-file /run/projectx-social/secrets.env \\
  ${REGISTRY}/social-harvest:v5 --once
TimeoutStartSec=600
UNIT

cat > /etc/systemd/system/projectx-social-harvest.timer <<'TIMER'
[Unit]
Description=Run a ProjectX Social harvest tick hourly
[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
Persistent=true
[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now projectx-social-harvest.timer
echo "social-startup: done"
