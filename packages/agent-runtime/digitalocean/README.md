# The $4 home: one DigitalOcean droplet, cron, the image from the registry

Chosen 2026-09-04 on the Master's word ("the minimal most optimal solution … at DigitalOcean; we
do not have a lot of credit"), from the account and the docs read that night: Functions are free
but take source only (Node/Go/Python/PHP, 48 MB built, no Docker); an App Platform worker is $5
always-on and its jobs are deploy hooks, not a schedule; the smallest droplet,
`s-1vcpu-512mb-10gb`, is $4.00 a month with 1 vCPU and 512 MB in twelve regions. With no local
inference (the model route is OpenRouter), 512 MB carries one beat. The account held a $25.00
credit and nothing deployed.

**Nothing in this folder has been run.** `deploy-droplet.sh` refuses without `DEPLOY_CONFIRMED=1`,
and that word is the Master's.

## Shape

1. **Registry**: DigitalOcean Container Registry, Starter tier (free: one repository, 500 MB). The
   image built here is 264 MB. `docker push` from the laptop is a push to the cloud and happens
   only on his word.
2. **Droplet**: `s-1vcpu-512mb-10gb`, region `fra1` (nearest to the hosted MCP in europe-west1),
   Debian 12, SSH by key only, a DigitalOcean cloud firewall with no inbound rule but SSH from the
   operator's address, no other listener. `cloud-init.yaml` installs Docker, logs the registry in
   with a read-only registry token placed by hand, writes the beat's config and `.security.yml`
   from files placed by hand (never from this repository), and installs one cron line.
3. **The beat**: `*/30 * * * *` runs the same container as on the laptop, one beat, with the lock
   in `beat.sh` refusing an overlap; the log lands under `/srv/agent/runs/` and rotates by size.
4. **The key**: the OpenRouter key sits in `/srv/agent/.security.yml`, mode 600, written by the
   operator's hand over SSH; the container mounts it read-only. No key is in the image, the
   registry, cloud-init or this repository.

## What it costs

| Item | Monthly |
|---|---|
| Droplet `s-1vcpu-512mb-10gb` | $4.00 |
| Container Registry, Starter | $0.00 |
| Cloud firewall | $0.00 |
| Outbound transfer | inside the droplet's allowance |
| **Total** | **$4.00**, six months on the $25.00 credit |

## What it does not do

No public port; no gateway; no Ollama on the droplet (512 MB cannot hold a model, and the critical
tier's local route is a laptop and device matter, not a droplet's); no automatic pull of a new
image (a new digest is a new deploy, on his word).
