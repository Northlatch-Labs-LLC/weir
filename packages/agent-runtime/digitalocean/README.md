<!-- Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev> -->

# The $4 home: one DigitalOcean droplet, one host, no registry

Build order step 6 (`work/rnd/agent/2026-09-05-executive-heron-v2-decided.md` §3), against the
CTO's spec (`2026-09-05-engineering-heron-v2-runtime-and-host.md` §3-4) and the CISO's, amended by
the executive to **one host**: a 1-of-2 multisig, one signer service (`heron-purse`; the
`LedgerCap` service also runs here). The CISO's original two-host purse design is superseded by
that ruling; nothing here reopens it.

**Nothing in this folder has been run against a real account, and this step creates nothing in any
cloud.**
`deploy-droplet.sh --create` refuses without `HERON_DEPLOY_CONFIRMED=1`, which is the Master's
word alone, checked before any other input is even read — and even with it set, this build order
step's own copy of `--create` stops after its preconditions pass and does not reach the API (see
the script's own comment at `cmd_create`). Every claim below is verified by
`node --test ../test/host.test.mjs` and by `deploy-droplet.sh --plan`'s own output.

## Shape

Debian 13 (trixie), `s-1vcpu-512mb-10gb`, region `fra1`, image slug `debian-13-x64` pinned
explicitly (v1's script said `debian-12-x64` while its own notes said Debian 13). SSH by key only;
a DigitalOcean cloud firewall admitting 22 from the desk's address alone and 443/53 outbound; no
DigitalOcean monitoring agent (`monitoring: false` at create, `do-agent` purged defensively in
`runcmd` regardless). No container registry: the image is built **on the droplet itself** from a
`git archive` source tarball (`scripts/make-source-tarball.sh`), because Docker stays down on this
laptop by the Master's word and a registry credential buys nothing for one host.

## Files

| File | What it is |
|---|---|
| `cloud-init.yaml` | OS setup only: one login account, SSH hardening, packages, the `/srv/heron`, `/var/lib/heron` and `/etc/heron/creds` layout, and BOTH system accounts — `heron` gid/uid 10001 (the container's) and `purse` gid/uid 10002 (the signer's, the only account that ever holds the hot key). ASCII-only; checked RENDERED, never the template. No timer enabled. |
| `deploy-droplet.sh` | `--plan` / `--create` / `--seal <name>` / `--smoke` / `--status`. See below. |
| `lib/post-boot-assert.sh` | The assertions that decide whether a new droplet lives, as a runnable file rather than a heredoc — piped over the deploy's SSH session, and run on this laptop against a fixture by `test/host-fixes.test.mjs`. Every privileged line carries `sudo`. |
| `lib/firewall_match.py` | The firewall readback comparison: protocol, ports and the sorted address list, both directions, as multisets. Has its own CLI so the comparison is tested directly against a DigitalOcean-shaped echo. |
| `lib/record-run.py` | Appends one line to `runs/deploy-runs.jsonl`. Every value arrives by environment, never argv. |
| `logrotate/heron` | Installed to `/etc/logrotate.d/heron`: bounds `state/beats.jsonl` and `state/alerts.jsonl` and nothing else. `runs/` is `heron-retention`'s, because a per-beat file is the exact shape `rotate N` cannot bound. |
| `runs/` | The deploy's own run record. What `--create` made, and what a rollback destroyed, with the ids — written before the destroy, never after. |
| `systemd/heron-watchdog.service`, `.timer` | Every 15 minutes: decides whether `state/latest.json` is older than 90 minutes, writes `state/alerts.jsonl` and a `degraded` marker, and exits non-zero **only when a notice is due** — the first staleness, every 6 hours while it lasts, and once on recovery. `OnFailure=` turns that into mail. |
| `systemd/heron-alert@.service` | Parameterized: `systemctl start heron-alert@<instance>.service` sends one notice. Credential loaded only via `LoadCredentialEncrypted`. |
| `systemd/heron-alive.timer` | Daily, 09:00 UTC, points at `heron-alert@alive.service`. |
| `systemd/heron-retention.service`, `.timer` | Daily: keeps the newest 200 **entries** and 512 MB under `runs/`, archiving (never deleting) the rest into `runs/archive/`. An entry is a plain file *or* a whole per-beat directory — a beat writes `runs/<beat-id>/`, and a retention that only saw plain files walked past every one of them. |
| `bin/heron-watchdog` | The 90-minute rule and the notice cadence, in bash. `HERON_STATE_FILE`/`HERON_STATE_DIR`/`HERON_WATCHDOG_MAX_AGE_SECONDS`/`HERON_WATCHDOG_REPEAT_SECONDS` overridable for tests. |
| `bin/heron-alert` | Sends through **Resend**'s HTTP API (see "Which provider" below). `--dry-run` needs no credential and touches no key-shaped environment variable. |
| `bin/heron-retention` | The archive-and-compress sweep, in python3. `HERON_RUNS_DIR`/`HERON_RETENTION_KEEP`/`HERON_RETENTION_CEILING_BYTES` overridable. |

Units this folder does **not** own, referenced by name only: `heron-beat.service`/`.timer`,
`heron-purse.service`, `heron-ledger.service` — build order step 5, on another branch.

## Which provider, fact-checked rather than assumed

The step that named this file pointed at "Brevo appears in the estate" as a hint toward which
transactional mail provider to use. Reading the estate before writing anything:
`work/reports/2026-09-04-*-keys-and-secrets-ledger*.md` says plainly "Brevo unused, AtomicMail
`protocolx@atomicmail.ai`", and `packages/web/lib/email-sender.ts` (branch
`feat/waitlist-email-sender`) already posts live company mail to `https://api.resend.com/emails`
with `Authorization: Bearer <key>` and a JSON body of `from`/`to`/`subject`/`html`/`text` — a grep
for `brevo`/`sendgrid`/`postmark` across `packages/web` returns nothing. `bin/heron-alert` is
written against Resend, matching the sender that already exists in this codebase.

**`heron@weir.social` must be a verified Resend sending domain before the first alert.** It is not
one today — the same open item `packages/web`'s own sender already names. Until it is, every call
this script makes to Resend is refused by Resend, which means the dead man is wired end to end and
silent: the watchdog decides correctly, `OnFailure=` starts the unit, the unit decrypts the
credential, and the message does not arrive. Nothing on this laptop can detect that, and no test
here claims to. It is a gate on build order step 10, whose own condition is that a forced failure
produces a real email in the desk's mailbox — not a footnote.

## The deploy script's five modes

- **`--plan`** — prints every resource, path, account and credential row this would create, with no
  side effect and no API call. It also **renders the cloud-init and runs the ASCII guard over it**,
  printing the byte count and the verdict, and exits non-zero if that check fails. Run it with
  `HERON_NO_NETWORK=1` to confirm the no-network claim for yourself; it never makes a network call
  in this mode regardless.
- **`--create`** — refuses without `HERON_DEPLOY_CONFIRMED=1`. Runs every precondition named in
  `--plan`'s own output, then, in this order:
  1. **the firewall first**, targeted at the tag `heron-v2`, read back and refused on any
     difference in protocol, ports or addresses in either direction;
  2. **a rollback trap armed from that moment** and disarmed only by success — any failure or
     interrupt after it destroys the droplet and deletes the firewall, writing the ids to
     `runs/deploy-runs.jsonl` first;
  3. the droplet, created **carrying that tag**, so it is inside the firewall from its first
     second;
  4. the post-boot assertions over SSH (`lib/post-boot-assert.sh`), which destroy the droplet
     rather than leave a half-built host with root open;
  5. the source tarball, **its sha256 verified on the host before `docker build` reads it**, the
     image built there, and `image.env` pinned by image id, source commit and that sha256;
  6. the units, the binaries and the logrotate config installed — and **no timer enabled**.
- **`--seal <name>`** — pipes one credential from the desk's pile straight into
  `systemd-creds encrypt --with-key=host --name=<name> - /etc/heron/creds/<name>.cred` over the
  live SSH session. The name is refused unless it matches `^[a-z][a-z0-9-]{0,31}$` **before
  anything is read**, because it is interpolated into a root command on the host that holds the hot
  key. The value crosses on stdin only: never an argv (`ps` shows an argv to every account on both
  machines), never an environment variable, never a file on the host. `set -o pipefail` means a
  failure at the far end fails the whole thing rather than reporting a credential that was never
  written. It needs the same `HERON_DEPLOY_CONFIRMED=1` as `--create`; `--dry-run` prints the exact
  pipeline, needs no word, and opens nothing.
- **`--smoke`** — runs one real beat as the real user; only a clean exit and a fresh, parsable
  `state/latest.json` unlock enabling `heron-beat.timer`, `heron-watchdog.timer`,
  `heron-alive.timer` and `heron-retention.timer`.
- **`--status`** — reads back the droplet, the firewall, the timers and the newest state file.

`--create` still refuses before its first API call unless `HERON_NO_NETWORK=1` is set, and under
that variable every network call in the script goes to a stub directory or refuses outright — which
is how `test/host-fixes.test.mjs` runs the create sequence, and the rollback path, with no droplet.
A real `--create` against the account is the executive's call on Security's second read-only pass,
not this script's. `--smoke` and `--status`'s SSH-driven bodies are written and reviewed and have
not been run against a real host from this laptop.

## What it costs

| Item | Monthly |
|---|---|
| Droplet `s-1vcpu-512mb-10gb` | $4.00 |
| Cloud firewall | $0.00 |
| Container registry | $0.00 (none — the image is built on the host) |
| **Total** | **$4.00** |

## Open, named rather than hidden

- **The Resend sending domain.** See above: it is unverified, so the alert path is wired and
  untested end to end. Step 10's drill is the gate.
- **`RestrictAddressFamilies=AF_INET AF_INET6` on the alert unit.** If this droplet resolves DNS
  through systemd-resolved's unix socket rather than glibc's own UDP path, that line breaks the one
  thing on the host that must not break silently. Named in the unit itself, asserted by the same
  drill. No Debian host here to settle it.
- **`/srv/heron` is 0751, not the CTO spec 3.7's 0750.** The `purse` account is not in group root
  and must traverse `/srv/heron` to open its own program and its policy; at 0750 the signer cannot
  start. `o+x` is traversal only — no `o+r`, so the directory still cannot be listed, and every
  child carries its own owner and mode. The one deliberate deviation from that spec in this folder.
- **`nodejs` was added to cloud-init's package list.** `heron-purse.service` starts
  `/usr/bin/node`, and nothing installed it: the signer would not have started and the beat unit,
  which `Requires=` it, would never have run. Reasoned from Debian's packaging (trixie's `nodejs`
  ships `/usr/bin/node`, and the purse runs a compiled `dist/server.js`, so type-stripping support
  does not matter) — **not verified on a Debian host from this laptop.**
- **The image slug.** `debian-13-x64` is pinned explicitly but not verified live against the
  account's own `GET /v2/images?type=distribution` from this laptop — no network call was made in
  this step. `--create`'s own precondition performs that read before ever calling create.
- **PyYAML.** Absent on this laptop, the same finding the CTO spec already made. The test suite
  falls back to a minimal structural check rather than installing a package as a side effect of
  running tests.
- **Owners are not asserted by the local fixture.** `test/host-fixes.test.mjs` runs
  `lib/post-boot-assert.sh` against a stand-in tree and checks its modes, its account lookups, its
  `sshd -T` reading and its refusals — but there is no `purse` account here and nothing runs as
  root, so `HERON_ASSERT_OWNERS=0` there. On the droplet it defaults to 1 and owner mismatches fail
  the deploy.
