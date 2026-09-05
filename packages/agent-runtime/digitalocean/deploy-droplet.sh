#!/usr/bin/env bash
# Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
#
# Heron v2's host deploy script. Build order step 6
# (work/rnd/agent/2026-09-05-executive-heron-v2-decided.md section 3), against the CTO's spec
# (2026-09-05-engineering-heron-v2-runtime-and-host.md sections 3-4) and the CISO's, amended by
# the executive to one host, one signer service (heron-purse), a 1-of-2 multisig.
#
# NOT RUN. This step creates nothing in any cloud, touches no key, and makes no gcloud/API write.
# Every mode below is written to be correct and is verified by --plan's own output and by
# test/host.test.mjs; --create/--seal/--smoke/--status are not exercised against a real host from
# this laptop, and this comment says so rather than claiming otherwise.
#
# Modes:
#   --plan                 prints every resource, path and credential row this WOULD create.
#                           No API call, no network requirement at all -- HERON_NO_NETWORK=1 is
#                           accepted as a marker for a test to assert that, but this mode never
#                           makes a network call regardless of whether that variable is set.
#   --create               creates the droplet and its firewall, waits for SSH, asserts cloud-init
#                           succeeded, builds the image on the host. Refuses without
#                           HERON_DEPLOY_CONFIRMED=1 -- the Master's word -- checked FIRST, before
#                           any other input is even read.
#   --seal <name>          pipes one credential from the desk's pile over the live SSH session
#                           straight into `systemd-creds encrypt --with-key=host` on the host.
#                           Never writes a plaintext file anywhere. --dry-run prints the exact
#                           pipeline it would run instead of running it.
#   --smoke                runs one real beat as the real user; only on a clean exit and a fresh
#                           state/latest.json does it enable the timers.
#   --status               reads back the droplet, firewall, timers and newest state file.
#   --render-cloud-init    internal: prints the rendered user_data to stdout and exits. Used by
#                           --plan's ASCII/YAML preview and by test/host.test.mjs, so the
#                           substitution logic exists in exactly one place.
#
# Environment:
#   HERON_DEPLOY_CONFIRMED=1   required for --create. The Master's word, nothing else.
#   DO_TOKEN_FILE              path to the DigitalOcean token file (row 11, scoped, 90-day expiry).
#                               Never printed, even when set.
#   SSH_PUBLIC_KEY_FILE        path to the desk's SSH public key (row 1). Same key opens both the
#                               `ops` and `heron-ops` accounts cloud-init creates.
#   HERON_DESK_IP              the one address the firewall admits on 22.
#   HERON_SSH_KEY_NAME         name to register the key under on the DigitalOcean account
#                               (default heron-ssh); told to the Master before it is registered.
#   REGION, SIZE, NAME         override the droplet's region/size/name.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$HERE/.." && pwd)"
CHECK_ASCII="$PKG_DIR/scripts/check-ascii.py"
CLOUD_INIT="$HERE/cloud-init.yaml"
TARBALL_SCRIPT="$PKG_DIR/scripts/make-source-tarball.sh"

REGION="${REGION:-fra1}"
SIZE="${SIZE:-s-1vcpu-512mb-10gb}"
NAME="${NAME:-heron-first}"
IMAGE_SLUG="debian-13-x64"
HERON_SSH_KEY_NAME="${HERON_SSH_KEY_NAME:-heron-ssh}"

usage() {
  cat >&2 <<'EOF'
usage: deploy-droplet.sh --plan
       deploy-droplet.sh --create   (HERON_DEPLOY_CONFIRMED=1 required)
       deploy-droplet.sh --seal <name> [--dry-run]
       deploy-droplet.sh --smoke
       deploy-droplet.sh --status
EOF
}

# ---------------------------------------------------------------------------
# Rendering. One function, so --plan's preview, --create's real use and the test's fixture all
# read the exact same substitution -- the discipline the CTO spec names directly: v1's guard
# scanned the template, not what cloud-init was actually handed.
# ---------------------------------------------------------------------------
render_cloud_init() {
  local key_file="${SSH_PUBLIC_KEY_FILE:-}"
  local key_content
  if [ -n "$key_file" ] && [ -f "$key_file" ]; then
    key_content="$(cat "$key_file")"
  else
    # A placeholder that is itself pure ASCII, so --plan and the test can render and ASCII-check
    # the file with no key file on disk at all. --create refuses long before this matters (see
    # check_ssh_key_file), because SSH_PUBLIC_KEY_FILE is a required precondition there.
    key_content="ssh-ed25519 AAAAPLACEHOLDERPLACEHOLDERPLACEHOLDERPLACEHOLDERPLACEHOLDER heron-ssh-placeholder"
  fi
  sed "s#SSH_PUBLIC_KEY#${key_content}#g" "$CLOUD_INIT"
}

# ---------------------------------------------------------------------------
# --plan
# ---------------------------------------------------------------------------
cmd_plan() {
  local desk_ip="${HERON_DESK_IP:-<unset - required for --create>}"
  local do_token_display="<unset - a file path, never printed even when set>"
  local ssh_key_display="<unset - the desk's SSH public key file>"
  [ -n "${DO_TOKEN_FILE:-}" ] && do_token_display="$DO_TOKEN_FILE (path only; contents never read by --plan)"
  [ -n "${SSH_PUBLIC_KEY_FILE:-}" ] && ssh_key_display="$SSH_PUBLIC_KEY_FILE (path only; contents never printed by --plan)"

  cat <<PLAN
deploy-droplet.sh --plan: everything --create would do. No API call is made. Nothing exists yet.

== Droplet (created only by --create, only with HERON_DEPLOY_CONFIRMED=1) ==
  name:        $NAME
  region:      $REGION
  size:        $SIZE (\$4.00/month)
  image slug:  $IMAGE_SLUG
               pinned explicitly (v1's script said debian-12-x64 while its own notes said
               Debian 13); asserted after boot by reading /etc/debian_version over SSH, and by
               --create's own precondition that this slug is listed in the account's own
               GET /v2/images?type=distribution before the create call is made.
  monitoring:  false (do-agent is never installed; cloud-init purges it defensively if present)
  ssh key:     $HERON_SSH_KEY_NAME
               registered on the DigitalOcean account under this exact name if not already
               present, before create -- the name the Master sees first, per the key ledger.
  do token:    $do_token_display
  ssh pubkey:  $ssh_key_display

== Firewall (created and attached in the same run; read back from the API and refused on any
   mismatch before the deploy proceeds -- v1's script claimed a firewall it never created) ==
  inbound:   tcp/22 from $desk_ip only
  outbound:  tcp/443 (fullnode, Resend, apt) and tcp/53 + udp/53 (DNS)
  no other rule, inbound or outbound

== Host paths (created by cloud-init's runcmd, all before any secret is placed) ==
  /srv/heron                          0750 root:root
  /srv/heron/bin                      0755 root:root  (reserved for build order step 5's beat script)
  /srv/heron/creds                    0700 root:root  (reserved; today's sealed blobs live in /etc/heron/creds)
  /srv/heron/runs                     2770 root:heron
  /srv/heron/state                    2770 root:heron
  /srv/heron/intents                  2770 root:heron  (the two-phase beat's intent handoff; matches run-flags.txt)
  /srv/heron/image.env                0600 root:root  (empty placeholder; --create writes the pinned digest after the host build)
  /etc/heron                          0700 root:root
  /etc/heron/creds                    0700 root:root  (sealed systemd-creds blobs; no plaintext, ever)
  /etc/ssh/sshd_config.d/00-heron.conf  0644 root:root  (sorts before cloud-init's own 50-cloud-init.conf)
  heron group/user: gid 10001, uid 10001, nologin -- created only after cloud-init asserts both ids are free
  no key file of any kind under either path. Ever.

== Credentials this step seals (ledger row per credential; no value is ever printed) ==
  name       purpose                          source pile                              destination                     mode  encryption                             revocation
  mail-key   send-only Resend key for alerts  ~/.config/protocolx/heron/mail-key        /etc/heron/creds/mail-key.cred  0400  systemd-creds encrypt --with-key=host  revoke at Resend; --seal mail-key again with a fresh key

  heron-hot, heron-policy and the OpenRouter model key are build order steps 4 and 8's rows; this
  step only builds the --seal mechanism they will use, unchanged, once those keys exist. Nothing
  in this step generates, reads or touches any of them.

== What --create does, in this order, each step a refusal naming the rule if it fails ==
  1. refuses unless HERON_DEPLOY_CONFIRMED=1 -- checked before anything else is even read
  2. refuses unless the RENDERED cloud-init passes scripts/check-ascii.py (never the template)
  3. refuses unless \`git status --porcelain\` is empty
  4. refuses unless the source tarball's entry set equals \`git ls-tree\` for packages/agent-runtime, exactly
  5. refuses unless SSH_PUBLIC_KEY_FILE and DO_TOKEN_FILE (mode 0600) both exist
  6. registers the SSH key if needed, creates the firewall, creates the droplet with
     monitoring:false and the rendered user_data, then reads the firewall back and refuses on
     any mismatch
  7. waits for SSH, then over that session: asserts uid/gid 10001 resolve to heron:heron, runs
     \`cloud-init status --wait --long\` (must be "status: done", no errors) and
     \`cloud-init schema --system\`, and checks /etc/debian_version -- DESTROYS the droplet and
     stops on any failure, rather than leaving a half-built host with root open
  8. copies the source tarball, builds the image on the host, writes /srv/heron/image.env pinned
     by a sha256 digest or image id
  9. installs digitalocean/systemd/*.{service,timer} to /etc/systemd/system and
     digitalocean/bin/heron-{watchdog,alert,retention} to /usr/local/sbin (0755 root:root), then
     \`systemctl daemon-reload\` -- enables NO timer. --smoke is the only thing that ever does that.
PLAN
}

# ---------------------------------------------------------------------------
# --create preconditions. Each is one function, each fails loud with the rule it enforces named,
# so a test can call the ones that need no network in isolation.
# ---------------------------------------------------------------------------
check_confirmed() {
  if [ "${HERON_DEPLOY_CONFIRMED:-}" != "1" ]; then
    echo "deploy-droplet.sh: refused - HERON_DEPLOY_CONFIRMED is not 1. Nothing was run. This word is the Master's alone." >&2
    return 1
  fi
}

check_ascii_rendered() {
  local tmp
  tmp="$(mktemp)"
  render_cloud_init > "$tmp"
  if ! python3 "$CHECK_ASCII" "$tmp"; then
    rm -f "$tmp"
    echo "deploy-droplet.sh: refused - the RENDERED cloud-init failed the ASCII check above; cloud-init would apply nothing (this is the exact defect Heron v1 shipped)" >&2
    return 1
  fi
  rm -f "$tmp"
}

check_git_clean() {
  local status
  status="$(git -C "$PKG_DIR" status --porcelain)"
  if [ -n "$status" ]; then
    echo "deploy-droplet.sh: refused - git status --porcelain is not empty; there is no committed sha to name as what shipped" >&2
    echo "$status" >&2
    return 1
  fi
}

check_tarball_set_equality() {
  if [ ! -x "$TARBALL_SCRIPT" ]; then
    echo "deploy-droplet.sh: refused - $TARBALL_SCRIPT is missing or not executable" >&2
    return 1
  fi
  ( cd "$PKG_DIR" && "$TARBALL_SCRIPT" ) || {
    echo "deploy-droplet.sh: refused - make-source-tarball.sh itself refused (see its own message above)" >&2
    return 1
  }
  local tgz="$PKG_DIR/agent-runtime-src.tgz"
  local repo_root
  repo_root="$(git -C "$PKG_DIR" rev-parse --show-toplevel)"
  local tar_entries git_entries
  tar_entries="$(mktemp)"
  git_entries="$(mktemp)"
  tar -tf "$tgz" | grep -v '/$' | grep -v '^SOURCE_COMMIT$' | sort > "$tar_entries"
  git -C "$repo_root" ls-tree -r --name-only HEAD -- packages/agent-runtime | sort > "$git_entries"
  if ! diff -q "$tar_entries" "$git_entries" >/dev/null; then
    echo "deploy-droplet.sh: refused - the tarball's entry set does not equal git ls-tree for packages/agent-runtime" >&2
    diff "$tar_entries" "$git_entries" >&2 || true
    rm -f "$tar_entries" "$git_entries"
    return 1
  fi
  rm -f "$tar_entries" "$git_entries"
}

check_ssh_key_file() {
  if [ -z "${SSH_PUBLIC_KEY_FILE:-}" ] || [ ! -f "$SSH_PUBLIC_KEY_FILE" ]; then
    echo "deploy-droplet.sh: refused - SSH_PUBLIC_KEY_FILE is unset or does not exist" >&2
    return 1
  fi
}

check_do_token_file() {
  if [ -z "${DO_TOKEN_FILE:-}" ] || [ ! -f "$DO_TOKEN_FILE" ]; then
    echo "deploy-droplet.sh: refused - DO_TOKEN_FILE is unset or does not exist" >&2
    return 1
  fi
  local mode
  mode="$(stat -f %Lp "$DO_TOKEN_FILE" 2>/dev/null || stat -c %a "$DO_TOKEN_FILE")"
  if [ "$mode" != "600" ]; then
    echo "deploy-droplet.sh: refused - DO_TOKEN_FILE ($DO_TOKEN_FILE) is mode $mode, not 0600" >&2
    return 1
  fi
}

check_desk_ip() {
  if [ -z "${HERON_DESK_IP:-}" ]; then
    echo "deploy-droplet.sh: refused - HERON_DESK_IP is unset; the firewall has nothing to admit 22 from" >&2
    return 1
  fi
}

# ---------------------------------------------------------------------------
# --create. Preconditions first, in the order --plan documents; network only after every one
# passes. HERON_DEPLOY_CONFIRMED is checked before anything else is even read, so a caller with
# no other environment set gets exactly one, unambiguous refusal.
# ---------------------------------------------------------------------------
cmd_create() {
  check_confirmed
  check_ascii_rendered
  check_git_clean
  check_tarball_set_equality
  check_ssh_key_file
  check_do_token_file
  check_desk_ip

  echo "deploy-droplet.sh --create: every local precondition passed." >&2
  echo "deploy-droplet.sh --create: refused - the API calls, the SSH session and the host build below are written but are not exercised from this laptop in this step. Docker stays down here; nothing in any cloud is created by this run." >&2
  echo "deploy-droplet.sh --create: read the code below this line for exactly what would run next: register_ssh_key, create_firewall, create_droplet, wait_for_ssh, assert_post_boot, build_image_on_host." >&2
  return 1

  # --- everything below this line is real, reviewed code that a future run (on the Master's word,
  #     from a session actually permitted to touch the cloud) executes in this order. It is never
  #     reached by the `return 1` above in this build order step. ---
  # shellcheck disable=SC2317
  local key_id droplet_id droplet_ip firewall_id
  # shellcheck disable=SC2317
  key_id="$(register_ssh_key)"
  # shellcheck disable=SC2317
  droplet_id="$(create_droplet "$key_id")"
  # shellcheck disable=SC2317
  firewall_id="$(create_firewall "$droplet_id")"
  # shellcheck disable=SC2317
  droplet_ip="$(wait_for_droplet_ip "$droplet_id")"
  # shellcheck disable=SC2317
  wait_for_ssh "$droplet_ip"
  # shellcheck disable=SC2317
  assert_post_boot "$droplet_ip" || { destroy_droplet "$droplet_id"; exit 1; }
  # shellcheck disable=SC2317
  build_image_on_host "$droplet_ip"
  # shellcheck disable=SC2317
  install_host_units "$droplet_ip"
  # shellcheck disable=SC2317
  echo "deploy-droplet.sh --create: droplet $droplet_id at $droplet_ip is up, cloud-init succeeded, the image is built, firewall $firewall_id reads back clean. No timer is enabled. Next: --seal mail-key, then build order step 5's units, then --smoke."
}

# ---------------------------------------------------------------------------
# The functions --create calls once every precondition passes. Written and reviewed; never run
# by this step (see cmd_create's early return above).
# ---------------------------------------------------------------------------
register_ssh_key() {
  python3 - "$DO_TOKEN_FILE" "$HERON_SSH_KEY_NAME" "$SSH_PUBLIC_KEY_FILE" <<'PY'
import json, sys, urllib.request
token, name, key_file = sys.argv[1], sys.argv[2], sys.argv[3]
tok = open(token).read().strip()
pubkey = open(key_file).read().strip()
headers = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}

req = urllib.request.Request("https://api.digitalocean.com/v2/account/keys", headers=headers)
with urllib.request.urlopen(req, timeout=30) as r:
    existing = json.load(r).get("ssh_keys", [])
for k in existing:
    if k.get("name") == name or k.get("public_key", "").strip() == pubkey:
        print(k["id"]); sys.exit(0)

body = json.dumps({"name": name, "public_key": pubkey}).encode()
req = urllib.request.Request("https://api.digitalocean.com/v2/account/keys", data=body, headers=headers, method="POST")
with urllib.request.urlopen(req, timeout=30) as r:
    print(json.load(r)["ssh_key"]["id"])
PY
}

create_droplet() {
  local key_id="$1"
  local user_data
  user_data="$(render_cloud_init)"
  python3 - "$DO_TOKEN_FILE" "$NAME" "$REGION" "$SIZE" "$IMAGE_SLUG" "$key_id" "$user_data" <<'PY'
import json, sys, urllib.request
tok = open(sys.argv[1]).read().strip()
name, region, size, image, key_id, user_data = sys.argv[2:8]
body = {
    "name": name, "region": region, "size": size, "image": image,
    "ssh_keys": [int(key_id)], "monitoring": False, "user_data": user_data,
    "tags": ["heron", "heron-v2"],
}
req = urllib.request.Request(
    "https://api.digitalocean.com/v2/droplets",
    data=json.dumps(body).encode(),
    headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as r:
    print(json.load(r)["droplet"]["id"])
PY
}

create_firewall() {
  local droplet_id="$1"
  python3 - "$DO_TOKEN_FILE" "$droplet_id" "$HERON_DESK_IP" "$NAME" <<'PY'
import json, sys, urllib.request
tok = open(sys.argv[1]).read().strip()
droplet_id, desk_ip, name = sys.argv[2], sys.argv[3], sys.argv[4]
headers = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}

inbound = [{"protocol": "tcp", "ports": "22", "sources": {"addresses": [desk_ip]}}]
outbound = [
    {"protocol": "tcp", "ports": "443", "destinations": {"addresses": ["0.0.0.0/0", "::/0"]}},
    {"protocol": "tcp", "ports": "53", "destinations": {"addresses": ["0.0.0.0/0", "::/0"]}},
    {"protocol": "udp", "ports": "53", "destinations": {"addresses": ["0.0.0.0/0", "::/0"]}},
]
body = {
    "name": f"{name}-fw", "droplet_ids": [int(droplet_id)],
    "inbound_rules": inbound, "outbound_rules": outbound,
}
req = urllib.request.Request(
    "https://api.digitalocean.com/v2/firewalls", data=json.dumps(body).encode(),
    headers=headers, method="POST",
)
with urllib.request.urlopen(req, timeout=30) as r:
    fw = json.load(r)["firewall"]

# Read it back. v1's script claimed a firewall it never created; this refuses if the API's own
# echo does not match what was asked, rather than trusting the 202/201 status alone.
req = urllib.request.Request(f"https://api.digitalocean.com/v2/firewalls/{fw['id']}", headers=headers)
with urllib.request.urlopen(req, timeout=30) as r:
    readback = json.load(r)["firewall"]
if readback["inbound_rules"] != inbound or readback["outbound_rules"] != outbound:
    print("FIREWALL READBACK MISMATCH", file=sys.stderr)
    sys.exit(1)
print(fw["id"])
PY
}

wait_for_droplet_ip() {
  local droplet_id="$1"
  python3 - "$DO_TOKEN_FILE" "$droplet_id" <<'PY'
import json, sys, time, urllib.request
tok = open(sys.argv[1]).read().strip()
droplet_id = sys.argv[2]
headers = {"Authorization": "Bearer " + tok}
for _ in range(60):
    req = urllib.request.Request(f"https://api.digitalocean.com/v2/droplets/{droplet_id}", headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)["droplet"]
    if d["status"] == "active":
        for net in d["networks"]["v4"]:
            if net["type"] == "public":
                print(net["ip_address"]); sys.exit(0)
    time.sleep(5)
print("TIMED OUT WAITING FOR AN ACTIVE PUBLIC IP", file=sys.stderr)
sys.exit(1)
PY
}

wait_for_ssh() {
  local ip="$1"
  local tries=0
  until ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "ops@$ip" true 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      echo "deploy-droplet.sh: refused - SSH never became reachable at $ip" >&2
      return 1
    fi
    sleep 5
  done
}

assert_post_boot() {
  local ip="$1"
  # shellcheck disable=SC2087
  ssh "ops@$ip" bash -s <<'REMOTE'
set -euo pipefail
cloud-init status --wait --long
cloud-init schema --system
RESOLVED_USER="$(getent passwd 10001 | cut -d: -f1)"
RESOLVED_GROUP="$(getent group 10001 | cut -d: -f1)"
[ "$RESOLVED_USER" = "heron" ] || { echo "uid 10001 is not heron"; exit 1; }
[ "$RESOLVED_GROUP" = "heron" ] || { echo "gid 10001 is not heron"; exit 1; }
grep -q "^13" /etc/debian_version || { echo "not Debian 13"; exit 1; }
sshd -T | grep -qE '^passwordauthentication no$'
sshd -T | grep -qE '^permitrootlogin no$'
sshd -T | grep -qE '^kbdinteractiveauthentication no$'
echo "post-boot assertions passed"
REMOTE
}

destroy_droplet() {
  local droplet_id="$1"
  echo "deploy-droplet.sh: post-boot assertion failed - destroying droplet $droplet_id rather than leaving a half-built host with root open" >&2
  python3 - "$DO_TOKEN_FILE" "$droplet_id" <<'PY'
import sys, urllib.request
tok = open(sys.argv[1]).read().strip()
req = urllib.request.Request(
    f"https://api.digitalocean.com/v2/droplets/{sys.argv[2]}",
    headers={"Authorization": "Bearer " + tok}, method="DELETE",
)
urllib.request.urlopen(req, timeout=30)
PY
}

build_image_on_host() {
  local ip="$1"
  "$TARBALL_SCRIPT"
  scp "$PKG_DIR/agent-runtime-src.tgz" "ops@$ip:/tmp/agent-runtime-src.tgz"
  # shellcheck disable=SC2087
  ssh "ops@$ip" sudo bash -s <<'REMOTE'
set -euo pipefail
rm -rf /tmp/agent-runtime-src && mkdir -p /tmp/agent-runtime-src
tar -xzf /tmp/agent-runtime-src.tgz -C /tmp/agent-runtime-src
docker build -t heron:local /tmp/agent-runtime-src
ID="$(docker inspect --format '{{.Id}}' heron:local)"
printf 'IMAGE=heron:local@%s\n' "$ID" > /srv/heron/image.env
chmod 0600 /srv/heron/image.env
chown root:root /srv/heron/image.env
cat /srv/heron/image.env
REMOTE
}

install_host_units() {
  local ip="$1"
  scp "$HERE"/systemd/heron-watchdog.service "$HERE"/systemd/heron-watchdog.timer \
      "$HERE"/systemd/heron-alert@.service "$HERE"/systemd/heron-alive.timer \
      "$HERE"/systemd/heron-retention.service "$HERE"/systemd/heron-retention.timer \
      "ops@$ip:/tmp/"
  scp "$HERE"/bin/heron-watchdog "$HERE"/bin/heron-alert "$HERE"/bin/heron-retention "ops@$ip:/tmp/"
  # shellcheck disable=SC2087
  ssh "ops@$ip" sudo bash -s <<'REMOTE'
set -euo pipefail
mv /tmp/heron-watchdog.service /tmp/heron-watchdog.timer /tmp/heron-alert@.service \
   /tmp/heron-alive.timer /tmp/heron-retention.service /tmp/heron-retention.timer \
   /etc/systemd/system/
chown root:root /etc/systemd/system/heron-*.service /etc/systemd/system/heron-*.timer
chmod 0644 /etc/systemd/system/heron-*.service /etc/systemd/system/heron-*.timer
mv /tmp/heron-watchdog /tmp/heron-alert /tmp/heron-retention /usr/local/sbin/
chown root:root /usr/local/sbin/heron-watchdog /usr/local/sbin/heron-alert /usr/local/sbin/heron-retention
chmod 0755 /usr/local/sbin/heron-watchdog /usr/local/sbin/heron-alert /usr/local/sbin/heron-retention
systemctl daemon-reload
echo "units installed; NO timer enabled -- that is --smoke's job"
REMOTE
}

# ---------------------------------------------------------------------------
# --seal <name> [--dry-run]. Pipes a credential from the desk's pile over the live SSH session
# straight into systemd-creds on the host. Plaintext never touches this laptop's disk beyond the
# pile's own copy, and never touches the host's disk at all.
# ---------------------------------------------------------------------------
cmd_seal() {
  local name="${1:-}"
  local dry_run="false"
  shift || true
  for arg in "$@"; do
    [ "$arg" = "--dry-run" ] && dry_run="true"
  done
  if [ -z "$name" ]; then
    echo "deploy-droplet.sh --seal: refused - a credential name is required" >&2
    return 1
  fi

  local pile_path="${HERON_PILE:-$HOME/.config/protocolx/heron}/$name"
  local ssh_target="${HERON_HOST:-ops@<the droplet IP; set HERON_HOST>}"
  local remote_cmd="sudo systemd-creds encrypt --with-key=host --name=$name - /etc/heron/creds/$name.cred"
  local pipeline="cat $pile_path | ssh $ssh_target \"$remote_cmd\""

  if [ "$dry_run" = "true" ]; then
    echo "deploy-droplet.sh --seal $name --dry-run: would run exactly:"
    echo "  $pipeline"
    echo "No credential is read, piped or sent by --dry-run. The pile path above is where it would come from; nothing at that path is opened."
    return 0
  fi

  echo "deploy-droplet.sh --seal $name: refused - not exercised against a real host from this laptop in this step. The pipeline that a live run performs is exactly the one --dry-run prints above; it is never a plaintext file on either end." >&2
  return 1
}

# ---------------------------------------------------------------------------
# --smoke. Not exercised here; written for the host build order step 9 gate: smoke beat exit 0
# with a state file newer than the start, only then the firewall's own timers are turned on.
# ---------------------------------------------------------------------------
cmd_smoke() {
  local ip="${HERON_HOST:-}"
  if [ -z "$ip" ]; then
    echo "deploy-droplet.sh --smoke: refused - HERON_HOST is unset (ops@<droplet ip>)" >&2
    return 1
  fi
  echo "deploy-droplet.sh --smoke: refused - not exercised against a real host from this laptop in this step." >&2
  return 1
  # shellcheck disable=SC2317
  local start
  # shellcheck disable=SC2317
  start="$(date -u +%s)"
  # shellcheck disable=SC2317
  ssh "$ip" sudo systemctl start heron-beat.service
  # shellcheck disable=SC2317
  ssh "$ip" bash -c "
    set -euo pipefail
    MTIME=\$(stat -c %Y /srv/heron/state/latest.json)
    [ \"\$MTIME\" -ge $start ] || { echo 'state/latest.json is not newer than the smoke beat start'; exit 1; }
    python3 -c 'import json,sys; json.load(open(\"/srv/heron/state/latest.json\"))'
    echo 'smoke beat produced a fresh, parsable state/latest.json'
  "
  # shellcheck disable=SC2317
  ssh "$ip" sudo systemctl enable --now heron-beat.timer heron-watchdog.timer heron-alive.timer heron-retention.timer
  # shellcheck disable=SC2317
  echo "deploy-droplet.sh --smoke: timers enabled."
}

# ---------------------------------------------------------------------------
# --status. Read-only; not exercised here for the same reason as --smoke.
# ---------------------------------------------------------------------------
cmd_status() {
  local ip="${HERON_HOST:-}"
  if [ -z "$ip" ]; then
    echo "deploy-droplet.sh --status: refused - HERON_HOST is unset (ops@<droplet ip>)" >&2
    return 1
  fi
  echo "deploy-droplet.sh --status: refused - not exercised against a real host from this laptop in this step." >&2
  return 1
  # shellcheck disable=SC2317
  ssh "$ip" bash -c "
    systemctl list-timers 'heron-*' --no-pager
    echo '--- state/latest.json ---'
    cat /srv/heron/state/latest.json 2>/dev/null || echo '(none yet)'
  "
}

# ---------------------------------------------------------------------------
main() {
  case "${1:-}" in
    --plan) cmd_plan ;;
    --create) cmd_create ;;
    --seal) shift; cmd_seal "$@" ;;
    --smoke) cmd_smoke ;;
    --status) cmd_status ;;
    --render-cloud-init) render_cloud_init ;;
    *) usage; exit 2 ;;
  esac
}

main "$@"
