<!-- Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev> -->

# The $4 home: one DigitalOcean droplet, one host, no registry

Build order step 6 (`work/rnd/agent/2026-09-05-executive-heron-v2-decided.md` §3), against the
CTO's spec (`2026-09-05-engineering-heron-v2-runtime-and-host.md` §3-4) and the CISO's, amended by
the executive to **one host**: a 1-of-2 multisig, one signer service (`heron-purse`; the
`LedgerCap` service also runs here). The CISO's original two-host purse design is superseded by
that ruling; nothing here reopens it.

**Nothing in this folder has been run against a real account, and building it created nothing in
any cloud.** What has been run on this laptop: `--plan`, and every fixture in
`../test/host.test.mjs` and `../test/host-fixes.test.mjs` — including the whole create sequence and
its rollback against a stub directory, and `lib/do_api.py` end to end against a local HTTP server
that answers like DigitalOcean. What has not: `--create`, `--seal`, `--smoke` and `--status`
against a real account or a real host.

`--create` no longer refuses unconditionally. Until Security's second read of this step it stopped
before its first API call unless `HERON_NO_NETWORK=1` was set, which meant the sequence had never
executed and carried a destroy path nothing had ever taken. **The gate is now
`HERON_DEPLOY_CONFIRMED=1` — the Master's word — plus every precondition, and nothing else.**
`HERON_NO_NETWORK=1` remains the test seam: under it every network call goes to a stub directory or
refuses outright, so it cannot make a real deploy happen; it simply no longer has to be present for
one. Every claim below is verified by `node --test` in `packages/agent-runtime` and by
`deploy-droplet.sh --plan`'s own output.

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
| `lib/firewall_match.py` | The firewall readback comparison: protocol, ports, the sorted address list **and** `droplet_ids`/`tags`/`load_balancer_uids`, which must be empty in every rule — both directions, as multisets. Has its own CLI so the comparison is tested directly against a DigitalOcean-shaped echo. |
| `lib/do_api.py` | Every DigitalOcean call about a firewall or an image slug: `firewall-none` (the precondition), `firewall-create` (POST, id recorded, readback, and **DELETE of the firewall it just made** if that readback fails), `firewall-effective` (what the account says applies to the tag) and `image-slug`. `HERON_DO_API_BASE` accepts the real API or a loopback address and refuses anything else, which is how it is run end to end in the tests. |
| `lib/smoke-assert.sh` | Step 9's on-host assertions, piped over the session by `--smoke`: `chain.json` readable by uid 10002, the docker socket reachable from inside `ProtectSystem=strict`, and no `~/.docker` under `ProtectHome`. Same seam discipline as `post-boot-assert.sh`, so it runs here against a stand-in. |
| `lib/record-run.py` | Appends one line to `runs/deploy-runs.jsonl`. Every value arrives by environment, never argv. |
| `logrotate/heron` | Installed to `/etc/logrotate.d/heron`: bounds `/srv/heron/state/beats.jsonl` and `/var/lib/heron/watchdog/alerts.jsonl` and nothing else. `runs/` is `heron-retention`'s, because a per-beat file is the exact shape `rotate N` cannot bound. |
| `runs/` | The deploy's own run record. What `--create` made, and what a rollback destroyed, with the ids — written before the destroy, never after. |
| `systemd/heron-watchdog.service`, `.timer` | Every 15 minutes: decides whether `state/latest.json` is older than 90 minutes, writes `alerts.jsonl` and a `degraded` marker **in `/var/lib/heron/watchdog` (0700 root:root), never in the container-writable `state/`**, and exits non-zero **only when a notice is due** — the first staleness, every 6 hours while it lasts, and once on recovery. `OnFailure=` turns that into mail. |
| `systemd/heron-alert@.service` | Parameterized: `systemctl start heron-alert@<instance>.service` sends one notice. Credential loaded only via `LoadCredentialEncrypted`. |
| `systemd/heron-alive.timer` | Daily, 09:00 UTC, points at `heron-alert@alive.service`. |
| `systemd/heron-retention.service`, `.timer` | Daily: keeps the newest 200 **entries** and 512 MB under `runs/`, archiving (never deleting) the rest into `runs/archive/`. An entry is a plain file *or* a whole per-beat directory — a beat writes `runs/<beat-id>/`, and a retention that only saw plain files walked past every one of them. |
| `bin/heron-watchdog` | The 90-minute rule and the notice cadence, in bash. `HERON_STATE_FILE`/`HERON_WATCHDOG_DIR`/`HERON_WATCHDOG_MAX_AGE_SECONDS`/`HERON_WATCHDOG_REPEAT_SECONDS` overridable for tests. A marker field that is not a run of digits, and a `last_notified` in the future, are read as "never notified" — so a corrupted marker makes the notice **due**, never suppressed. |
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
- **`--smoke`** — build order step 9's gate, in five parts, in this order and each one a refusal
  that stops the next: (1) `lib/smoke-assert.sh` over the session; (2) the effective inbound
  ruleset for tag `heron-v2` read from the **account**, not from one firewall's own echo; (3) **the
  mail gate** — `heron-alert@smoke.service`, a real send, and a Resend message id in the journal,
  refusing outright if `/etc/heron/creds/mail-key.cred` is not sealed; (4) one real beat and a
  fresh, parsable `state/latest.json`; (5) only then the four timers. The mail drill happens
  **before** any timer is enabled, not after: a host whose dead man cannot reach the desk is not a
  host to leave running.
- **`--status`** — the timers, the newest state file, the last five watchdog records, and the
  effective inbound ruleset for the tag read from the account.

`HERON_NO_NETWORK=1` sends every network call in the script to a stub directory or refuses it
outright — which is how the tests run the create sequence, the rollback path and `--smoke`'s mail
gate with no droplet. `--smoke` and `--status`'s SSH-driven bodies are written, reviewed and
exercised against those stubs, and have not been run against a real host from this laptop.

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
- **`RestrictAddressFamilies` on the alert unit** now reads `AF_UNIX AF_NETLINK AF_INET AF_INET6`,
  on Security's requirement: `nss-resolve`'s varlink socket needs `AF_UNIX` and glibc's
  `AI_ADDRCONFIG` probe opens an `AF_NETLINK` socket, and neither family opens a network path —
  the outbound firewall is what bounds where this process can reach. cloud-init also pins
  `hosts: files dns` in `/etc/nsswitch.conf` and the post-boot check asserts it, so which resolver
  path is taken is a fact. Still no Debian host here to watch it resolve.
- **`/srv/heron` is 0751, not the CTO spec 3.7's 0750.** The `purse` account is not in group root
  and must traverse `/srv/heron` to open its own program and its policy; at 0750 the signer cannot
  start. `o+x` is traversal only — no `o+r`, so the directory still cannot be listed, and every
  child carries its own owner and mode. The one deliberate deviation from that spec in this folder.
- **`nodejs` was added to cloud-init's package list.** `heron-purse.service` starts
  `/usr/bin/node`, and nothing installed it: the signer would not have started and the beat unit,
  which `Requires=` it, would never have run. Reasoned from Debian's packaging (trixie's `nodejs`
  ships `/usr/bin/node`, and the purse runs a compiled `dist/server.js`, so type-stripping support
  does not matter) — **not verified on a Debian host from this laptop.**
- **The image slug.** `debian-13-x64` is pinned explicitly and is now checked by a real
  precondition, `check_image_slug`, which reads the account's own
  `GET /v2/images?type=distribution` before the create call. That check did not exist when `--plan`
  first claimed it did (Security's N-5); the precondition list `--plan` prints and the loop
  `cmd_create` runs are generated from one array now, and a test parses both. It has still never
  been run against a real account from this laptop.
- **PyYAML.** Absent on this laptop, the same finding the CTO spec already made. The test suite
  falls back to a minimal structural check rather than installing a package as a side effect of
  running tests.
- **The forced-failure email is `--smoke`'s gate, and it has never been run.** The drill is coded
  and stubbed; whether a Debian droplet's `heron-alert@smoke.service` actually reaches Resend is
  settled on the host, at step 9, before a timer is enabled — and nothing here claims otherwise.
- **Owners are not asserted by the local fixture.** `test/host-fixes.test.mjs` runs
  `lib/post-boot-assert.sh` against a stand-in tree and checks its modes, its account lookups, its
  `sshd -T` reading and its refusals — but there is no `purse` account here and nothing runs as
  root, so `HERON_ASSERT_OWNERS=0` there. On the droplet it defaults to 1 and owner mismatches fail
  the deploy.
