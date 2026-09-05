<!-- Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev> -->

# The $4 home: one DigitalOcean droplet, one host, no registry

Build order step 6 (`work/rnd/agent/2026-09-05-executive-heron-v2-decided.md` §3), against the
CTO's spec (`2026-09-05-engineering-heron-v2-runtime-and-host.md` §3-4) and the CISO's, amended by
the executive to **one host**: a 1-of-2 multisig, one signer service (`heron-purse`; the
`LedgerCap` service also runs here). The CISO's original two-host purse design is superseded by
that ruling; nothing here reopens it.

**Nothing in this folder has been run, and this step creates nothing in any cloud.**
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
| `cloud-init.yaml` | OS setup only: users, SSH hardening, packages, the `/srv/heron` and `/etc/heron/creds` layout, the `heron` system group/user (gid/uid 10001, matching the container). ASCII-only; checked RENDERED, never the template. No timer enabled. |
| `deploy-droplet.sh` | `--plan` / `--create` / `--seal <name>` / `--smoke` / `--status`. See below. |
| `systemd/heron-watchdog.service`, `.timer` | Every 15 minutes: refuses if `state/latest.json` is missing or older than 90 minutes; `OnFailure=` turns that into mail. |
| `systemd/heron-alert@.service` | Parameterized: `systemctl start heron-alert@<instance>.service` sends one notice. Credential loaded only via `LoadCredentialEncrypted`. |
| `systemd/heron-alive.timer` | Daily, 09:00 UTC, points at `heron-alert@alive.service`. |
| `systemd/heron-retention.service`, `.timer` | Daily: keeps the newest 200 files and 512 MB under `runs/`, archiving (never deleting) the rest into `runs/archive/`, gzip-compressed. |
| `bin/heron-watchdog` | The 90-minute rule, in bash. `HERON_STATE_FILE`/`HERON_WATCHDOG_MAX_AGE_SECONDS` overridable for tests. |
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

`heron@weir.social` is not yet a verified sending domain in Resend, the same open item
`packages/web`'s own sender already names — this is a fact about the estate today, not something
this step resolves.

## The deploy script's five modes

- **`--plan`** — prints every resource, path and credential row this would create, with no side
  effect and no API call. Run it with `HERON_NO_NETWORK=1` to confirm that for yourself; it never
  makes a network call in this mode regardless.
- **`--create`** — refuses without `HERON_DEPLOY_CONFIRMED=1`. Runs every precondition named in
  `--plan`'s own output (rendered cloud-init passes `check-ascii.py`; `git status --porcelain`
  empty; the tarball's entries equal `git ls-tree`, exactly; the SSH key and DigitalOcean token
  files exist, the token file mode 0600), then creates the firewall and droplet, reads the
  firewall back and refuses on any mismatch, waits for SSH, asserts `cloud-init status --wait
  --long` / `cloud-init schema --system` / uid 10001 = `heron:heron` over that session —
  **destroying the droplet on any failure** rather than leaving a half-built host with root open —
  then builds the image on the host and installs (never enables) the units in `systemd/`.
- **`--seal <name>`** — pipes one credential from the desk's pile straight into
  `systemd-creds encrypt --with-key=host --name=<name> - /etc/heron/creds/<name>.cred` over the
  live SSH session. No plaintext file is ever written on either end. `--dry-run` prints the exact
  pipeline it would run and touches nothing in the pile.
- **`--smoke`** — runs one real beat as the real user; only a clean exit and a fresh, parsable
  `state/latest.json` unlock enabling `heron-beat.timer`, `heron-watchdog.timer`,
  `heron-alive.timer` and `heron-retention.timer`.
- **`--status`** — reads back the droplet, the firewall, the timers and the newest state file.

`--seal`, `--smoke` and `--status`'s SSH-driven bodies are written and reviewed; none of
`--create`/`--seal`/`--smoke`/`--status` is exercised against a real host from this laptop in this
step.

## What it costs

| Item | Monthly |
|---|---|
| Droplet `s-1vcpu-512mb-10gb` | $4.00 |
| Cloud firewall | $0.00 |
| Container registry | $0.00 (none — the image is built on the host) |
| **Total** | **$4.00** |

## Open, named rather than hidden

- **`intents/` (plural).** The host layout below names `/srv/heron/intents` to match the mount
  source already fixed in `run-flags.txt` from build order step 3
  (`--mount type=bind,source=/srv/heron/intents,target=/app/intents`). The build order's own
  step-6 text says `intent/`, singular; the committed `run-flags.txt` governs here, because it is
  the path the container actually mounts, and a host directory the bind mount cannot find is a
  beat that fails at every run, not a naming preference.
- **The image slug.** `debian-13-x64` is pinned explicitly but not verified live against the
  account's own `GET /v2/images?type=distribution` from this laptop — no network call was made in
  this step. `--create`'s own precondition performs that read before ever calling create.
- **PyYAML.** Absent on this laptop, the same finding the CTO spec already made. The test suite
  falls back to a minimal structural check rather than installing a package as a side effect of
  running tests.
