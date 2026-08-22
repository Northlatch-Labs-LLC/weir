#!/bin/bash
# Built-by: @projectx.sui /|\ · Co-authored-by: Claude
# Install the harvest daemon on a Container-Optimized OS host.
#
# COS has no package manager and no Node, so the daemon runs as a container from Artifact Registry
# — the same shape the sibling ProjectX daemon already uses on this machine. The unit files in this
# directory alongside (`projectx-harvest.service`, `.timer`) are for a conventional Linux host with
# Node installed; this script is the COS equivalent and the two are not interchangeable.
#
#   gcloud compute scp install-cos.sh projectx-daemon:/tmp/ --zone europe-west2-c
#   gcloud compute ssh projectx-daemon --zone europe-west2-c --command 'sudo bash /tmp/install-cos.sh'
#
# Idempotent: safe to re-run to pick up a new image tag or a changed public variable.
set -euo pipefail

PROJECT=projectx-daemon-prod
IMAGE="europe-west2-docker.pkg.dev/${PROJECT}/projectx/social-harvest:v3"
LIB=/var/lib/projectx-social

mkdir -p "$LIB"

# --- secrets, fetched at start rather than stored on disk ------------------------------------
#
# Written to a 0600 file under /run, which is tmpfs — so the key never touches persistent storage
# and does not survive a reboot. Mirrors /var/lib/projectx/fetch-secrets.sh, deliberately: one
# pattern on this host is easier to audit than two.
cat > "$LIB/fetch-secrets.sh" <<'FETCH'
#!/bin/bash
set -euo pipefail
PROJECT=projectx-daemon-prod
OUT=/run/projectx-social/secrets.env
umask 077
mkdir -p /run/projectx-social
: > "$OUT"
tok() { curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'; }
T=$(tok)
get() {
  curl -s -H "Authorization: Bearer $T" \
    "https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets/$1/versions/latest:access" \
    | python3 -c 'import sys,json,base64;print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode(),end="")'
}
printf 'PROJECTX_DAEMON_SIGNER_SECRET=%s\n' "$(get projectx-social-signer)"      >> "$OUT"
printf 'PROJECTX_DAEMON_DATABASE_URL=%s\n'  "$(get projectx-social-journal-url)" >> "$OUT"
chmod 600 "$OUT"
FETCH
chmod 700 "$LIB/fetch-secrets.sh"

# --- public configuration -------------------------------------------------------------------
#
# Object ids and endpoints are public facts, so they live in a readable file rather than in the
# secret store. PACKAGE_ID is the ORIGINAL publish and LATEST_PACKAGE_ID is the current one; they
# are different and both are needed. Event type tags keep the original address for ever, so vault
# discovery filters on it — while the harvest call must target the latest, because Sui executes the
# bytecode at the address it is given rather than resolving to the newest version.
cat > "$LIB/harvest-public.env" <<'PUBLIC'
PROJECTX_SOCIAL_GRPC_URL=https://fullnode.mainnet.sui.io:443
PROJECTX_SOCIAL_PACKAGE_ID=0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d
PROJECTX_SOCIAL_LATEST_PACKAGE_ID=0xa7fd154039f77780f808c7262511a9f4a860620d57e17b58e0e2ca010e1d214d
PROJECTX_DAEMON_TICK_SECONDS=3600
PROJECTX_DAEMON_MAX_DISCOVERY_PAGES=20
PROJECTX_DAEMON_GAS_BUDGET_MIST=20000000
PUBLIC
chmod 644 "$LIB/harvest-public.env"

# --- the tick ---------------------------------------------------------------------------------
#
# `--once` under a timer, not a long-lived loop. systemd is a better supervisor than an in-process
# interval: it survives the process dying at 3am and it knows what a failure is from the exit code.
#
# Requires the Cloud SQL proxy, because the journal holds the single-instance lock. Starting without
# it would not fail loudly — the daemon would refuse the tick, hourly, for ever.
cat > /etc/systemd/system/projectx-social-harvest.service <<UNIT
[Unit]
Description=ProjectX Social harvest daemon (one tick)
After=projectx-sqlproxy.service network-online.target
Requires=projectx-sqlproxy.service
Wants=network-online.target

[Service]
Type=oneshot
# Registry credentials, shared with the sibling daemon on this host.
Environment=DOCKER_CONFIG=/var/lib/projectx/docker
ExecStartPre=/bin/bash ${LIB}/fetch-secrets.sh
ExecStartPre=-/usr/bin/docker rm -f projectx-social-harvest
ExecStart=/usr/bin/docker run --rm --name projectx-social-harvest --network host \\
  --env-file ${LIB}/harvest-public.env \\
  --env-file /run/projectx-social/secrets.env \\
  ${IMAGE} --once

# A hung tick must not hold the single-instance lock for ever; the next run would exit 2 and
# nothing would harvest.
TimeoutStartSec=600
UNIT

# --- the schedule -----------------------------------------------------------------------------
#
# Hourly, against a chain whose epochs are about a day. That is deliberate over-sampling: the
# decision function declines to submit when there is nothing worth doing, so a wasted tick costs a
# few chain reads and no gas — while a tick that is too slow means a rung sits unstaked for a day.
#
# Persistent, so a tick missed while the machine was off runs once at boot rather than being lost.
cat > /etc/systemd/system/projectx-social-harvest.timer <<'TIMER'
[Unit]
Description=Run a ProjectX Social harvest tick hourly

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
Persistent=true
Unit=projectx-social-harvest.service

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
echo "installed. enable with: systemctl enable --now projectx-social-harvest.timer"
