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

1. `bin/beat.sh` checks the config against ten hard rules (`bin/check-rules.ts`), then runs
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

Refuses to start (`check-rules.ts`, exit 1, naming the rule) if any of ten rules is violated — the
council's eight (§3.5–3.6), rules 5 and 6 rewritten and two more added, all closing Security's
2026-09-04 review (`work/rnd/agent/2026-09-04-security-review-mvp-body-and-mind.md`), and rule 5
closed again on 2026-09-05 for the hole the CTO found (§2.7a).

Ten rules are **40 separate refusals**, and every one of them has a fixture that makes it fire —
the Heron v2 rule, from the defect that produced it: *a guard with no failing fixture is not a
guard* (`work/rnd/agent/2026-09-05-engineering-heron-v2-runtime-and-host.md` §1). The count on each
rule below is asserted by `test/check-rules.test.ts` against the checker's own source, so it cannot
go stale the way the run record did.

1. `evolution.enabled` not exactly `false`. — 1 refusal.
2. `restrict_to_workspace` not exactly `true`; or `tools.exec`/`web`/`spawn`/`subagent`.`enabled`
   is `true`; or `heartbeat.enabled` is `true`; or an `allow_read_paths`/`allow_write_paths` entry
   resolves outside the workspace (finding A8). — 5 refusals.
3. `gateway.host` not `127.0.0.1`/`localhost`. — 1 refusal.
4. `PICOCLAW_GATEWAY_HOST` set to anything but unset or loopback, or `-public` on PicoClaw's own
   command line — checked against the exact argv `bin/beat.sh` is about to run, not this script's
   own (finding A6). — 2 refusals.
5. **Allow-list, not a denylist (finding B4), pinning the program and not the interpreter (CTO
   §2.7a).** An `http`/`sse` MCP server must be `https:` with a host on `['mcp.weir.social']`, or
   loopback (`localhost`/`127.0.0.1`) over `http:` only. A `stdio` server's `command` must be an
   absolute path present in a shipped `{path: sha256}` map, and the file on disk must hash to that
   value. It must also be a **single self-contained executable**: an interpreter-shaped basename
   (`node`, `sh`, `bash`, `python*`, `perl`, `tsx`, `deno`, `bun` and their kin) refuses *even when
   it is in the map and its hash matches*, and `args` and `env` must be absent or empty. Hashing
   `/usr/local/bin/node` pins node; the script node runs is pinned by nothing, and that shape
   passed every check this package had until 2026-09-05. Any other shape — including a bare
   `{"command":"bash","args":["-c",…]}` with no recognised `type` — refuses. — 13 refusals.
6. Any skill directory under `workspace/skills/` the package did not ship, or a non-directory entry
   there (e.g. `skills/evil.md`); and — closing finding B6 — `tools.install_skill.enabled`,
   `tools.find_skills.enabled`, or any `tools.skills.registries.*.enabled` is `true`. — 5 refusals.
7. `channel_list` is not empty. — 1 refusal.
8. `hooks.enabled` is `true`, `hooks.entries` is non-empty, `tools.cron.enabled` is `true`, or the
   workspace's `cron/` store holds a job file. — 4 refusals.
9. **`model_list[].api_base` allow-list (finding B5).** Every `api_base` host must be
   `openrouter.ai` over `https:`, or `127.0.0.1`/`localhost`/`host.docker.internal` over `http:`.
   A model entry with no `api_base` is allowed only for `provider: "openrouter"` — PicoClaw's own
   default endpoint. A `model_list` that is not an array refuses rather than being skipped. — 6
    refusals.
10. **`.security.yml` key allow-list (finding A4).** If `.security.yml` exists beside the config,
    it is parsed and every leaf key path it sets must be on this package's shipped allow-list
    (`model_list.route-normal.api_keys` — the only secret this dry run's shape ever calls for); an
    unparseable file refuses too, rather than being silently ignored. — 2 refusals.

## What the beat hands the child

`bin/beat.sh` spawns PicoClaw under `env -i` with exactly four variables and nothing else:
`PATH`, `HOME`, `LANG`, and `PICOCLAW_CONFIG` set to this beat's own config path. The list lives in
`bin/check-rules.ts` as `STDIO_ENV_ALLOWLIST` and `beat.sh` reads it from there
(`--print-stdio-env-allowlist`) rather than keeping a second copy, so the two cannot drift.

Why it matters, in the council's own words (§3.5 rule 5): a stdio MCP server is a child process and
**inherits the parent's environment, which is where the decrypted model credential lives**. Until
2026-09-05 this script passed the whole ambient environment through and scrubbed nothing. The
fixture in `test/beat.test.ts` puts a credential-shaped sentinel in the parent environment, runs a
real beat, and reads back the child's own environment: run against the pre-2026-09-05 script it
fails, and the failure output showed a live session token from this laptop crossing the boundary.

## The lock, and its two exit codes

| Exit | Meaning |
|---|---|
| `75` (`EX_TEMPFAIL`) | `EEXIST` — another beat holds `runs/.lock`. Try again later. |
| `74` (`EX_IOERR`) | The lock could not be created *and does not exist*: `EACCES`, `EROFS`, a runs directory owned by someone else. A broken installation, not a busy one; retrying never clears it. |

v1 read every `mkdir` failure as "another beat is running". On the droplet the runs directory was
root-owned and the container ran as another uid, so every beat got `EACCES`, printed a phantom
running beat and exited 75 — for ever, and with nothing watching, silently
(`work/rnd/agent/2026-09-05-engineering-heron-v2-runtime-and-host.md` §1, defect 4). Both cases have
a fixture; the second runs the real script against a read-only runs directory.

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
  must still be loopback-true so `bin/check-rules.ts` rule 3 passes on the literal config.

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
- **Heron v1 was scrapped 2026-09-05.** The droplet that ran this image is gone and the keys it
  held are accounted for in `work/notes/HERON-KEYS-HOW-AND-WHERE.md`. Nothing below this line has
  run since. The v2 runtime and host are specified in
  `work/rnd/agent/2026-09-05-engineering-heron-v2-runtime-and-host.md`.
- **The Docker image is not published.** What has run on the laptop, 2026-09-04, all on the
  Master's own OpenRouter key placed on disk by his hand, model `deepseek/deepseek-v4-flash`:
  one beat on the laptop (exit 0, six tool calls: `weir_search`, a read of the saved search
  result, `weir_read` on one public post, `weir_seeking`, `weir_agents`, `weir_authorship` on a
  post that asked for SUI; the ask refused; a state report; $0.0026 of usage read back from the
  key) and one beat inside the container with the config, `.security.yml` and key mounted
  read-only (exit 0, same shape, same refusal). Earlier the same night: a laptop beat on a local
  4B model completed with one tool call; two container beats on the local model did not complete
  (no CA bundle, fixed; then twenty minutes in the model's thinking phase, stopped).

## Typecheck and tests

`bin/check-rules.ts` and both test files are TypeScript under a real strict `tsconfig.json`
(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`,
`erasableSyntaxOnly`) with no `any` anywhere. The config is untrusted JSON off disk, so every leaf
of the typed shape is `unknown`: the rule that reads a field is the thing that asserts its type,
and a field of the wrong type is a refusal rather than a silently skipped check.

There is no build step. Node strips the types itself, so the package keeps its zero runtime
dependencies and `beat.sh` runs the checker directly:

```bash
pnpm exec tsc --noEmit    # the workspace gate, pnpm -r exec tsc --noEmit
node --test               # 72 cases
node bin/check-rules.ts picoclaw/config.template.json -- agent
```

Type stripping needs Node 22.18 or newer (this laptop runs 26.7.0). An image on an older Node sets
`WEIR_CHECK_RULES_CMD` to a compiled or `tsx`-run checker; `beat.sh` takes the whole command from
that variable.

## The $4 home on DigitalOcean

Chosen on the Master's word (2026-09-04): the smallest droplet, `s-1vcpu-512mb-10gb` at $4.00 a
month, running this image from DigitalOcean's free container registry on one cron line every 30
minutes. The recipe is in `digitalocean/` (README, cloud-init, a create script that refuses
without `DEPLOY_CONFIRMED=1`). Nothing there has been run; the Cloud Run files in `cloudrun/`
stay as the Google alternative.

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
are asserted by `bin/check-rules.ts` before every beat. What the council's loop bought — the
untrusted-content wrapping and the idempotency ledger of the keyed MCP — is kept, because the MCP
is still the only tool source; PicoClaw replaces only the two hundred lines that would have called
it.

What the council's gate still means here: PicoClaw's own v1.0 warning is not waived. This runtime
runs on the laptop, read-only, with no key. Running it with a signer, or on Cloud Run, is a
separate decision at its own gate, on the Master's word, and the `deploy.sh` refuses to act without
it.
