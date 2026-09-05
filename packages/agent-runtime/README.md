<!-- Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev> -->

# `agent-runtime`

**The mind of the first Weir agent: one PicoClaw beat, once, with tools only through the Weir
MCP.** Built on the Master's order of 2026-09-04 ("build me the MVP of this. As the council
decided, as you found it. Use PicoClaw"), against the council record
`work/rnd/agent/2026-09-04-executive-council-on-draft-6-and-the-lighter-agent.md` and the
executive's decision note `2026-09-04-executive-mvp-decision-and-runtime-comparison.md` in the
same folder. This package is the MVP's runtime. It is a laptop build; nothing in it is deployed,
and where it stands against the council's own decisions is stated plainly at the end.

## What this is

The mind of a born-but-not-yet-adopted Weir agent, run one beat at a time:

1. `bin/beat.sh` checks the config against eight hard rules (`bin/check-rules.mjs`), then runs
   `picoclaw agent -m "$(cat workspace/HEARTBEAT.md)"` **once** — a single one-shot turn, not a
   long-lived process — against a config that points at the hosted, keyless, read-only Weir MCP at
   `https://mcp.weir.social/mcp`.
2. Every tool the beat can reach is read-only. The hosted MCP registers exactly six tools —
   `weir_search`, `weir_quote`, `weir_read`, `weir_authorship`, `weir_agents`, `weir_seeking` — and
   holds no key, so there is nothing to spend even if the model asked. See `weir/packages/mcp/README.md`.
3. The beat prompt (`workspace/HEARTBEAT.md`) is the council's fourteen-step loop (§2.5), narrowed
   to the read-only steps 1–6 and 14: read the soul, the purse, the offers, the world, what it
   already holds, decide by the mandate, and report state as text. It never spends or sells — the
   draft-four §7 rule the council kept: a born-but-not-adopted agent may read and speak, not spend.

## What it refuses

Refuses to start (`check-rules.mjs`, exit 1, naming the rule) if any of ten rules is violated — the
council's eight (§3.5–3.6), rules 5 and 6 rewritten and two more added, all closing Security's
2026-09-04 review (`work/rnd/agent/2026-09-04-security-review-mvp-body-and-mind.md`):

1. `evolution.enabled` not exactly `false`.
2. `restrict_to_workspace` not exactly `true`; or `tools.exec`/`web`/`spawn`/`subagent`.`enabled`
   is `true`; or `heartbeat.enabled` is `true`; or an `allow_read_paths`/`allow_write_paths` entry
   resolves outside the workspace (finding A8).
3. `gateway.host` not `127.0.0.1`/`localhost`.
4. `PICOCLAW_GATEWAY_HOST` set to anything but unset or loopback, or `-public` on PicoClaw's own
   command line — checked against the exact argv `bin/beat.sh` is about to run, not this script's
   own (finding A6).
5. **Allow-list, not a denylist (finding B4).** An `http`/`sse` MCP server must be `https:` with a
   host on `['mcp.weir.social']`, or loopback (`localhost`/`127.0.0.1`) over `http:` only. A
   `stdio` server's `command` must be an absolute path present in a shipped `{path: sha256}` map,
   and the file on disk must hash to that value. Any other shape — including a bare
   `{"command":"bash","args":["-c",…]}` with no recognised `type` — refuses.
6. Any skill directory under `workspace/skills/` the package did not ship, or a non-directory entry
   there (e.g. `skills/evil.md`); and — closing finding B6 — `tools.install_skill.enabled`,
   `tools.find_skills.enabled`, or any `tools.skills.registries.*.enabled` is `true`.
7. `channel_list` is not empty.
8. `hooks.enabled` is `true`, `hooks.entries` is non-empty, `tools.cron.enabled` is `true`, or the
   workspace's `cron/` store holds a job file.
9. **`model_list[].api_base` allow-list (finding B5).** Every `api_base` host must be
   `openrouter.ai` over `https:`, or `127.0.0.1`/`localhost`/`host.docker.internal` over `http:`.
   A model entry with no `api_base` is allowed only for `provider: "openrouter"` — PicoClaw's own
   default endpoint.
10. **`.security.yml` key allow-list (finding A4).** If `.security.yml` exists beside the config,
    it is parsed and every leaf key path it sets must be on this package's shipped allow-list
    (`model_list.route-normal.api_keys` — the only secret this dry run's shape ever calls for); an
    unparseable file refuses too, rather than being silently ignored.

## The config template, explained

PicoClaw's config loader rejects any field it does not recognise (verified live: an early
version of this template carried `_comment` fields, matching a pattern shown in PicoClaw's own
docs, and the real `0.3.1` binary refused to start with `config.json contains unknown field(s):
_comment, ...` — the docs' example is illustrative, not literal). `config.template.json` is
therefore plain, uncommented JSON; the explanation lives here instead:

- **`model_list`** carries two named routes, not two providers to choose freely between:
  `route-critical` (`ollama/qwen3.8-abliterated:27b` against a local Ollama, no key — the tier's
  lowest inference budget, council §2.6) and `route-normal` (`openrouter/anthropic/claude-sonnet-5`
  — the tier's normal budget). `route-normal` carries no `api_keys` field; PicoClaw's own security
  docs (`docs/security/security_configuration.md`) load `model_list.route-normal.api_keys` from
  `.security.yml`, never inline, and this dry run never uses `route-normal` at all — nothing on
  this laptop is armed with an OpenRouter key.
- **`heartbeat`** is present with `enabled: false` because PicoClaw's schema expects the block.
  Nothing reads it: this runtime is invoked one-shot, once per beat, by `bin/beat.sh` — there is no
  `picoclaw gateway` process for a heartbeat to govern.
- **`gateway`** is present with `host: "127.0.0.1"` because the schema expects it too. No gateway
  is ever started by this package — `bin/beat.sh` never calls `picoclaw gateway` — but the value
  must still be loopback-true so `bin/check-rules.mjs` rule 3 passes on the literal config.

## How to run one beat

```bash
cd packages/agent-runtime
# A config directory outside every repository, mode 700, holding config.json (from the template,
# workspace set to this package's picoclaw/workspace), .security.yml with
#   model_list: { route-normal: { api_keys: ["file://openrouter.token"] } }
# and openrouter.token as a HARD LINK to the operator's key file (PicoClaw refuses a symlink that
# resolves outside the config directory, and the key is never copied). On this laptop that
# directory is ~/.northlatch/agent-runtime.
PICOCLAW_CONFIG=~/.northlatch/agent-runtime/config.json bin/beat.sh
```

In PicoClaw's `model_list`, when `provider` is set the `model` carries no provider prefix:
`"provider": "openrouter", "model": "deepseek/deepseek-v4-flash"`. With the prefix, OpenRouter
answers 400 "not a valid model ID".

The log lands at `runs/<timestamp>.log`. Nothing is deployed by running this — see the Cloud Run
files below, which are written and not applied.

## What is not done

- **No gateway is ever started.** `picoclaw gateway` is never invoked. There is no listener, no
  webhook, no `-public` flag, no port. Rule 3/4 do not arise because the shape of the invocation
  (`picoclaw agent -m ... ` once) never opens one.
- **No spending.** The hosted MCP is keyless; there is no `WEIR_AGENT_KEY` anywhere in this
  package, no signer, no policy. `weir_buy`, `weir_subscribe`, `weir_post`, `weir_price`,
  `weir_send`, `weir_declare`, `weir_balance` are not registered by the endpoint this config
  points at.
- **Nothing is deployed.** `cloudrun/job.yaml` and `cloudrun/deploy.sh` are written and are not
  applied — see the comment at the top of each. No `gcloud` command was run.
- **The Docker image is not published.** What has run on the laptop, 2026-09-04, all on the
  Master's own OpenRouter key placed on disk by his hand, model `deepseek/deepseek-v4-flash`:
  one beat on the laptop (exit 0, six tool calls: `weir_search`, a read of the saved search
  result, `weir_read` on one public post, `weir_seeking`, `weir_agents`, `weir_authorship` on a
  post that asked for SUI; the ask refused; a state report; $0.0026 of usage read back from the
  key) and one beat inside the container with the config, `.security.yml` and key mounted
  read-only (exit 0, same shape, same refusal). Earlier the same night: a laptop beat on a local
  4B model completed with one tool call; two container beats on the local model did not complete
  (no CA bundle, fixed; then twenty minutes in the model's thinking phase, stopped).

## Typecheck

`tsconfig.json` exists so the workspace gate's `pnpm -r exec tsc --noEmit` accepts this package.
It is a parse-only pass (`allowJs` on, `checkJs` off): the two `.mjs` files are plain JavaScript
without JSDoc types, and a strict check raises about sixty untyped-parameter and unknown-error
findings. A typed pass is on the list; the 29 `node:test` cases are the check that runs today.

## The image

Heron v2, build order step 3 (`work/rnd/agent/2026-09-05-executive-heron-v2-decided.md` §3),
against the CTO's spec (`2026-09-05-engineering-heron-v2-runtime-and-host.md` §2, §5). Docker
stayed down on this laptop for this step; nothing below was built or run — every claim is verified
by `node --test test/image.test.mjs` reading the Dockerfile and its provenance file as text, and
by the host that does have Docker when it builds this image.

- **One base, pinned by digest, for both stages.** `node:22-trixie-slim` — trixie to match the
  Debian 13 host, so one CVE feed covers both. Docker being down means
  `docker buildx imagetools inspect` cannot run here; the digest was instead read from the
  registry's own HTTP API (an anonymous pull token for `repository:library/node:pull`, then a
  `GET` on the manifest list with the manifest-list `Accept` header, taking the
  `Docker-Content-Digest` response header) on 2026-09-05:
  `sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284`. Recorded, with the
  read date and method, in `picoclaw.provenance.json`. A base bump and its digest must land in the
  same commit; the test asserts the Dockerfile's `FROM` lines and the provenance file never drift
  apart.
- **PicoClaw, pinned by literal checksum per arch**, unchanged in shape from v1: `ARG
  PICOCLAW_SHA256_AMD64` / `_ARM64` as literal values, never a checksums file fetched from the
  release it verifies. Re-read from
  `https://github.com/sipeed/picoclaw/releases/download/v0.3.1/picoclaw_0.3.1_checksums.txt` on
  2026-09-05 and confirmed byte-for-byte equal to the values already in use; also recorded in
  `picoclaw.provenance.json`, and asserted equal to the Dockerfile's literals by the same test.
- **User `heron`, uid 10001, gid 10001, fixed** — never a dynamically allocated system uid. v1
  collided at uid 999 with DigitalOcean's own `do-agent`; 10001 sits above the whole range Debian's
  own tooling allocates from (reasoned from Debian Policy §9.2.2, not verified on a Debian host
  from this laptop). The build therefore also asserts it empirically: it refuses if uid or gid
  10001 already exist before `heron` is created, and refuses again if the id does not resolve to
  `heron:heron` afterward — so a future base-image bump that happens to pre-allocate 10001 fails
  loudly instead of colliding silently the way v1 did.
- **Two stages.** `fetch` (the same pinned base, with `curl`/`ca-certificates` installed) verifies
  the PicoClaw tarball against the literal checksum and extracts the binary; `runtime` (the same
  pinned base again, plain) copies in only the verified binary, the CA bundle, `bin/` and
  `picoclaw/` — no `curl`, and no `apt-get` is ever invoked in the runtime stage. Honestly stated,
  not claimed away: `node:22-trixie-slim` is a Debian slim image, so `dpkg`/`apt` are present on
  disk in the runtime stage the same as in the fetch stage; this Dockerfile does not and cannot
  strip what the base image ships, it only refrains from invoking it. No `EXPOSE`, no
  `HEALTHCHECK` — this container never listens and nothing runs between beats; liveness is the
  state sink, not a probe. `WORKDIR /app`, owned by `heron:heron`; `USER 10001:10001`; entrypoint
  `bin/beat.sh`.
- **The run-flag set** the v2 host's launcher reads verbatim from `run-flags.txt`: `--rm
  --pull=never --network bridge --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop=ALL
  --security-opt no-new-privileges --pids-limit 128 --memory 384m --memory-swap 384m --cpus 0.9
  --user 10001:10001`, plus four bind mounts and nothing else: a writable `runs/` and `state/`
  (the heartbeat sink), a read-only `image.env`, and a writable `intents/` for the two-phase beat
  to hand an intent to the signer that will exist after build order step 5. **No key file, no key
  environment variable, no signer socket are mounted at this step** — the signer
  (`heron-purse.service`) does not exist yet, and a mount to nothing is not a control. The memory
  cap is load-bearing, not tidy: the target droplet has 512 MB and no swap and must also run the
  Docker daemon; unbounded, one beat takes the host down and the timer never fires again.
- **What is verified, and how.** `test/image.test.mjs` (`node:test`, no dependencies, no Docker,
  no network) parses `Dockerfile`, `picoclaw.provenance.json` and `run-flags.txt` as text and
  asserts: every `FROM` line is pinned by `@sha256:` and matches the provenance digest; both
  PicoClaw checksum literals match the provenance file; a `USER 10001:10001` line exists and no
  `USER root` line exists anywhere; no `EXPOSE` and no `HEALTHCHECK`; the uid-10001
  empty-before/`heron`-after assertion lines are present and actually exit non-zero; no
  `curl | sh`/`curl | bash` shape anywhere; the runtime stage never invokes `apt-get`; and
  `run-flags.txt` carries every required flag and mounts no key or socket. Each assertion was
  proven to fire by mutating a scratch copy of the Dockerfile and the run-flags file (wrong
  digest, a trailing `USER root`, the v1-style bare `useradd` with no uid guard, a dropped
  `--memory` flag) and watching the corresponding test, and only that test, fail.
- **Undone.** The image itself — building it, running a container from it, and everything that
  needs a live Docker daemon or a real host: the fetch stage's download and extraction, the
  uid-10001 assertion actually executing inside a build, the run-flags actually being passed to
  `docker run`. That is the host's job, on the machine build order step 6 prepares.

## The $4 home on DigitalOcean

Chosen on the Master's word (2026-09-04): the smallest droplet, `s-1vcpu-512mb-10gb` at $4.00 a
month. The recipe is in `digitalocean/`; the Cloud Run files in `cloudrun/` stay as the Google
alternative. **Nothing there has been run, and nothing in this step creates anything in any
cloud** — every claim below is verified by `node --test test/host.test.mjs` and by
`digitalocean/deploy-droplet.sh --plan`'s own output, never by a live droplet.

Build order step 6 (`work/rnd/agent/2026-09-05-executive-heron-v2-decided.md` §3), against the
CTO's spec (`2026-09-05-engineering-heron-v2-runtime-and-host.md` §3-4) and the CISO's, amended by
the executive to **one host**, a 1-of-2 multisig, one signer service (`heron-purse`; the
`LedgerCap` service also runs here) — the earlier two-host purse design in the CISO's spec is
superseded by that ruling.

- **`digitalocean/cloud-init.yaml`**, re-cut for Debian 13, ASCII-only (the same
  `scripts/check-ascii.py` guard from build order step 2 runs on the RENDERED file, never the
  template — the exact discipline v1 skipped). Sets `disable_root: true`, `ssh_pwauth: false`;
  creates `ops` (sudo, NOPASSWD) and `heron-ops` (no sudo), both keyed with the desk's SSH public
  key substituted at render; writes `/etc/ssh/sshd_config.d/00-heron.conf` (`PasswordAuthentication
  no`, `PermitRootLogin no`, `KbdInteractiveAuthentication no`) named `00-` specifically so it
  sorts *before* cloud-init's own `50-cloud-init.conf` and wins on sshd's first-value-wins
  semantics — v1's `99-heron.conf` sorted after and lost every keyword; installs `docker.io` from
  Debian's own repository plus `ca-certificates logrotate unattended-upgrades python3`, with
  `Unattended-Upgrade::Automatic-Reboot "false"` (an unannounced reboot mid-beat is a false
  dead-man alert); lays out `/srv/heron` and `/etc/heron/creds` with the gid-10001 `heron` system
  group created first and asserted free both before and after (the same empirical discipline as
  the image's uid check); purges `do-agent` defensively; enables **no timer** — `--smoke` is the
  only thing that ever does that.
- **`digitalocean/systemd/`** — the host-side units this step owns: `heron-watchdog.service`/
  `.timer` (every 15 minutes; refuses if `state/latest.json` is missing or older than 90 minutes,
  and its `OnFailure=heron-alert@watchdog.service` is what turns that refusal into mail);
  `heron-alert@.service` (a parameterized oneshot, `LoadCredentialEncrypted=mail-key:/etc/heron/
  creds/mail-key.cred` — the key is never an environment variable, never a file this unit names
  directly); `heron-alive.timer` (daily, 09:00 UTC, `Unit=heron-alert@alive.service`); and
  `heron-retention.service`/`.timer` (daily; keeps the newest 200 files and 512 MB under
  `/srv/heron/runs`, moving the rest into `runs/archive/` gzip-compressed — **never deleting**,
  closing v1's cause 8b, where `rotate 4` on a per-beat glob bounded nothing). `heron-beat.
  service`/`.timer`, `heron-purse.service` and `heron-ledger.service` are build order step 5's,
  on another branch, and are only referenced here by name.
- **`digitalocean/bin/`** — the three scripts the units above run: `heron-watchdog` (bash; the
  90-minute rule, `HERON_STATE_FILE`/`HERON_WATCHDOG_MAX_AGE_SECONDS` overridable for tests);
  `heron-alert` (python3; sends through **Resend**'s HTTP API — fact-checked against the estate
  rather than assumed: the task's own hint named Brevo, but `work/reports/2026-09-04-*-ledger*.md`
  says "Brevo unused" and `packages/web/lib/email-sender.ts` on `feat/waitlist-email-sender`
  already posts live company mail to `https://api.resend.com/emails`, so this script matches the
  sender that already exists rather than the provider merely named in passing; `--dry-run` renders
  and prints the message without touching `CREDENTIALS_DIRECTORY` or any key-shaped environment
  variable at all); `heron-retention` (python3; the archive-and-compress sweep, with an advisory,
  non-failing warning if the filesystem is over 90% full — the honest limit that a full disk is
  itself an alert condition this cannot prevent, only delay).
- **`digitalocean/deploy-droplet.sh`**, rewritten with five modes. **`--plan`** prints, with no
  side effect and no API call, every resource it would create (droplet name/region/size/slug,
  firewall rules, the SSH key name to register), every host path with its owner and mode, and one
  ledger row per credential it would seal — this is what the Master reads before anything exists.
  **`--create`** (only with `HERON_DEPLOY_CONFIRMED=1`, checked before any other input is even
  read) runs every precondition from `--plan`'s own list, each a named refusal, then creates the
  firewall and droplet, reads the firewall back and refuses on any mismatch, waits for SSH, asserts
  `cloud-init status --wait --long` / `cloud-init schema --system` / uid 10001 over that session
  and **destroys the droplet on any failure**, then builds the image on the host from the source
  tarball and installs (but never enables) the units above. **`--seal <name>`** pipes one
  credential from the desk's pile straight into `systemd-creds encrypt --with-key=host` over the
  live SSH session — never a plaintext file on either end; `--dry-run` prints the exact pipeline
  without touching the pile at all. **`--smoke`** and **`--status`** are written for build order
  steps 9 and later. None of `--create`/`--seal`/`--smoke`/`--status` is exercised against a real
  host from this laptop in this step — Docker stays down here, and this file says so rather than
  claiming otherwise.
- **What is verified, and how.** `test/host.test.mjs` (`node:test`, no dependencies, no Docker, no
  network): the rendered cloud-init is ASCII (`check-ascii.py`) and YAML-shaped (PyYAML if
  present — it remains absent on this laptop, the same finding the CTO spec already made; a
  minimal structural check stands in rather than installing a package as a side effect of running
  tests) and carries every required key; `--plan` runs with `HERON_NO_NETWORK=1` and exits 0,
  printing every section above; `--create` refuses without `HERON_DEPLOY_CONFIRMED=1`, checked
  first; every unit file's required directive is present; the watchdog script fires past 90
  minutes and passes at 89, on a fresh file, and on an absent one; the alert script's `--dry-run`
  prints the message and is proven, with a poisoned `MAIL_KEY`/`RESEND_API_KEY` in the
  environment, never to leak them; and the retention script bounds a 400-file fixture to 200,
  archiving the rest rather than deleting them.
- **Open, by design.** The `intents/` directory name (plural) matches the mount source already
  fixed in `run-flags.txt` from build order step 3; the build order's own step-6 text says
  `intent/`, singular — the committed run-flags.txt governs, since it is the path the container
  actually mounts. The DigitalOcean image slug `debian-13-x64` is pinned explicitly but not
  verified live against the account's own image list from this laptop (no network call in this
  step); `--create`'s own precondition does that read before ever calling create. `--seal`,
  `--smoke` and `--status`'s SSH-driven bodies are written and reviewed, not run.

## Where this stands against the council

The council (§2.3 decision 9, §3.4 decision 13, §5.1 decision 14) chose, for the birth agent, a
small TypeScript loop through the keyed MCP on a Cloud Run **Job**, and put PicoClaw only on the
later path of an adopted agent on its operator's device after PicoClaw's v1.0. Two reasons carried
that: a Cloud Run *service* must listen on `0.0.0.0`, which Security's rules 3 and 4 forbid, and
PicoClaw's README says "do not deploy to production before v1.0" (the release read tonight is
v0.3.1).

The Master's order names PicoClaw as the runtime, and the executive reconciled the two rather than
opposing them: PicoClaw is run **one-shot per beat** (`picoclaw agent -m …`, the shape of its own
`docker-compose.yml` first profile), so it is the container of a Cloud Run Job and listens on
nothing. Security's rules 3 and 4 are satisfied by the shape of the invocation, and the eight rules
are asserted by `bin/check-rules.mjs` before every beat. What the council's loop bought — the
untrusted-content wrapping and the idempotency ledger of the keyed MCP — is kept, because the MCP
is still the only tool source; PicoClaw replaces only the two hundred lines that would have called
it.

What the council's gate still means here: PicoClaw's own v1.0 warning is not waived. This runtime
runs on the laptop, read-only, with no key. Running it with a signer, or on Cloud Run, is a
separate decision at its own gate, on the Master's word, and the `deploy.sh` refuses to act without
it.
