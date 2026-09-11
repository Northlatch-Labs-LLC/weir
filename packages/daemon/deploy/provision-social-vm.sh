#!/bin/bash
# Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
#
# Provision a VM that runs ProjectX Social and nothing else.
#
# # Why this exists
#
# The cost was demonstrated the same day. Resizing that VM for a *social* requirement took the
# *protocol* daemon down for roughly an hour. One product's routine deployment stopped another
# product's mainnet service, and the two share nothing but a machine.
#
# So: one VM per product. A social deploy must not be able to touch the protocol estate.
#
# # What this script does and does not do
#
# It creates the instance, its service account, its IAM, and its boot-time configuration. It does
# **not** create or fund a wallet, and it does not create the Cloudflare tunnel — both need a human
# (see the closing notes). Everything here is idempotent: re-running it converges.
#
# Nothing in this file contains a secret. Secrets are named, fetched from Secret Manager at boot into
# tmpfs, and never written to disk or into a unit file.

set -euo pipefail

PROJECT=projectx-daemon-prod
ZONE=europe-west2-c
NAME=projectx-social
SA=projectx-social-vm
# 8 GB. RedStuff encoding expands an 8 MiB image to roughly 130 MiB held in memory during the store,
# and the publisher runs several sub-wallets concurrently. Measured, not guessed: a 52-byte file
# encoded to 63 MiB. e2-small (2 GB) is not enough, which is what forced the resize that caused the
# outage described above.
MACHINE=e2-standard-2

# --- service account, scoped to this product only ----------------------------------------------
# Separate from the protocol VM's account on purpose. An account that can read both products'
# secrets reintroduces the coupling this whole script exists to remove.
gcloud iam service-accounts create "$SA" --project "$PROJECT" \
  --display-name "ProjectX Social VM" 2>/dev/null || echo "service account exists"

SA_EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"

for SECRET in projectx-social-signer projectx-social-journal-url walrus-publisher-jwt social-cloudflared-token; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null 2>&1 \
    || echo "note: secret ${SECRET} not found or binding failed — create it before boot"
done

# --- the instance -------------------------------------------------------------------------------
# Container-Optimized OS, like the existing box. Note the consequence, which cost an hour to learn:
# **/etc is stateless on COS.** It is rebuilt from the image at every boot, so systemd units written
# there do not survive a restart. Anything that must come back after a reboot belongs in the startup
# script referenced below, which lives in instance metadata and IS durable.
gcloud compute instances create "$NAME" \
  --project "$PROJECT" --zone "$ZONE" \
  --machine-type "$MACHINE" \
  --image-family cos-stable --image-project cos-cloud \
  --boot-disk-size 50GB --boot-disk-type pd-balanced \
  --service-account "$SA_EMAIL" \
  --scopes https://www.googleapis.com/auth/cloud-platform \
  --no-address \
  --metadata-from-file startup-script=social-startup.sh \
  2>/dev/null || {
    echo "instance exists — updating startup script only"
    gcloud compute instances add-metadata "$NAME" --project "$PROJECT" --zone "$ZONE" \
      --metadata-from-file startup-script=social-startup.sh
  }

cat <<'NEXT'

Provisioned. Four steps remain that a script must not do for you.

1. CLOUDFLARE TUNNEL — its own, not the protocol's.
   Create a tunnel named `projectx-social`, store its token as the Secret Manager secret
   `social-cloudflared-token`, then add one public hostname:
       walrus.protocolx.io  ->  http://127.0.0.1:31416
   Remove that hostname from the protocol tunnel afterwards, not before: two tunnels advertising
   the same hostname is a coin toss over which one serves a request.

2. PUBLISHER WALLET — generated on the new VM so the key never travels.
       docker run --rm -v /var/lib/walrus-publisher:/w \
         --entrypoint /opt/walrus/bin/walrus mysten/walrus-service:mainnet \
         --config /w/config/client_config.yaml --context mainnet \
         generate-sui-wallet --path /w/wallets --sui-network mainnet
   Fund the printed address with SUI and WAL **as coin objects**. A plain wallet transfer lands in
   the address balance, which the Walrus client cannot spend — it fails with "could not find SUI
   coins with sufficient balance" while `sui client balance` looks perfectly healthy. Materialise
   coin objects with:
       sui client ptb --split-coins gas "[5000000000]" --assign c \
         --transfer-objects "[c]" @<new-publisher-address>
   Roughly 1 SUI per sub-wallet plus a buffer, and WAL for storage: a durable 1 MiB image costs
   about 0.35 WAL, an ephemeral one about 0.018.

3. RETIRE THE OLD PUBLISHER once the new one serves a real upload: stop the container on
   `projectx-daemon`, then sweep the old wallet's remaining WAL and SUI back out. The old wallet's
   key stays on that box and should be considered spent, not moved.

4. REMOVE THE SOCIAL DAEMON FROM THE PROTOCOL BOX: delete the projectx-social-harvest units and
   /var/lib/projectx-social from `projectx-daemon`, and drop the social secrets from that VM's
   service account. Until this is done both machines harvest, and two harvesters racing the same
   vaults is the failure this separation exists to prevent.

Nothing in Vercel changes if the hostname stays `walrus.protocolx.io` — the URL is the contract, and
the machine behind it is not.
NEXT
