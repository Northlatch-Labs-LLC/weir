#!/usr/bin/env bash
# Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
#                           Never writes a plaintext file anywhere, never puts the value in an
#                           argv or an environment: stdin only. Refuses a name outside
#                           ^[a-z][a-z0-9-]{0,31}$ before it reads anything at all, and refuses
#                           without HERON_DEPLOY_CONFIRMED=1 -- the same word --create needs.
#                           --dry-run prints the exact pipeline and needs neither.
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
#   HERON_HOST                 ops@<droplet ip>, for --seal/--smoke/--status.
#   HERON_PILE                 the desk's pile directory (default ~/.config/protocolx/heron).
#   REGION, SIZE, NAME         override the droplet's region/size/name.
#   HERON_NO_NETWORK=1         every function in this file that would touch the network refuses
#                               unless HERON_STUB_DIR names a directory holding a stand-in for it.
#                               This is how test/host-fixes.test.mjs runs the create sequence --
#                               including the destroy-on-failure path -- with no droplet, and it
#                               is the ONLY way the sequence below the preconditions runs at all:
#                               without this variable --create still refuses before its first API
#                               call, exactly as it did before this fix (see cmd_create).
#   HERON_STUB_DIR             the stand-in directory. Test-only; unset in every real run.
#   HERON_RUN_RECORD_DIR       where the run record is appended (default digitalocean/runs/).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$HERE/.." && pwd)"
CHECK_ASCII="$PKG_DIR/scripts/check-ascii.py"
CLOUD_INIT="$HERE/cloud-init.yaml"
LIB_DIR="$HERE/lib"
POST_BOOT_ASSERT="$LIB_DIR/post-boot-assert.sh"
FIREWALL_MATCH="$LIB_DIR/firewall_match.py"
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
# The one seam every network call in this file passes through.
#
# There is no way to test "the deploy destroys the droplet when the post-boot check fails" without
# running the create sequence, and no way to run the create sequence on this laptop without
# something standing in for DigitalOcean and for SSH. So every function that touches the network
# asks this first. With HERON_NO_NETWORK=1 and a stub directory the call goes to the stub; with
# HERON_NO_NETWORK=1 and no stub directory it refuses loudly rather than reaching the network
# anyway; with neither it returns 1 and the caller makes the real call.
#
# It cannot be used to make a real deploy happen: cmd_create still refuses outright unless
# HERON_NO_NETWORK=1 is set, and when it is set nothing here can reach a network at all.
# ---------------------------------------------------------------------------
is_stubbed() {
  [ "${HERON_NO_NETWORK:-}" = "1" ] || return 1
  local caller="${FUNCNAME[1]}"
  if [ -z "${HERON_STUB_DIR:-}" ]; then
    echo "deploy-droplet.sh: refused - HERON_NO_NETWORK=1 is set and $caller makes a network call; there is no HERON_STUB_DIR to stand in for it" >&2
    exit 1
  fi
  if [ ! -x "$HERON_STUB_DIR/$caller" ]; then
    echo "deploy-droplet.sh: refused - HERON_NO_NETWORK=1 is set and $HERON_STUB_DIR/$caller does not exist or is not executable" >&2
    exit 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# The run record. One line per event, appended BEFORE the thing it describes happens -- so a
# rollback that is itself interrupted still leaves the droplet id it was about to destroy written
# down. v1 left running, billed hosts on the account with no record that they had ever existed.
# ---------------------------------------------------------------------------
RUN_RECORD_DIR="${HERON_RUN_RECORD_DIR:-$HERE/runs}"

record_run() {
  local event="$1" detail="${2:-}"
  mkdir -p "$RUN_RECORD_DIR"
  RECORD_EVENT="$event" RECORD_DETAIL="$detail" \
  RECORD_DROPLET="${HERON_DROPLET_ID:-}" RECORD_FIREWALL="${HERON_FIREWALL_ID:-}" \
  RECORD_NAME="$NAME" RECORD_REGION="$REGION" \
  python3 "$LIB_DIR/record-run.py" "$RUN_RECORD_DIR/deploy-runs.jsonl"
  echo "deploy-droplet.sh: recorded $event (droplet=${HERON_DROPLET_ID:-none} firewall=${HERON_FIREWALL_ID:-none}) in $RUN_RECORD_DIR/deploy-runs.jsonl" >&2
}

# ---------------------------------------------------------------------------
# The rollback. Armed the moment the first billable thing exists, disarmed only by success.
#
# Before this, ONE step carried `|| destroy_droplet`: the post-boot check. Every other way the
# sequence could stop -- the firewall call, the wait for an IP, the wait for SSH, the image build,
# a Ctrl-C -- aborted under `set -e` and left a running, billed, possibly half-firewalled host on
# the account with nothing written down anywhere (Security's B6 on step 6).
# ---------------------------------------------------------------------------
HERON_DROPLET_ID=""
HERON_FIREWALL_ID=""
HERON_DEPLOY_SUCCEEDED=0

rollback_on_failure() {
  local status=$?
  trap - EXIT
  if [ "$HERON_DEPLOY_SUCCEEDED" = "1" ]; then
    return 0
  fi
  if [ -z "$HERON_DROPLET_ID" ] && [ -z "$HERON_FIREWALL_ID" ]; then
    return "$status"
  fi
  echo "deploy-droplet.sh: the deploy did not reach success (exit $status). Destroying what it made rather than leaving it running and billed." >&2
  record_run "rollback-begin" "exit $status"
  if [ -n "$HERON_DROPLET_ID" ]; then
    destroy_droplet "$HERON_DROPLET_ID" \
      || echo "deploy-droplet.sh: WARNING - destroying droplet $HERON_DROPLET_ID failed; it is still on the account and it is in the run record" >&2
  fi
  if [ -n "$HERON_FIREWALL_ID" ]; then
    delete_firewall "$HERON_FIREWALL_ID" \
      || echo "deploy-droplet.sh: WARNING - deleting firewall $HERON_FIREWALL_ID failed; it is still on the account and it is in the run record" >&2
  fi
  record_run "rollback-done" "exit $status"
  return "$status"
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

  # The header of this file has always said --plan renders and ASCII-checks the cloud-init; it did
  # not (Security's note N4). It does now, on the RENDERED copy -- the same bytes --create hands to
  # the API, not the template -- and --plan exits non-zero if that check fails, because a plan whose
  # own user_data would make cloud-init apply nothing is not a plan, it is v1.
  local rendered_tmp rendered_bytes ascii_verdict ascii_status
  rendered_tmp="$(mktemp)"
  render_cloud_init > "$rendered_tmp"
  rendered_bytes="$(wc -c < "$rendered_tmp" | tr -d " ")"
  ascii_status=0
  if ascii_verdict="$(python3 "$CHECK_ASCII" "$rendered_tmp" 2>&1)"; then
    ascii_verdict="PASS - every one of the $rendered_bytes rendered bytes is <= 0x7F${ascii_verdict:+ ($ascii_verdict)}"
  else
    ascii_verdict="FAIL - $ascii_verdict"
    ascii_status=1
  fi
  rm -f "$rendered_tmp"

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

== Firewall (created FIRST, before the droplet exists, and targeted by tag) ==
  name:      $NAME-fw
  targets:   tag heron-v2 -- and the droplet is created carrying that tag, so it is inside the
             firewall from its first second. v1's order was droplet-then-firewall, which left the
             host's sshd on the public internet with no cloud firewall for the length of one API
             call: key-only auth guarded that window, but one control rather than two, and
             nothing asserted it.
  inbound:   tcp/22 from $desk_ip only
  outbound:  tcp/443 (fullnode, Resend, apt) and tcp/53 + udp/53 (DNS)
  no other rule, inbound or outbound
  readback:  the API's own echo is compared on protocol, ports and the sorted address list, in
             both directions, as multisets -- so a rule the deploy never asked for is a mismatch
             as loudly as a missing one. It is NOT compared as raw objects: DigitalOcean echoes
             all four source/destination keys while the request sends one, which made a correct
             firewall compare unequal every time. lib/firewall_match.py, tested directly.

== The rendered cloud-init, checked here rather than described ==
  rendered bytes: $rendered_bytes
  ASCII guard:    $ascii_verdict
  (scripts/check-ascii.py over the RENDERED user_data, never the template. One byte above 0x7F
   makes cloud-init refuse the whole document and apply NOTHING, which is how v1 booted with root
   open. --plan exits non-zero if this line says FAIL.)

== Host paths (created by cloud-init's runcmd, all before any secret is placed) ==
  /srv/heron                          0751 root:root   (o+x is traversal only, no o+r: the purse
                                                        account is not in group root and must be
                                                        able to reach its own program below)
  /srv/heron/bin                      0755 root:root   (heron-beat, placed at build order step 5)
  /srv/heron/runs                     2770 root:heron  (beat logs AND runs/<beat-id>/intent.json)
  /srv/heron/runs/archive             2770 root:heron  (heron-retention's destination)
  /srv/heron/state                    2770 root:heron  (latest.json, beats.jsonl, alerts.jsonl,
                                                        and the watchdog's degraded marker)
  /srv/heron/keys                     0700 purse:purse (the hot key's home. Created here, at an
                                                        asserted mode, rather than by hand at
                                                        deploy time by whoever noticed first)
  /srv/heron/purse                    0750 purse:purse
  /srv/heron/purse/dist               0750 purse:purse (the signer's compiled server, step 5)
  /srv/heron/policy                   0755 root:root   (world-readable on purpose: the policy is
                                                        pinned by hash in heron-purse.service and
                                                        a rule nobody can read is not a rule)
  /var/lib/heron                      0700 purse:purse (the hash-chained audit log's home)
  /var/lib/heron/audit                0700 purse:purse
  /srv/heron/image.env                0600 root:root   (empty placeholder; --create writes the
                                                        pinned digest, commit and tarball sha256
                                                        after the host build)
  /etc/heron                          0700 root:root
  /etc/heron/creds                    0700 root:root   (the ONE sealed-credential directory on
                                                        this host. Every unit, --seal, the README
                                                        and this plan name it and nothing else)
  /etc/ssh/sshd_config.d/00-heron.conf  0644 root:root (sorts before cloud-init's 50-cloud-init.conf)
  /etc/apt/apt.conf.d/20auto-upgrades   0644 root:root (unattended-upgrades actually enabled, and
                                                        asserted out of apt-config dump in runcmd)
  /etc/systemd/journald.conf.d/00-heron.conf 0644 root:root (SystemMaxUse=200M; logrotate cannot
                                                        rotate the journal, journald bounds itself)
  /etc/logrotate.d/heron              0644 root:root   (installed by --create with the units:
                                                        state/beats.jsonl and state/alerts.jsonl
                                                        only -- runs/ is heron-retention's, because
                                                        a per-beat file is the shape rotate N
                                                        cannot bound. That was v1's defect 8b)

== Accounts (created by cloud-init only after it asserts both ids are free, and re-asserted after) ==
  heron   gid 10001 / uid 10001  nologin, no home   the uid the container runs as; owns nothing
                                                    but the group on runs/ and state/
  purse   gid 10002 / uid 10002  nologin, no home   heron-purse.service's User=/Group=. The only
                                                    account on this host that ever holds the hot
                                                    key. It was created by nothing before this
                                                    fix: the signer would not start, the beat
                                                    unit Requires= it and so would never run, and
                                                    a hand-made account lands on whatever id is
                                                    free -- the uid collision that scrapped v1,
                                                    this time on the key's own account.
  purse is NOT in the heron group and heron is NOT in the purse group; the post-boot check asserts it.
  ops     a login account with NOPASSWD:ALL, said plainly: the desk's SSH key is root on this host.
          disable_root:true bounds the direct-root path only; the bound that matters is the
          firewall and the key living in the Master's own agent. v1's second account, heron-ops,
          carried the same key, was used by nothing, and is removed -- one door.

== Credentials this step seals (ledger row per credential; no value is ever printed) ==
  name       purpose                          source pile                              destination                     mode  encryption                             revocation
  mail-key   send-only Resend key for alerts  ~/.config/protocolx/heron/mail-key        /etc/heron/creds/mail-key.cred  0600  systemd-creds encrypt --with-key=host  revoke at Resend; --seal mail-key again with a fresh key

  The mode row says 0600 because that is what systemd-creds actually writes; this plan said 0400,
  which was a number nobody had read off a host (Security's note N6). What systemd decrypts into
  \$CREDENTIALS_DIRECTORY at unit start is 0400, and that is a different file.

  heron-hot, heron-policy and the OpenRouter model key are build order steps 4 and 8's rows; this
  step only builds the --seal mechanism they will use, unchanged, once those keys exist. Nothing
  in this step generates, reads or touches any of them.

== What --create does, in this order, each step a refusal naming the rule if it fails ==
  1. refuses unless HERON_DEPLOY_CONFIRMED=1 -- checked before anything else is even read
  2. refuses unless the RENDERED cloud-init passes scripts/check-ascii.py (never the template)
  3. refuses unless \`git status --porcelain\` is empty
  4. refuses unless the source tarball's entry set equals \`git ls-tree\` for packages/agent-runtime, exactly
  5. refuses unless SSH_PUBLIC_KEY_FILE and DO_TOKEN_FILE (mode 0600) both exist
  6. creates the FIREWALL first, targeted at tag heron-v2, and reads it back through
     lib/firewall_match.py -- refusing on any difference in protocol, ports or addresses, in
     either direction
  7. from that moment a rollback trap is armed and stays armed until the deploy declares success:
     ANY failure or interrupt below destroys the droplet and deletes the firewall, after writing
     the ids to digitalocean/runs/deploy-runs.jsonl first. Before this, one single step carried a
     destroy path; every other way to fail left a running, billed host on the account with no
     record it existed.
  8. registers the SSH key if needed, then creates the droplet with monitoring:false, the rendered
     user_data and the heron-v2 tag -- so it is born inside the firewall
  9. waits for an active public IP, then for SSH
 10. pipes lib/post-boot-assert.sh over that session: cloud-init status --wait --long is
     "status: done" with an empty error list, cloud-init schema --system passes, uid/gid 10001 is
     heron and 10002 is purse, /etc/debian_version starts with 13, 00-heron.conf sorts first in
     sshd_config.d, and the three hardening keywords read "no" out of sshd -T's own merged output.
     Every privileged line there runs under sudo: without it every one of them failed and the
     deploy destroyed each droplet it made, seconds after boot, having asserted nothing.
     The same file asserts every path above at its owner and mode, and that no credential-shaped
     file exists anywhere under /srv/heron.
 11. copies the source tarball, verifies its sha256 ON THE HOST before docker build reads it,
     builds the image there, writes /srv/heron/image.env with the image id, the source commit and
     that sha256
 12. installs digitalocean/systemd/*.{service,timer} to /etc/systemd/system,
     digitalocean/bin/heron-{watchdog,alert,retention} to /usr/local/sbin (0755 root:root) and
     logrotate/heron to /etc/logrotate.d, then \`systemctl daemon-reload\` -- enables NO timer.
     --smoke is the only thing that ever does that.

== What --create does NOT do in this build ==
  It refuses at step 6 unless HERON_NO_NETWORK=1 is set, and under that variable every network
  call in this file goes to a stub directory or refuses outright. The Master's word gates the
  real run; the executive's ruling on Security's step-6 gate stands: --create against the
  account may run once B1-B6 have landed and a second read-only pass has confirmed them.
PLAN
  return "$ascii_status"
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

  # THE GATE, unchanged in effect. Before this fix these three lines were an unconditional
  # `return 1` and the whole sequence below was unreachable code -- which is exactly why the
  # sequence had never been run and carried a destroy path nothing had ever taken. The gate is now
  # the same refusal with one exception that cannot reach a network: HERON_NO_NETWORK=1, under
  # which every call below goes to a stub directory or refuses (see is_stubbed). A real create
  # against the Master's account still stops here, and the executive's ruling on step 6 stands:
  # it may run only once B1-B6 have landed and a second read-only gate has confirmed them.
  if [ "${HERON_NO_NETWORK:-}" != "1" ]; then
    echo "deploy-droplet.sh --create: refused - the API calls, the SSH session and the host build below are written but are not exercised against a real account from this laptop in this step. Docker stays down here; nothing in any cloud is created by this run." >&2
    echo "deploy-droplet.sh --create: the sequence that would run, in order: create_firewall (tagged, FIRST), register_ssh_key, create_droplet (carrying that tag), wait_for_droplet_ip, wait_for_ssh, assert_post_boot, build_image_on_host, install_host_units." >&2
    return 1
  fi

  create_sequence
}

# The sequence itself, as its own function, so the trap's scope is exactly the window in which
# something billable exists.
create_sequence() {
  local key_id droplet_ip

  # THE FIREWALL FIRST, and by tag (Security's A1). v1's order was droplet-then-firewall, which
  # left the host's sshd on the public internet with no cloud firewall for as long as the second
  # call took. Key-only auth means that window was guarded, but it was guarded by one control
  # rather than two and nothing asserted it. A tag-targeted firewall applies to any droplet
  # carrying the tag from the moment the droplet exists, so the window closes entirely: the
  # droplet is born inside it.
  record_run "create-begin" "firewall first, then droplet"
  HERON_FIREWALL_ID="$(create_firewall)"

  # Armed here, at the first billable thing, and not one line later.
  trap rollback_on_failure EXIT
  record_run "firewall-created"

  key_id="$(register_ssh_key)"
  HERON_DROPLET_ID="$(create_droplet "$key_id")"
  record_run "droplet-created"

  droplet_ip="$(wait_for_droplet_ip "$HERON_DROPLET_ID")"
  wait_for_ssh "$droplet_ip"
  assert_post_boot "$droplet_ip"
  build_image_on_host "$droplet_ip"
  install_host_units "$droplet_ip"

  # Only here. Anything above this line that fails, for any reason, takes the rollback.
  HERON_DEPLOY_SUCCEEDED=1
  record_run "create-succeeded" "$droplet_ip"
  trap - EXIT
  echo "deploy-droplet.sh --create: droplet $HERON_DROPLET_ID at $droplet_ip is up, cloud-init succeeded, the image is built, firewall $HERON_FIREWALL_ID reads back clean. No timer is enabled. Next: --seal mail-key, then build order step 5's units, then --smoke."
}

# ---------------------------------------------------------------------------
# The functions --create calls once every precondition passes. Written and reviewed; never run
# by this step (see cmd_create's early return above).
# ---------------------------------------------------------------------------
register_ssh_key() {
  if is_stubbed; then "$HERON_STUB_DIR/register_ssh_key" "$@"; return; fi
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
  if is_stubbed; then "$HERON_STUB_DIR/create_droplet" "$@"; return; fi
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
    # heron-v2 is not decoration: the firewall created before this call targets that tag, so the
    # droplet is inside the firewall from its first second rather than from a second API call.
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
  if is_stubbed; then "$HERON_STUB_DIR/create_firewall" "$@"; return; fi
  python3 - "$DO_TOKEN_FILE" "$HERON_DESK_IP" "$NAME" "$FIREWALL_MATCH" <<'PY'
import importlib.util, json, sys, urllib.request
tok = open(sys.argv[1]).read().strip()
desk_ip, name, matcher_path = sys.argv[2], sys.argv[3], sys.argv[4]
headers = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}

TAG = "heron-v2"

inbound = [{"protocol": "tcp", "ports": "22", "sources": {"addresses": [desk_ip]}}]
outbound = [
    {"protocol": "tcp", "ports": "443", "destinations": {"addresses": ["0.0.0.0/0", "::/0"]}},
    {"protocol": "tcp", "ports": "53", "destinations": {"addresses": ["0.0.0.0/0", "::/0"]}},
    {"protocol": "udp", "ports": "53", "destinations": {"addresses": ["0.0.0.0/0", "::/0"]}},
]
# Targeted by TAG, not by droplet id: this is created BEFORE the droplet exists, and the droplet is
# created carrying the tag, so it is covered from its first second (Security's A1).
body = {
    "name": f"{name}-fw", "tags": [TAG],
    "inbound_rules": inbound, "outbound_rules": outbound,
}
req = urllib.request.Request(
    "https://api.digitalocean.com/v2/firewalls", data=json.dumps(body).encode(),
    headers=headers, method="POST",
)
with urllib.request.urlopen(req, timeout=30) as r:
    fw = json.load(r)["firewall"]

# Read it back. v1's script claimed a firewall it never created; this refuses if the API's own echo
# does not match what was asked, rather than trusting the 201 alone.
req = urllib.request.Request(f"https://api.digitalocean.com/v2/firewalls/{fw['id']}", headers=headers)
with urllib.request.urlopen(req, timeout=30) as r:
    readback = json.load(r)["firewall"]

# The comparison is the shared module, not `!=` on the raw objects: DigitalOcean echoes every rule
# with all four source/destination keys while the request sends one, so the raw comparison refused
# a correct firewall every time (Security's B5). One implementation, used here and tested directly
# by test/host-fixes.test.mjs against a DigitalOcean-shaped echo.
spec = importlib.util.spec_from_file_location("firewall_match", matcher_path)
firewall_match = importlib.util.module_from_spec(spec)
spec.loader.exec_module(firewall_match)

problems = firewall_match.differences({"inbound_rules": inbound, "outbound_rules": outbound}, readback)
if TAG not in (readback.get("tags") or []):
    problems.append(f"the firewall is not attached to tag {TAG}; the droplet would be born outside it")
if problems:
    print("FIREWALL READBACK MISMATCH", file=sys.stderr)
    for problem in problems:
        print(f"  {problem}", file=sys.stderr)
    sys.exit(1)
print(fw["id"])
PY
}

delete_firewall() {
  if is_stubbed; then "$HERON_STUB_DIR/delete_firewall" "$@"; return; fi
  local firewall_id="$1"
  echo "deploy-droplet.sh: deleting firewall $firewall_id" >&2
  python3 - "$DO_TOKEN_FILE" "$firewall_id" <<'PY'
import sys, urllib.request
tok = open(sys.argv[1]).read().strip()
req = urllib.request.Request(
    f"https://api.digitalocean.com/v2/firewalls/{sys.argv[2]}",
    headers={"Authorization": "Bearer " + tok}, method="DELETE",
)
urllib.request.urlopen(req, timeout=30)
PY
}

wait_for_droplet_ip() {
  if is_stubbed; then "$HERON_STUB_DIR/wait_for_droplet_ip" "$@"; return; fi
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
  if is_stubbed; then "$HERON_STUB_DIR/wait_for_ssh" "$@"; return; fi
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
  if is_stubbed; then "$HERON_STUB_DIR/assert_post_boot" "$@"; return; fi
  local ip="$1"
  # The assertions are a FILE, piped over the session, not a heredoc written here. As a heredoc
  # they were a block that only ever ran on a host nobody had built, and every line in them that
  # needed root ran without it: `sshd -T` is in /usr/sbin (off a non-root PATH) and reads
  # 0600 root host keys, `cloud-init status`/`schema --system` read root-only state. Under the
  # heredoc's own `set -euo pipefail` the first of those failures propagated and the deploy
  # destroyed every droplet it created, seconds after boot, while never once reading the three
  # hardening keywords it claimed to assert (Security's B4). lib/post-boot-assert.sh carries sudo
  # on every privileged line and is exercised against a fixture on this laptop by
  # test/host-fixes.test.mjs.
  ssh "ops@$ip" bash -s < "$POST_BOOT_ASSERT"
}

destroy_droplet() {
  if is_stubbed; then "$HERON_STUB_DIR/destroy_droplet" "$@"; return; fi
  local droplet_id="$1"
  echo "deploy-droplet.sh: destroying droplet $droplet_id rather than leaving a half-built, billed host on the account" >&2
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
  if is_stubbed; then "$HERON_STUB_DIR/build_image_on_host" "$@"; return; fi
  local ip="$1"
  "$TARBALL_SCRIPT"

  # The tarball's own sha256, computed here and checked there. Nothing asserted that what landed on
  # the host was what left this laptop before `docker build` read it (Security's note N5); the
  # committed sidecar names the COMMIT the tarball was built from, which is provenance, not
  # integrity. Both travel: the sha256 is what the host verifies, SOURCE_COMMIT inside the archive
  # is what a copy that has left this laptop still carries.
  local tgz="$PKG_DIR/agent-runtime-src.tgz"
  local sha256
  sha256="$(shasum -a 256 "$tgz" | cut -d' ' -f1)"
  echo "deploy-droplet.sh: tarball sha256 $sha256 (commit $(cat "$PKG_DIR/agent-runtime-src.sha"))" >&2

  scp "$tgz" "ops@$ip:/tmp/agent-runtime-src.tgz"
  # shellcheck disable=SC2087
  ssh "ops@$ip" sudo bash -s <<REMOTE
set -euo pipefail
ACTUAL="\$(sha256sum /tmp/agent-runtime-src.tgz | cut -d' ' -f1)"
if [ "\$ACTUAL" != "$sha256" ]; then
  echo "host: refused - the tarball on this host hashes \$ACTUAL, not $sha256; nothing is built from it" >&2
  exit 1
fi
echo "host: tarball sha256 verified: \$ACTUAL"
rm -rf /tmp/agent-runtime-src && mkdir -p /tmp/agent-runtime-src
tar -xzf /tmp/agent-runtime-src.tgz -C /tmp/agent-runtime-src
SHIPPED_COMMIT="\$(cat /tmp/agent-runtime-src/SOURCE_COMMIT)"
echo "host: building from commit \$SHIPPED_COMMIT"
docker build -t heron:local /tmp/agent-runtime-src
ID="\$(docker inspect --format '{{.Id}}' heron:local)"
printf 'IMAGE=heron:local@%s\n' "\$ID" > /srv/heron/image.env
printf 'SOURCE_COMMIT=%s\n' "\$SHIPPED_COMMIT" >> /srv/heron/image.env
printf 'SOURCE_SHA256=%s\n' "$sha256" >> /srv/heron/image.env
chmod 0600 /srv/heron/image.env
chown root:root /srv/heron/image.env
cat /srv/heron/image.env
REMOTE
}

install_host_units() {
  if is_stubbed; then "$HERON_STUB_DIR/install_host_units" "$@"; return; fi
  local ip="$1"
  scp "$HERE/logrotate/heron" "ops@$ip:/tmp/heron.logrotate"
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
# logrotate was installed as a package by cloud-init and given no config at all (Security's note
# N7). It bounds the two append-only JSONL sinks and nothing else -- runs/ is heron-retention's,
# because a per-beat file is the exact shape `rotate N` cannot bound.
mv /tmp/heron.logrotate /etc/logrotate.d/heron
chown root:root /etc/logrotate.d/heron
chmod 0644 /etc/logrotate.d/heron
logrotate --debug /etc/logrotate.d/heron >/dev/null
echo "logrotate config installed and parsed clean"
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

  # THE NAME IS VALIDATED FIRST, before a path is built, a file is opened or a host is contacted.
  # The name is interpolated into a command that runs as root on the host that holds the hot key:
  # `--seal 'x;curl ...|sh'` was root command execution there (Security's A2). It was not reachable
  # while both branches returned early -- and the code was still offered as "exactly the pipeline a
  # live run performs", which is precisely the kind of claim this rebuild exists to stop making.
  if [ -z "$name" ]; then
    echo "deploy-droplet.sh --seal: refused - a credential name is required" >&2
    return 1
  fi
  if ! [[ "$name" =~ ^[a-z][a-z0-9-]{0,31}$ ]]; then
    echo "deploy-droplet.sh --seal: refused - '$name' is not a credential name. It must match ^[a-z][a-z0-9-]{0,31}\$: lower-case, starting with a letter, digits and hyphens only, at most 32 characters. This name is interpolated into a root command on the host that holds the hot key." >&2
    return 1
  fi

  local pile_path="${HERON_PILE:-$HOME/.config/protocolx/heron}/$name"
  local ssh_target="${HERON_HOST:-<unset - set HERON_HOST to ops@<the droplet IP>>}"
  local remote_cmd="sudo systemd-creds encrypt --with-key=host --name=$name - /etc/heron/creds/$name.cred"
  local pipeline="cat $pile_path | ssh $ssh_target \"$remote_cmd\""

  if [ "$dry_run" = "true" ]; then
    echo "deploy-droplet.sh --seal $name --dry-run: would run exactly:"
    echo "  $pipeline"
    echo "No credential is read, piped or sent by --dry-run. The pile path above is where it would come from; nothing at that path is opened."
    return 0
  fi

  # The same word --create needs. Sealing a credential onto a host is not a local operation and it
  # is not the desk's to do unasked.
  check_confirmed

  if [ "$ssh_target" != "${HERON_HOST:-}" ] || [ -z "${HERON_HOST:-}" ]; then
    echo "deploy-droplet.sh --seal: refused - HERON_HOST is unset (ops@<droplet ip>)" >&2
    return 1
  fi
  if [ ! -f "$pile_path" ]; then
    echo "deploy-droplet.sh --seal: refused - there is nothing at $pile_path. The pile is the only source; this never generates a credential." >&2
    return 1
  fi
  local pile_mode
  pile_mode="$(stat -f %Lp "$pile_path" 2>/dev/null || stat -c %a "$pile_path")"
  if [ "$pile_mode" != "600" ] && [ "$pile_mode" != "400" ]; then
    echo "deploy-droplet.sh --seal: refused - $pile_path is mode $pile_mode; a credential in the pile is 0600 or 0400" >&2
    return 1
  fi

  # THE PIPELINE. `set -o pipefail` is on (line 44 of this file), so a failure at either end fails
  # the whole thing rather than reporting a sealed credential that was never written.
  #
  # The value crosses in exactly one way: this process's stdout into ssh's stdin into
  # systemd-creds' stdin. It is never an argv on either machine (visible in `ps` to every account),
  # never an environment variable, and never a file on the host -- systemd-creds reads `-` and
  # writes only the encrypted blob, which is sealed to this host's own key and worthless off it.
  echo "deploy-droplet.sh --seal $name: piping from the pile straight into systemd-creds on $ssh_target" >&2
  cat "$pile_path" | ssh "$ssh_target" "$remote_cmd"

  # The ledger row, printed as it happens. No value, ever.
  echo "deploy-droplet.sh --seal $name: sealed."
  echo "  ledger row: name=$name source=$pile_path destination=/etc/heron/creds/$name.cred mode=0600 encryption=systemd-creds --with-key=host revocation=revoke at the provider, then --seal $name again with a fresh value"
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
