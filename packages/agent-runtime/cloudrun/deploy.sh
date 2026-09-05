#!/usr/bin/env bash
# Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
#
# NOT RUN. This script is written and has never been executed — no `gcloud` command in this file
# has been invoked by the agent that wrote it. Deploying needs the Master's word (Northlatch Code
# law 8; council record §5.3) and the missing pieces named in bin/check-rules.mjs's sibling report:
# the Cloud Scheduler API is disabled on the project (council gap O7 — `gcloud scheduler jobs list`
# returns SERVICE_DISABLED as of the council record) and must be enabled before step 4 below can
# run. Read this file; do not source or execute it against a real project without that word.
#
# What it would do, top to bottom:
#   1. Build and push the image from ../Dockerfile to Artifact Registry, tagged by its digest.
#   2. Substitute that digest into job.yaml and `gcloud run jobs replace` it.
#   3. Create the Secret Manager secret "weir-agent-runtime-security-yml" from a LOCAL .security.yml
#      that is never committed (this script refuses to run if that file is missing, and never
#      prints its contents).
#   4. Create a Cloud Scheduler job that invokes the Cloud Run Job every 30 minutes, per
#      PicoClaw's own heartbeat floor (pkg/heartbeat/service.go: minIntervalMinutes = 5) — 30
#      minutes is chosen, not the floor, because this is a one-shot invocation via Scheduler, not
#      PicoClaw's own internal heartbeat loop, and the council's numbers (§2.6) put the normal-tier
#      beat interval at 15 minutes and the critical tier at once per epoch — 30 is the conservative
#      middle used nowhere else in this package without a ruling, and is the value this script
#      would need Kaela's or the Master's confirmation to keep.

set -euo pipefail

echo "cloudrun/deploy.sh: this script performs no action by default. Read it before running any" >&2
echo "line inside it. It exits 1 unconditionally until DEPLOY_CONFIRMED=1 is exported by a human" >&2
echo "who has the Master's word for this specific deploy." >&2

if [ "${DEPLOY_CONFIRMED:-0}" != "1" ]; then
  echo "cloudrun/deploy.sh: refused — DEPLOY_CONFIRMED is not 1. Nothing was run." >&2
  exit 1
fi

: "${PROJECT_ID:?set PROJECT_ID, e.g. projectx-daemon-prod}"
: "${REGION:?set REGION, e.g. europe-west1}"
: "${SECURITY_YML_PATH:?set SECURITY_YML_PATH to a local .security.yml, never committed}"

if [ ! -f "$SECURITY_YML_PATH" ]; then
  echo "cloudrun/deploy.sh: refused — $SECURITY_YML_PATH does not exist." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/agent-runtime/weir-agent-runtime"

echo "cloudrun/deploy.sh: step 1 — build and push" >&2
docker build -t "${IMAGE_REPO}:build-$(date -u +%Y%m%dT%H%M%SZ)" "$PACKAGE_ROOT"
# docker push is intentionally NOT invoked by this script. A human runs it, reads the digest
# `docker push` prints, and pastes that digest into the next step by hand — this script does not
# resolve or trust a mutable tag for a job definition.
echo "cloudrun/deploy.sh: build complete. Push manually, then set IMAGE_DIGEST and re-run from step 2." >&2
exit 0

# --- everything below is unreachable while this script exits above; kept as the documented next
#     steps rather than deleted, so the whole path is legible in one file. ---
#
# : "${IMAGE_DIGEST:?set IMAGE_DIGEST to the pushed image's sha256 digest}"
# sed -e "s#REGION-docker.pkg.dev#${REGION}-docker.pkg.dev#" -e "s#PROJECT_ID#${PROJECT_ID}#g" \
#     -e "s#UNSET#${IMAGE_DIGEST}#" \
#   "$SCRIPT_DIR/job.yaml" > "$SCRIPT_DIR/.job.rendered.yaml"
# gcloud run jobs replace "$SCRIPT_DIR/.job.rendered.yaml" --project "$PROJECT_ID" --region "$REGION"
#
# gcloud secrets create weir-agent-runtime-security-yml --project "$PROJECT_ID" \
#   --replication-policy=automatic --data-file="$SECURITY_YML_PATH" || \
#   gcloud secrets versions add weir-agent-runtime-security-yml --project "$PROJECT_ID" \
#     --data-file="$SECURITY_YML_PATH"
#
# gcloud scheduler jobs create http weir-agent-runtime-beat-30m --project "$PROJECT_ID" \
#   --location "$REGION" --schedule "*/30 * * * *" \
#   --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/weir-agent-runtime-beat:run" \
#   --http-method POST --oauth-service-account-email "agent-first@${PROJECT_ID}.iam.gserviceaccount.com"
