# 08 — Launch, operations and the things that are not code

## What this file is

This is the eighth document in the application build plan and the only one that is not about
front-end code. It covers everything that must be true for weir.social to run in production and
keep running: what gates a deployment, what is set in the environment, what is watched, what an
operator types when something breaks, which plan ceiling is hit first, and what must be checked
in the twenty-four hours around a public launch. Every claim below is cited to a file in this
repository. Where a fact could not be established from the tree it is not asserted here; it is
listed in **Unverified** at the end. The application is already on Sui mainnet and already
settles real payments, so nothing in this document is hypothetical: it is the difference between
a live product that is watched and a live product that is not.

---

## Blockers

Eight items. Each must be closed before the site is opened past the waiting list
(`packages/web/lib/site-mode.ts:45`). Severity: **S1** — money or data can be lost, or an outage
runs unnoticed; **S2** — a defect can reach production, or abuse is unbounded; **S3** — a visible
defect with no money or data at risk.

### B-01 — Nothing reports an error, and nothing notices an outage (S1)

**Evidence.** The whole of this application's error reporting is one line:
`packages/web/lib/opaque.ts:53` writes `console.error(JSON.stringify({ failure, detail }))` and
returns a sentence to the caller. `packages/web/lib/db.ts:73-75` does the same for pool errors.
Across `packages/web/lib` and `packages/web/app` there are fourteen `console.error` / `console.warn`
/ `console.log` calls in total and no other sink. `packages/web/package.json:17-33` lists no error
reporting, tracing or analytics dependency. There is no client-side reporter anywhere in
`packages/web`: no `window.onerror` handler, no error boundary that transmits. The CSP has no
collector either, and says so — `packages/web/next.config.ts:163-164`: "There is no `report-uri`:
nothing collects reports yet". Nothing polls the site: the only scheduled workflow in
`.github/workflows/` is `backup.yml:16`, at 03:17 UTC, and it dumps a database rather than
checking a page.

**Risk.** A 500 on `POST /api/checkout/submit` — the route that submits signed payment bytes
(`packages/web/app/api/checkout/submit/route.ts:36-38`) — reaches the buyer as "the reason is in
this deployment's logs", is written to a Vercel function log nobody is tailing, and is never seen
again. A pool exhaustion, a fullnode outage, a Supabase pooler refusing connections, or the site
returning 500 on every page are all indistinguishable from silence. The first report of an outage
is a user, on whatever channel they can find, at whatever hour it happens.

**Fix.**

1. Create a Sentry account and one project of type "Next.js". Copy the DSN.
2. `cd packages/web && pnpm add @sentry/nextjs@10`.
3. `npx @sentry/wizard@latest -i nextjs` from `packages/web`, and accept the generated
   `instrumentation.ts`, `instrumentation-client.ts` and `sentry.server.config.ts`. This is the
   only place a client-side reporter can be installed, because `packages/web/app/layout.tsx:60`
   sets `export const dynamic = 'force-dynamic'` on every route and there is no other client entry.
4. Add `SENTRY_DSN` to Vercel production and preview through the API path already used for the
   on-ramp keys — copy the three-line loop in `.github/workflows/set-vercel-env.yml:43-56` and add
   `SENTRY_DSN` to the `for name in` list on line 43, with a matching repository secret.
5. Route `opaqueDetail` into it. In `packages/web/lib/opaque.ts:47-54`, after the `console.error`,
   add `Sentry.captureException(error, { tags: { source } })` guarded by a dynamic import so the
   module stays importable from the browser — that constraint is stated at
   `packages/web/lib/opaque.ts:2-20` and must not be broken.
6. Add the collector to the CSP. In `packages/web/next.config.ts:173`, change `connect-src 'self'`
   to `connect-src 'self' https://*.ingest.sentry.io` in the Report-Only policy, so B-07 does not
   have to be reopened later.
7. Uptime: create a check at https://betterstack.com/uptime (free tier, 10 monitors) against
   `https://weir.social/api/deployment` — an existing, rate-limited, always-open JSON route
   (`packages/web/app/api/deployment/route.ts:39-52`, exempt from the front door via
   `packages/web/lib/front-door.ts:89`). Interval 3 minutes, alert after 2 consecutive failures,
   notification to the security address in `SECURITY.md:5`.

**Verify.** `curl -sS https://weir.social/api/deployment -o /dev/null -w '%{http_code}\n'` returns
200, and the Better Stack monitor shows one successful check. Then force an error on a preview
deployment (`curl -X POST https://<preview>/api/posts -d 'not json'`) and confirm the event
appears in Sentry within sixty seconds.

### B-02 — Nothing automated gates the build that is deployed (S2)

**Evidence.** `.github/workflows/deploy.yml:31-32` is `on: workflow_dispatch` and nothing else —
there is no `push`, no `workflow_run`, no `needs:`. The job itself runs `vercel pull`,
`vercel build`, `vercel deploy --prebuilt --prod` (`deploy.yml:74-81`) with no test step. In CI,
the job that runs the application suite and the production build is gated
`if: github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'`
(`.github/workflows/ci.yml:84`), and so is the Move suite (`ci.yml:218`). What runs on every commit
is the secret scan (`ci.yml:67-81`) and the digest guard (`ci.yml:279-386`), and `deploy.yml:20-22`
says so plainly: "A green CI therefore means the secret scan and the digest guard passed, and
nothing more."

**Risk.** A typecheck error, a failing route test, or a build that does not compile can be
deployed to production by one click on Actions → Deploy to Vercel → Run workflow. The 173-test web
suite and the Move suite run on the developer's laptop by hand, so the gate is a person's memory.
The failure this produces is not a red build; it is a green deploy of code nobody ran.

**Fix.** Do not restore the automatic path — `deploy.yml:24-30` explains why it was removed, and
that reasoning stands. Make the deploy prove the suite ran instead.

1. In `.github/workflows/deploy.yml`, add an input under `workflow_dispatch` (line 32):
   ```yaml
   on:
     workflow_dispatch:
       inputs:
         suite_sha:
           description: The commit SHA the full suite was run against, locally
           required: true
           type: string
   ```
2. Add a first step to the `deploy` job, before the checkout at `deploy.yml:51`, that refuses a
   mismatch:
   ```yaml
   - name: The suite was run against the commit being deployed
     run: |
       [ "${{ inputs.suite_sha }}" = "${{ github.sha }}" ] || {
         echo "::error::suite_sha ${{ inputs.suite_sha }} is not ${{ github.sha }}"; exit 1; }
   ```
3. Add a second job to `deploy.yml` that runs the same checks CI already knows how to run, on a
   clean machine, and make `deploy` depend on it — copy the `web` job body from `ci.yml:83-215`
   verbatim (Postgres service, migrations, typecheck, `pnpm test`, `pnpm build`) into a job named
   `gate`, delete its `if:` line, and add `needs: gate` to the `deploy` job at `deploy.yml:39`.
   This costs one clean run per production deploy, which is the only occasion it is worth paying.

**Verify.** Push a commit with a deliberate type error to a branch, merge it, and run
Actions → Deploy to Vercel with `suite_sha` set to that commit. The run must stop in `gate` at
"Typecheck (no incremental cache)" and never reach `vercel deploy`.

### B-03 — The backup has never been restored, so there is no known-good restore (S1)

**Evidence.** `.github/workflows/backup.yml` takes a nightly `pg_dump --format=custom` of the
`public` and `alpha_test` schemas (`backup.yml:73-78`), verifies it can be listed and contains six
named tables (`backup.yml:83-95`), and uploads it as a GitHub artifact with 90-day retention
(`backup.yml:97-104`). That is the whole of it. Nothing in the repository restores a dump, and
`backup.yml:7-9` records the plan position: "Free-plan Supabase includes no automated backups", so
there is no managed daily backup and no point-in-time recovery behind this file. The artifact is
the only copy, it lives in the same GitHub account as the repository, and `backup.yml:88` accepts
any dump over 1000 bytes.

**Risk.** A dropped table, a bad migration, or a Supabase project deletion is recoverable only by a
procedure nobody has executed. The predictable failures are all silent until the day they matter:
the `BACKUP_DATABASE_URL` role loses `SELECT` on a table added in a later migration and the dump
quietly omits it below the six-table check; the pooler rewrite at `backup.yml:51-67` stops matching
a changed Supabase hostname; the restore fails on ownership because the dump is `--no-owner
--no-privileges` and nothing has ever tried to load it back.

**Fix — the restore drill, run now and quarterly.**

1. `gh run download --repo <owner>/weir --name content-store-backup --dir /tmp/weirdump` (latest
   successful `Backup` run).
2. `createdb weir_restore_drill`
3. `/usr/lib/postgresql/17/bin/pg_restore --no-owner --no-privileges --schema=public \
   -d weir_restore_drill /tmp/weirdump/backup-*.dump 2>&1 | tee /tmp/restore.log`
4. `[ ! -s /tmp/restore.log ] || grep -c "error" /tmp/restore.log` — record the count; a
   non-zero count that is not `role does not exist` is a failed drill.
5. Compare the schema against the repository, not against memory:
   `psql weir_restore_drill -Atc "select count(*) from schema_migrations"` must equal
   `ls packages/web/db/*.sql | wc -l` minus any file recorded as baselined
   (`packages/web/scripts/migrate.mjs:209-259`).
6. Row counts on the tables that hold money-adjacent state:
   `psql weir_restore_drill -Atc "select 'profiles',count(*) from profiles union all
   select 'posts',count(*) from posts union all select 'issued_quotes',count(*) from issued_quotes
   union all select 'agent_sponsorships',count(*) from agent_sponsorships"`.
7. Widen the dump's own check. In `backup.yml:91`, replace the six-table list with every table the
   repository creates, generated rather than typed:
   `for table in $(grep -ho 'create table if not exists [a-z_]*' ../packages/web/db/*.sql | awk '{print $NF}' | sort -u)`.
8. Take the copy out of the single account. Add a step after `backup.yml:96` that writes the same
   file to the existing bucket named in `UPDATE.md:243`
   (`gs://projectx-social-backups/`) with `gcloud storage cp backup-*.dump gs://projectx-social-backups/nightly/`.
9. `dropdb weir_restore_drill`.

**Verify.** The drill log shows zero errors other than `role does not exist`, and step 5's two
numbers are equal. Record the date and the two numbers in this file's changelog each quarter.

### B-04 — The harvest daemon can stop and nobody is told (S1)

**Evidence.** The daemon calls `stake_vault::harvest`, which withdraws matured tranches and stakes
one new rung (`packages/daemon/README.md:3-5`). Realised staking yield is what
`stake_vault::claim_creator_yield` pays out (`CUSTODY.md:27`), and yield is only realised by a
harvest: `packages/daemon/src/status.ts:112-118` states that "`lifetime_yield` is only written by
the harvest that withdraws it", and names the precedent — "22 consecutive zero harvests on the
predecessor". Supervision in the repository is a systemd unit and hourly timer
(`packages/daemon/deploy/projectx-harvest.service:29-31`,
`packages/daemon/deploy/projectx-harvest.timer:6-10`), but the live daemon is a container run from
a GCP VM instance startup script (`UPDATE.md:243`). Its journal is written to Cloud SQL
`projectx-pg` / `social_harvest`, and the same entry records `db/002_audit_anchor.sql` as not yet
applied there, so the audit anchor write "failed loudly as designed". Every reporting path is
pull-only: `pnpm status` and `pnpm journal` (`packages/daemon/package.json:26-28`) are commands a
person runs. Nothing pushes a heartbeat anywhere.

**Risk.** `RestartPreventExitStatus=1 2` (`projectx-harvest.service:30`) is correct and is also the
silent-failure path: a misconfigured daemon exits 1, systemd deliberately does not restart it, and
nothing else says so. Exit 2 means another instance holds the Postgres session advisory lock
(`packages/daemon/README.md:59-62`) — a hung tick holds that lock and every subsequent tick exits 2
for as long as it hangs, bounded only by `TimeoutStartSec=600`. In every one of those states the
site keeps working, creators keep depositing, and no yield is realised. The evidence that anything
is wrong is a `running` row in a journal on a Cloud SQL instance nobody queries
(`packages/daemon/README.md:47-52`).

**Fix.**

1. Create a heartbeat monitor at https://betterstack.com/uptime → Heartbeats, period 90 minutes
   (the timer is hourly with `RandomizedDelaySec=300`), grace 30 minutes. Copy its URL.
2. Put it in the daemon's environment file on the VM, beside the values already there:
   `printf 'PROJECTX_DAEMON_HEARTBEAT_URL=%s\n' "$URL" | sudo tee -a /var/lib/projectx-social/harvest-public.env`
3. Call it only on a clean tick. In `packages/daemon/src/main.ts`, on the path that exits 0, add a
   single `fetch(process.env.PROJECTX_DAEMON_HEARTBEAT_URL, { method: 'POST' })` awaited with a
   5-second timeout and ignored on failure. Exit codes 1, 2 and 3 must not ping — the whole value
   of the heartbeat is that a daemon which is running and failing looks the same as one that is
   dead.
4. Apply the missing journal migration, which is the one command `UPDATE.md:243` records as
   outstanding:
   `psql "$PROJECTX_DAEMON_DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/daemon/db/002_audit_anchor.sql`
5. Add a weekly read of the journal to the operator's calendar:
   `pnpm --filter @projectx-social/daemon journal` and
   `pnpm --filter @projectx-social/daemon status`, checking for `solvent: NO — investigate`
   (`packages/daemon/src/status.ts:90`) and for any row still marked `running`.

**Verify.** `systemctl stop projectx-harvest.timer` on the VM (or stop the container), wait two
hours, and confirm the heartbeat monitor alerts. Restart it and confirm the next tick clears the
alert and `pnpm --filter @projectx-social/daemon journal` shows a completed row.

### B-05 — Secret and key custody has no inventory and no rotation drill (S2)

**Evidence.** Fifteen distinct secrets are read by the running system. Six of them are absent from
`.env.example` entirely and can therefore be missing from a deployment with no file saying they
should exist: `PROJECTX_SOCIAL_SPONSOR_KEY` (`packages/web/lib/sponsor.ts:92`),
`PROJECTX_SOCIAL_AGENT_MANIFEST_KEY` (`packages/web/lib/agent-manifest.ts:2232`),
`PROJECTX_SOCIAL_SEAL_API_KEY` (`packages/sdk/src/config.ts:246`),
`PROJECTX_SOCIAL_EDGE_SECRET` (`packages/web/lib/rate-limit.ts:242`),
`RESEND_API_KEY` (`packages/web/lib/email-sender.ts:32`) and
`WEIR_EMAIL_TOKEN_SECRET` (`packages/web/lib/email-token.ts:58`). One of them can never be rotated
at all: `PROJECTX_SOCIAL_ZKLOGIN_SEED` (`.env.example:67-78`) — "Lose it and every one of those
accounts becomes unreachable … Change it and every existing user silently lands on a different,
empty address." The custody that is documented is the on-chain half: `CUSTODY.md:88` records the
`PlatformCap` and the upgrade capability in a 2-of-3 multisig, and `CUSTODY.md:86` records that the
daemon key can only call a permissionless function. The Vercel values are write-only
(`.github/workflows/set-vercel-env.yml:7-8`), and only three of them — the Transak trio — are ever
written from a recorded source (`set-vercel-env.yml:43`). `packages/web/scripts/env-report.mjs`
fingerprints a local `.env` file and cannot see Vercel's copy.

**Risk.** Nobody can answer "which secrets does production hold, and which of them would we have to
rotate if this laptop were stolen" without opening the Vercel dashboard and reading a list that
does not include the values. The `PROJECTX_SOCIAL_SPONSOR_KEY` funds gas for the first fifty agent
registrations (`packages/web/lib/sponsor.ts:80`); a leak costs exactly the float in that address
and nothing else, but only if somebody notices. `WEIR_EMAIL_TOKEN_SECRET` signs unsubscribe tokens
(`packages/web/lib/email-token.ts:80`); a leak lets anyone unsubscribe anyone. The zkLogin seed is
the one that cannot be recovered from, and it is presently in the same undocumented pile as the
rest.

**Fix.**

1. Write the inventory. The table in **Environment and configuration** below is that inventory;
   keep it as the single list and add a row when a variable is added.
2. Fill the gaps in `.env.example`. Append a section naming all six missing secrets with blank
   values and a one-line consequence each, matching the style of `.env.example:148-174`. Blank
   values, never real ones — `scripts/scan-secrets.py:33-35` checks exact containment of live
   values against tracked files, and this file is tracked.
3. Separate the zkLogin seed from everything else. Print it, seal it, and store it with the
   multisig material named in `CUSTODY.md:88`. It is the only value here whose loss is
   unrecoverable and its handling must not resemble the handling of a rotatable API key.
4. Prove the scanner still refuses: `bash scripts/install-hooks.sh` in every working checkout
   (there are three in this tree: `.`, `.heron-soul-worktree`, `.wren-worktree`), which runs
   `python3 scripts/scan-secrets.py --selftest` and fails the install if the scanner is not
   trustworthy (`scripts/install-hooks.sh:33-37`).
5. Record each secret's rotation cost in the inventory: rotatable with no user impact
   (`RESEND_API_KEY`, `TRANSAK_API_SECRET`, `PROJECTX_SOCIAL_EDGE_SECRET`), rotatable with a
   funded-address migration (`PROJECTX_SOCIAL_SPONSOR_KEY`, `PROJECTX_DAEMON_SIGNER_SECRET`),
   rotatable with an on-chain ceremony (`PROJECTX_SOCIAL_AGENT_MANIFEST_KEY`), not rotatable
   (`PROJECTX_SOCIAL_ZKLOGIN_SEED`).

**Verify.** `node packages/web/scripts/env-report.mjs packages/web/.env.local` lists every name in
the inventory with `present`; `python3 scripts/scan-secrets.py --all` prints CLEAN;
`git config core.hooksPath` prints `scripts/git-hooks` in each of the three checkouts.

### B-06 — Twenty-two API routes have no rate limit, and the edge secret is unset (S2)

**Evidence.** There are 68 route handlers under `packages/web/app/api`
(`find packages/web/app/api -name route.ts | wc -l`). Forty-six reference `rateLimit`,
`quotaLimit` or `tripBreaker`. The twenty-two that reference none are:
`account/prepare`, `admin/prepare`, `admin/revenue`, `checkout/prepare`, `checkout/subscribe`,
`checkout/tip`, `checkout/unlock`, `creator/accepting`, `creator/tier`, `creator/vault`,
`earnings/prepare`, `keys/prepare`, `names/manage/prepare`, `names/purchase/prepare`,
`stake/rebate`, `stake/settings`, `stake/vault`, `stake/withdraw`, `stake/yield`, `studio/price`,
`zklogin/complete`, `zklogin/export`. The limiter's own documentation says what that means:
"the simulate and prepare routes each build a transaction and call a fullnode, so an
unauthenticated loop spends this deployment's CPU and its share of a public, rate-limited RPC
endpoint until real visitors start seeing failures" (`packages/web/lib/rate-limit.ts:9-12`). The
edge layer that is supposed to be the real ceiling is Cloudflare configuration, not code
(`packages/web/lib/rate-limit.ts:74`), and the header that proves a request came through it is only
trusted when `PROJECTX_SOCIAL_EDGE_SECRET` is set (`packages/web/lib/rate-limit.ts:242-245`) — a
variable absent from `.env.example`. Only three routes are idempotent — `checkout/submit`,
`messages`, `posts` — and only through `idempotently` (`packages/web/lib/idempotent-route.ts:1-3`).

**Risk.** Every `prepare` route builds a transaction and calls a fullnode. An unauthenticated loop
against `POST /api/checkout/prepare` costs this deployment function invocations and burns the
shared mainnet fullnode quota until real buyers see failures at the one moment they are trying to
pay. `zklogin/complete` reaches the prover; a loop there costs prover capacity. With
`PROJECTX_SOCIAL_EDGE_SECRET` unset, a caller who finds a Vercel deployment URL bypasses Cloudflare
entirely and sets `cf-connecting-ip` themselves, minting a fresh in-process bucket per request —
the exact bypass `rate-limit.ts:224-240` describes.

**Fix.**

1. Add `simulateLimit` to each of the fourteen `prepare` and transaction-building routes, in the
   shape `checkout/submit` already uses (`packages/web/app/api/checkout/submit/route.ts:41-42`):
   `const limited = await simulateLimit(request); if (limited !== null) return limited;` as the
   first statement of the handler.
2. Add `rateLimit(request, 'read')` to the read-only routes in the list (`admin/revenue`,
   `creator/vault`, `stake/vault`, `stake/yield`, `stake/settings`, `studio/price`) in the shape
   `packages/web/app/api/deployment/route.ts:40-41` uses.
3. Set the edge secret on both sides. Generate `openssl rand -hex 32`; add it as
   `PROJECTX_SOCIAL_EDGE_SECRET` to Vercel production and preview through the
   `set-vercel-env.yml:43` loop; then in Cloudflare → weir.social → Rules → Transform Rules →
   Modify Request Header → Create rule, "All incoming requests", Set static `x-edge-secret` to the
   same value. Set the secret at the edge **first**, then in Vercel — the reverse order sends every
   genuine visitor down the `unattributed` path (`packages/web/lib/rate-limit.ts:237-240`).
4. Set the deployment breakers explicitly rather than relying on the defaults at
   `packages/web/lib/rate-limit.ts:1058-1078`. Add all seven `PROJECTX_SOCIAL_BREAKER_*` names
   (`packages/web/lib/rate-limit.ts:995-1010`) to Vercel production at the documented defaults, so
   that setting one to `0` at 3am is an edit to an existing variable rather than a discovery.
5. Cloudflare → Security → WAF → Rate limiting rules → Create rule: path starts with `/api/`,
   100 requests per 10 seconds per IP, action Block, duration 60 seconds. This is layer 1 and
   `packages/web/lib/rate-limit.ts:74-79` states it is not optional.

**Verify.** `for i in $(seq 1 200); do curl -s -o /dev/null -w '%{http_code} ' -X POST
https://weir.social/api/checkout/prepare -d '{}'; done` returns 429 before the two hundredth
request. `curl -sI https://weir.social/ | grep -i cf-ray` confirms the edge is in front. Then
`PROJECTX_SOCIAL_BREAKER_READ_PER_MINUTE=0` on a preview deployment must refuse identified reads
with the message at `packages/web/lib/rate-limit.ts:1150`.

### B-07 — The Content-Security-Policy is Report-Only and cannot be enforced as written (S3)

**Evidence.** `packages/web/next.config.ts:141-149` enforces four directives — `object-src 'none'`,
`base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'` — and that half is correct and
already live. The script and style half is Report-Only
(`packages/web/next.config.ts:166-180`), and its `script-src` allows exactly one inline hash,
`INLINE_THEME_SCRIPT_SHA256` at `packages/web/next.config.ts:34`, described as "the one inline
script this application serves". Measured against live traffic that is not what the page emits: the
browser reports violations for four distinct inline scripts Next itself emits, and for the
Cloudflare beacon at `static.cloudflareinsights.com`, which the policy's `script-src 'self'` and
`connect-src 'self'` (`next.config.ts:170,173`) both refuse. `next.config.ts:163-164` records that
there is no `report-uri`, so those violations reach the browser console and nowhere else.

**Risk.** Enforcing this policy today takes the site down for every visitor — the framework's own
bootstrap scripts are blocked, which is a blank page, not a degraded one. Leaving it Report-Only
means the one directive that actually stops an injected script, `script-src`, is not enforced at
all: the page has the appearance of a script policy and none of the effect. Note the direction of
the residual risk — `base-uri 'none'` and `form-action 'self'` are already enforced
(`next.config.ts:145-146`), so the two worst XSS primitives are closed regardless.

**Fix.** Replace the hash with a nonce, which is what a framework that emits its own inline scripts
requires.

1. In `packages/web/proxy.ts`, at the top of `proxy()` (line 55), generate
   `const nonce = crypto.randomUUID().replaceAll('-', '')`, and set it on the outgoing request
   headers as `x-nonce` on every `NextResponse.next()` return in that file. The proxy runs in the
   Node runtime (`packages/web/proxy.ts:19-20`), so this is available.
2. Move both CSP headers out of `next.config.ts:141-180` and emit them from `proxy.ts` instead,
   because a nonce is per-request and `headers()` is static.
3. Set `script-src 'self' 'nonce-<nonce>' 'strict-dynamic'` and
   `connect-src 'self' https://static.cloudflareinsights.com`, and add
   `script-src ... https://static.cloudflareinsights.com` for the beacon.
4. Read the nonce in `packages/web/app/layout.tsx` with
   `const nonce = (await headers()).get('x-nonce')` and pass it to the inline theme script's
   `nonce` attribute. Delete `INLINE_THEME_SCRIPT_SHA256` at `next.config.ts:34` and update
   `packages/web/test/csp.test.ts`, which currently recomputes that hash from the layout source
   (`next.config.ts:158-161`) and will fail until it does.
5. Keep it Report-Only for seven days after that change, with the collector from B-01 receiving
   reports via `report-uri`.
6. Then rename the header key at `next.config.ts:167` from
   `Content-Security-Policy-Report-Only` to `Content-Security-Policy`, merging the four
   already-enforced directives into the one policy.

**Verify.** `curl -sI https://weir.social/ | grep -i content-security-policy` shows a `nonce-`
value that differs between two consecutive requests. Open the site in a browser with the console
open: zero CSP violations. Only then enforce.

### B-08 — The manifest and the page disagree on the theme colour, and `standalone` promises an app that does not exist (S3)

**Evidence.** `packages/web/public/site.webmanifest:7-8` declares `background_color` and
`theme_color` as `#04161d`. `packages/web/app/layout.tsx:65` declares `themeColor: '#03050a'`. The
comment directly above it, `packages/web/app/layout.tsx:45-46`, states the intent that is not met:
"The manifest already names that colour for the installed app; this states it for the browser too,
so the two agree." They do not agree. `layout.tsx:63-64` names the authority — "Must match `--bg`
in `weir.css`". Separately, `site.webmanifest:6` declares `"display": "standalone"`, and
`packages/web/public/` contains no service worker (`ls packages/web/public/` lists eleven entries,
none of them `sw.js`), and no source file in `packages/web` calls `navigator.serviceWorker`.

**Risk.** An installed instance paints its surround `#04161d` while the page body renders the
colour `layout.tsx:65` names, so the seam is visible on every launch on Android and in an installed
PWA — the exact defect `layout.tsx:43-46` was written to prevent. `display: standalone` removes the
browser chrome, including the reload button and the address bar, from an application that has no
offline shell: a visitor who opens the installed icon with no connection gets the platform's own
error page inside a window with no way to retry and no URL to copy.

**Fix.**

1. Settle which colour is correct by reading the stylesheet:
   `grep -n -- '--bg' packages/web/app/weir.css`.
2. Set both files to that value. Edit `packages/web/public/site.webmanifest:7-8` and
   `packages/web/app/layout.tsx:65` in the same commit.
3. Add the assertion so the two cannot drift again. In `packages/web/test/`, add a test that reads
   `public/site.webmanifest` and `app/layout.tsx` and asserts the three colours are equal — the
   same technique `packages/web/test/csp.test.ts` already uses for the inline script hash
   (`next.config.ts:158-161`).
4. Change `packages/web/public/site.webmanifest:6` from `"display": "standalone"` to
   `"display": "browser"`. A service worker is out of scope for this launch, and `browser` is the
   honest declaration for an application with no offline shell; it keeps the icon, the name and the
   splash colours and leaves the visitor the reload button.

**Verify.**
`node -e "const m=require('./packages/web/public/site.webmanifest');console.log(m.theme_color,m.background_color,m.display)"`
prints the same colour twice, and `browser`. `grep -n "themeColor" packages/web/app/layout.tsx`
prints that same colour. `pnpm --filter @projectx-social/web test` passes with the new test.

---

## Environment and configuration

Derived from `.env.example`, from `packages/sdk/src/config.ts:59-66` and `:81`, `:230-247`, from
`grep -rn "process.env" packages/web/lib packages/web/app`, from `.github/workflows/`, and from
`docker-compose.yml`. There is no `packages/web/.env.example`; the only example file in the tree is
the one at the repository root. Rows marked **NOT IN `.env.example`** are read by code and named in
no committed example file — closing that gap is B-05, step 2.

"Where set": **V-prod** = Vercel production; **V-prev** = Vercel preview; **local** =
`packages/web/.env.local`; **GH-secret** = GitHub Actions repository secret; **GH-var** = GitHub
Actions repository variable; **VM** = the daemon host's environment file
(`/var/lib/projectx-social/harvest-public.env`, `UPDATE.md:243`); **compose** = `docker-compose.yml`
only.

### Chain configuration — public facts, never secrets

| Variable | Where set | What breaks if missing | Secret |
|---|---|---|---|
| `PROJECTX_SOCIAL_NETWORK` | V-prod, V-prev, local, GH-var (`ci.yml:210`), VM | `loadConfig` fails `unconfigured` (`packages/sdk/src/config.ts:151-165`); every chain read on every page fails | no |
| `PROJECTX_SOCIAL_GRPC_URL` | V-prod, V-prev, local, VM | same; also the daemon refuses to start (`packages/daemon/src/config.ts:131`) | no |
| `PROJECTX_SOCIAL_PACKAGE_ID` | V-prod, V-prev, local, GH-var (`ci.yml:211`), VM | same; type tags and event filters cannot be built (`.env.example:16-18`) | no |
| `PROJECTX_SOCIAL_LATEST_PACKAGE_ID` | V-prod, V-prev, local, GH-var (`ci.yml:212`), VM | same; every `moveCall` targets the wrong package (`.env.example:20-23`) | no |
| `PROJECTX_SOCIAL_PLATFORM_ID` | V-prod, V-prev, local, GH-var (`ci.yml:213`) | same | no |
| `PROJECTX_SOCIAL_REGISTRY_ID` | V-prod, V-prev, local | same | no |
| `PROJECTX_SOCIAL_KEY_REGISTRY_ID` | V-prod, V-prev, local | messaging and key publication fail only; the rest of the site runs (`packages/sdk/src/config.ts:70-81`) | no |
| `PROJECTX_SOCIAL_VAULT_COIN_TYPES` | V-prod, V-prev, local, GH-var (`ci.yml:214`) | no creator vault can be opened (`.env.example:100-102`; `packages/web/lib/chain.ts:64`) | no |
| `PROJECTX_SOCIAL_MIND_PACKAGE_ID` | V-prod, V-prev, local | agent minds cannot be approved (`packages/sdk/src/config.ts:118-124`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_NAMES_PACKAGE_ID` | V-prod, V-prev, local | no verified-creator badges; nothing errors (`.env.example:84-90`) | no |
| `PROJECTX_SOCIAL_NAMES_REGISTRAR_ID` | V-prod, V-prev, local | as above; both or neither | no |
| `PROJECTX_SOCIAL_NAMES_STOREFRONT_URL` | V-prod, V-prev, local | no link to buy a name (`.env.example:92-95`) | no |
| `PROJECTX_SOCIAL_SUINS_REGISTRATION_TYPE` | V-prod, V-prev, local | a SuiNS name object in a wallet is not recognised (`.env.example:166-167`) | no |
| `PROJECTX_SOCIAL_SUGGESTED_VALIDATOR` | V-prod, V-prev, local | no validator is prefilled when a vault is opened (`.env.example:104-107`) | no |
| `PROJECTX_SOCIAL_SUGGESTED_VALIDATOR_NAME` | V-prod, V-prev, local | the prefilled validator has no display name | no |
| `PROJECTX_SOCIAL_UPGRADE_CAP_ID` | V-prod, V-prev | the signed agent manifest publishes no custody section (`packages/web/lib/agent-manifest.ts:2561-2564`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_PLATFORM_CAP_ID` | V-prod, V-prev | as above; both or neither — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_PUBLISHER_ADDRESS` | local | `scripts/verify-site-admin.ts` cannot run; nothing at runtime (`.env.example:157-158`) | no |

### Database

| Variable | Where set | What breaks if missing | Secret |
|---|---|---|---|
| `PROJECTX_DATABASE_URL` | V-prod, V-prev, local, compose | `db()` throws on first use (`packages/web/lib/db.ts:33-39`); the build itself fails, because the root layout queries Postgres (`ci.yml:90-94`); `migrate.mjs` exits 2 (`packages/web/scripts/migrate.mjs:71-78`) | **yes** |
| `PROJECTX_TEST_DATABASE_URL` | local, GH-var in CI (`ci.yml:111`) | route tests refuse to run; the name must end in `_test` (`ci.yml:109-111`) | **yes** |
| `PROJECTX_DAEMON_DATABASE_URL` | VM, compose | the daemon has no journal; a live run with none is refused (`packages/daemon/README.md:41-45`; `packages/daemon/src/config.ts:160`) | **yes** |
| `BACKUP_DATABASE_URL` | GH-secret | the nightly backup fails loudly and refuses to report success (`.github/workflows/backup.yml:47-50`) | **yes** |
| `SUPABASE_REGION` | GH-secret, optional | the pooler rewrite defaults to `eu-west-2` (`backup.yml:58`) | no |
| `POSTGRES_PASSWORD` | compose | `docker compose up` refuses to start Postgres (`docker-compose.yml:22`) | **yes** |

### The harvest daemon

| Variable | Where set | What breaks if missing | Secret |
|---|---|---|---|
| `PROJECTX_DAEMON_SIGNER_SECRET` | VM | the daemon can only run `--dry-run`; no harvest, so no realised yield (`.env.example:29-31`) | **yes** |
| `PROJECTX_DAEMON_TICK_SECONDS` | VM, compose | defaults to 3600 (`docker-compose.yml:95`) | no |
| `PROJECTX_DAEMON_GAS_BUDGET_MIST` | VM | the daemon's own bound is used (`.env.example:173-174`) | no |
| `PROJECTX_DAEMON_MAX_DISCOVERY_PAGES` | VM | the built-in discovery ceiling applies — **NOT IN `.env.example`** | no |

### zkLogin — all four or none (`.env.example:36-40`)

| Variable | Where set | What breaks if missing | Secret |
|---|---|---|---|
| `PROJECTX_SOCIAL_GOOGLE_CLIENT_ID` | V-prod, V-prev, local | sign-in offers wallets only and says so | no |
| `PROJECTX_SOCIAL_ZKLOGIN_REDIRECT_URI` | V-prod, V-prev, local | as above; must match Google's registered URI character for character (`.env.example:51-54`) | no |
| `PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL` | V-prod, V-prev, local | as above; the Mysten public prover does not serve mainnet (`.env.example:60-65`) | no |
| `PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY` | V-prod, V-prev | the prover refuses if it requires a key (`.env.example:169-170`) | **yes** |
| `PROJECTX_SOCIAL_ZKLOGIN_SEED` | V-prod, V-prev, local | **every zkLogin account this deployment issued becomes unreachable** (`.env.example:67-78`). Cannot be rotated. | **yes** |
| `PROJECTX_SOCIAL_ZKLOGIN_DISABLED` | V-prev | Google sign-in is shown on previews (`.env.example:171`) | no |

### Walrus and Seal — stored media

| Variable | Where set | What breaks if missing | Secret |
|---|---|---|---|
| `PROJECTX_WALRUS_AGGREGATOR_URL` | V-prod, V-prev, local | stored media cannot be read (`.env.example:115-118`) | no |
| `PROJECTX_WALRUS_PUBLISHER_URL` | V-prod, V-prev, local | uploads fail closed; reads still work (`.env.example:120-121`) | no |
| `PROJECTX_WALRUS_PUBLISHER_JWT_SECRET` | V-prod, V-prev | no upload can be authorised; a publisher started without it accepts anything from anyone (`.env.example:123-128`) | **yes** |
| `PROJECTX_SOCIAL_SEAL_KEY_SERVERS` | V-prod, V-prev | paid media cannot be encrypted (`packages/sdk/src/config.ts:230-231`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_SEAL_THRESHOLD` | V-prod, V-prev | as above (`packages/sdk/src/config.ts:232`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_SEAL_API_KEY_NAME` | V-prod, V-prev | a permissioned key server refuses (`packages/sdk/src/config.ts:233-237`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_SEAL_API_KEY` | V-prod, V-prev | as above (`packages/sdk/src/config.ts:238-246`) — **NOT IN `.env.example`** | **yes** |
| `PROJECTX_SOCIAL_MIND_MAX_BYTES` | V-prod, V-prev | the mind route is closed (`packages/web/lib/mind.ts:29-33`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_MIND_QUOTA_CAPACITY` | V-prod, V-prev | as above — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_MIND_QUOTA_MS_PER_TOKEN` | V-prod, V-prev | as above — **NOT IN `.env.example`** | no |

### The edge, abuse limits and keys the server holds

| Variable | Where set | What breaks if missing | Secret |
|---|---|---|---|
| `PROJECTX_SOCIAL_BEHIND_CLOUDFLARE` | V-prod (`true`) | every visitor collapses into one rate-limit bucket, which reads as an outage (`packages/web/lib/rate-limit.ts:208-223`) | no |
| `PROJECTX_SOCIAL_EDGE_SECRET` | V-prod, V-prev + Cloudflare Transform Rule | a caller reaching the origin directly mints a fresh bucket per request (`packages/web/lib/rate-limit.ts:224-245`) — **NOT IN `.env.example`** | **yes** |
| `PROJECTX_SOCIAL_BREAKER_READ_PER_MINUTE` | V-prod | falls back to 12000 (`packages/web/lib/rate-limit.ts:1059`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_BREAKER_WRITE_PER_MINUTE` | V-prod | falls back to 1200 (`:1060`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_BREAKER_PURCHASE_PER_HOUR` | V-prod | falls back to 60 (`:1061`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_BREAKER_ONRAMP_PER_HOUR` | V-prod | falls back to 60 (`:1068`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_BREAKER_SIMULATE_PER_MINUTE` | V-prod | falls back to 600 (`:1078`) — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_BREAKER_PUBLISH_PER_HOUR` | V-prod | falls back to the default at `packages/web/lib/rate-limit.ts:1058-1090` — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_BREAKER_MESSAGE_PER_MINUTE` | V-prod | as above — **NOT IN `.env.example`** | no |
| `PROJECTX_SOCIAL_SPONSOR_KEY` | V-prod | no registration is sponsored; the funnel for an agent with no SUI ends (`packages/web/lib/sponsor.ts:92,128-133`) — **NOT IN `.env.example`** | **yes** |
| `PROJECTX_SOCIAL_AGENT_MANIFEST_KEY` | V-prod | the manifest at `/.well-known/weir-agent.json` is published unsigned (`packages/web/lib/agent-manifest.ts:2265-2271`) — **NOT IN `.env.example`** | **yes** |

### Mail and the on-ramp

| Variable | Where set | What breaks if missing | Secret |
|---|---|---|---|
| `RESEND_API_KEY` | V-prod | no waiting-list mail is sent (`packages/web/lib/email-sender.ts:32,248`) — **NOT IN `.env.example`** | **yes** |
| `WEIR_EMAIL_TOKEN_SECRET` | V-prod | unsubscribe links cannot be minted or read; must be ≥ the minimum length (`packages/web/lib/email-token.ts:58,80`) — **NOT IN `.env.example`** | **yes** |
| `TRANSAK_API_KEY` | V-prod, V-prev via `set-vercel-env.yml:36,43` | the card on-ramp is unavailable | **yes** |
| `TRANSAK_API_SECRET` | V-prod, V-prev via `set-vercel-env.yml:37,43` | as above | **yes** |
| `TRANSAK_ENVIRONMENT` | V-prod, V-prev via `set-vercel-env.yml:38,43` | as above; the workflow refuses a blank value (`set-vercel-env.yml:45`) | no |

### Build, deploy and local-only

| Variable | Where set | What breaks if missing | Secret |
|---|---|---|---|
| `VERCEL_TOKEN` | GH-secret | `vercel pull`, `vercel build` and `vercel deploy` all fail (`deploy.yml:75-81`) | **yes** |
| `VERCEL_ORG_ID` | GH-secret | as above (`deploy.yml:44`) | no |
| `VERCEL_PROJECT_ID` | GH-secret | as above (`deploy.yml:45`); the value is recorded at `.vercel/project.json:2` | no |
| `VERCEL_GIT_COMMIT_SHA` | supplied by Vercel | the `x-projectx-commit` header reads `local` (`packages/web/next.config.ts:114`) | no |
| `NEXT_DIST_DIR` | CI only (`ci.yml:209`) | a verification build overwrites the dev server's chunks (`packages/web/next.config.ts:20-25,37`) | no |
| `PROJECTX_WEB_URL` | local | `scripts/verify-e2e-messages.ts:31` and `scripts/sign-with-cli.ts:23` default to `http://localhost:3000` | no |
| `PROJECTX_TEST_WALLET_FILE` | local | `scripts/check-test-wallet.ts` cannot run | **yes** |
| `WEB_PORT` | compose | defaults to 3000 (`docker-compose.yml:72`) | no |
| `PROJECTX_MEDIA_ROOT` | compose (`docker-compose.yml:66`) | nothing — no file under `packages/` reads it. Media moved to Walrus in `packages/web/db/010_media_to_walrus.sql`; this line is stale and should be deleted. | no |

The browser holds no configuration of its own: there is not one `NEXT_PUBLIC_` variable in this
codebase, and `packages/web/app/api/deployment/route.ts:17-20` records that as a settled decision.
Anything the browser needs, it asks for.

---

## Observability

Seven signals. Each row names what emits it today, where it must go, the threshold that constitutes
an alert, and who is woken. The tooling is Sentry (errors, free tier 5,000 events per month) and
Better Stack Uptime (HTTP and heartbeat checks, free tier 10 monitors). Both are chosen because
they need no service the project does not already have — an HTTPS endpoint and a DSN in an
environment variable — and because the CSP change they require is one line
(`packages/web/next.config.ts:173`). Vercel's own function logs are the fallback and are not a
monitoring system: they are not searchable across deployments on this plan and nothing reads them.

| Signal | Emitted today by | Goes to | Alert threshold | Who is woken |
|---|---|---|---|---|
| Server errors | `console.error(JSON.stringify({failure, detail}))` at `packages/web/lib/opaque.ts:53`, and pool errors at `packages/web/lib/db.ts:74` | Sentry, via `Sentry.captureException` added inside `opaqueDetail` (B-01 step 5) | any new issue fingerprint; or the same fingerprint 10 times in 5 minutes | e-mail to the address in `SECURITY.md:5` |
| Client errors | nothing — there is no reporter in `packages/web` | Sentry browser SDK, installed by `instrumentation-client.ts` (B-01 step 3) | 25 events in 15 minutes from one release | e-mail, next working day |
| Failed chain reads (`Reading<T>` failures) | folded and discarded, or printed — see `packages/daemon/src/status.ts:74-77` for the only place a kind, its sentence and its retry advice are all rendered | Sentry, tagged `kind` from `FAILURE_KINDS` (`packages/sdk/src/reading.ts:55-64`) | `transport` or `timeout` 20 times in 5 minutes means the fullnode at `PROJECTX_SOCIAL_GRPC_URL` is unhealthy; `unconfigured` even **once** in production means a variable is missing and is a page | page on `unconfigured`; e-mail otherwise |
| Payment settlement failures | `POST /api/checkout/submit` returns a refusal built by `submitSigned`; nothing records it (`packages/web/app/api/checkout/submit/route.ts:36-38`) | Sentry, tagged `route:/api/checkout/submit`, with the transaction digest when one exists and never the bytes | **any** failure after the signature verifies — this is the only route where a failure is a person's money in an unknown state | page |
| Rate-limit rejections | a 429 response body; no counter, no log (`packages/web/lib/rate-limit.ts`) | Sentry as a message at `warning` level, tagged with the bucket name from `BREAKER_ENV` (`packages/web/lib/rate-limit.ts:995-1010`) | a deployment-wide breaker tripping at all — `packages/web/lib/rate-limit.ts:1050-1051` states that a deployment where the breaker trips routinely has a per-address quota set wrong | e-mail; page if the `purchase` breaker trips, because that bucket's exhaustion costs money (`:1053-1056`) |
| Migration runs | stdout from `packages/web/scripts/migrate.mjs:172-173`, in whichever terminal ran it | the deploy log, by running migrations from a workflow rather than a laptop | a checksum drift stop (`packages/web/scripts/migrate.mjs:197-204`) is an immediate stop-the-deploy | the person running the deploy, synchronously |
| Daemon heartbeats | nothing; `pnpm status` and `pnpm journal` are pull-only (`packages/daemon/package.json:26-28`) | Better Stack heartbeat, pinged only on exit 0 (B-04 step 3) | no ping for 90 minutes plus a 30-minute grace | page — creator yield stops accruing and nothing else says so |

Three notes on what must **not** be instrumented.

`opaqueDetail` must keep returning a sentence written here and never the library's message
(`packages/web/lib/opaque.ts:26-32`): a `pg` exception names tables, columns and constraints, and
adding a reporter must not become a reason to relax that. Send the real message to Sentry; keep
sending the written sentence to the caller.

Nothing may log a connection string, a private key, or a JWT. `packages/web/scripts/migrate.mjs:80-90`
prints host and database only; `scripts/scan-secrets.py:12-16` states the rule and refuses a
`--show` flag; `packages/sdk/src/config.ts:238-246` states that a configuration error which quotes
the value it read is how a credential reaches a log aggregator. Sentry's `beforeSend` must strip
`PROJECTX_` environment values from event contexts.

`packages/web/lib/site-mode.ts:21-28` is the one deliberate fail-open in the codebase, and it must
stay one. A failed read there returns `OPEN` and must not raise an alert on its own; the database
outage behind it will be caught by the pool error at `packages/web/lib/db.ts:74`.

---

## Runbooks

Every step is a command or a click path. Nothing here is a heading to interpret.

### R-1 — Deploy to production

1. `cd /Users/admin/WORK.CLAUDE/weir && git checkout main && git pull --ff-only`
2. `pnpm install --frozen-lockfile`
3. `pnpm --filter @projectx-social/sdk build`
4. `pnpm typecheck`
5. `pnpm test` — the root script, which builds the libraries first and runs every package
   (`package.json:10`). Do not run `pnpm test` inside `packages/web`; that was the defect corrected
   at `.github/workflows/ci.yml:167-179`.
6. `cd sui-contracts && sui move test && cd ..`
7. `git rev-parse HEAD` — copy the SHA.
8. Open https://github.com/Northlatch-Labs-LLC/weir/actions/workflows/deploy.yml → "Run workflow" →
   branch `main` → paste the SHA into `suite_sha` (after B-02) → "Run workflow".
9. Watch the run. The last step is `vercel deploy --prebuilt --prod` (`deploy.yml:80-81`).
10. `curl -sI https://weir.social/ | grep -i x-projectx-commit` — the value must equal step 7's SHA
    (`packages/web/next.config.ts:113-114`).
11. `curl -sS https://weir.social/api/deployment | jq .` — `packageId` and `latestPackageId` must be
    non-null and must match `sui-contracts/deploy/mainnet.json`.

### R-2 — Roll back a bad deploy

1. Open https://vercel.com/ → team → project `projectx-social` → Deployments.
2. Find the last deployment whose commit you know was good. Click its `⋯` menu → "Instant Rollback"
   → confirm.
3. `curl -sI https://weir.social/ | grep -i x-projectx-commit` — the value must now be the older
   SHA.
4. If the bad deploy applied a migration, the rollback does **not** undo it. Go to R-4 before
   assuming the site is healthy: the older code is now running against a newer schema.
5. `git revert <bad sha> && git push` on `main`, so the tree matches what is serving.
6. Record what happened in `UPDATE.md`, in the dated form the file already uses.

### R-3 — Apply a database migration to production

1. `cd packages/web`
2. `node --env-file=.env.production.local scripts/migrate.mjs` — dry run, which is the default
   (`packages/web/scripts/migrate.mjs:30-31`). Read the two lines it prints first: `database:` and
   `mode:` (`:172-173`). Confirm the database name and host are the production ones.
3. If it stops with "these files have changed since they were applied" (`:197-204`), **stop**.
   Nothing was changed. The database and the repository disagree; write a new migration rather than
   editing an applied one.
4. Trigger a fresh backup before writing: Actions → Backup → "Run workflow". Wait for it to go
   green.
5. `node --env-file=.env.production.local scripts/migrate.mjs --apply`
6. `psql "$PROJECTX_DATABASE_URL" -Atc "select filename from schema_migrations order by filename desc limit 5"`
   — the newest file in `packages/web/db/` must be in that list.
7. `curl -sS https://weir.social/api/browse -o /dev/null -w '%{http_code}\n'` returns 200.

Never apply a `.sql` file to production with `psql -f`. `packages/web/db/README.md:3-4` says so and
`packages/web/scripts/migrate.mjs:9-18` records why: without the ledger, "is 023 in production?" is
answered by inference, and inference is how a migration is applied twice.

### R-4 — Restore the database from a backup

1. `gh run list --repo Northlatch-Labs-LLC/weir --workflow Backup --limit 5` — pick a run id from
   before the damage.
2. `gh run download <run-id> --repo Northlatch-Labs-LLC/weir --name content-store-backup --dir ./restore`
3. `/usr/lib/postgresql/17/bin/pg_restore --list ./restore/backup-*.dump | head -40` — confirm the
   tables are present before touching anything live (this is the same check `backup.yml:90-95`
   makes).
4. Create a new Supabase project rather than restoring over the live one: Supabase dashboard →
   New project → same region (`eu-west-2`, `backup.yml:58`). Copy its connection string.
5. `/usr/lib/postgresql/17/bin/pg_restore --no-owner --no-privileges --schema=public --schema=alpha_test -d "<new url>" ./restore/backup-*.dump`
6. `psql "<new url>" -Atc "select count(*) from schema_migrations"` and compare with
   `ls packages/web/db/*.sql | wc -l`. A shortfall means the dump predates a migration; apply the
   remainder with R-3 against the new database before cutting over.
7. `psql "<new url>" -f packages/web/db/029_rls_and_revoke_on_every_table.sql` — the dump is
   `--no-privileges` (`backup.yml:75`), so grants and RLS policies do not come back with it.
8. Set `PROJECTX_DATABASE_URL` in Vercel production to the new connection string:
   Vercel → project → Settings → Environment Variables → `PROJECTX_DATABASE_URL` → Edit → Save.
9. Redeploy so the new value is picked up: R-1 from step 8.
10. Update `BACKUP_DATABASE_URL` (GitHub → Settings → Secrets and variables → Actions) to the new
    database, then Actions → Backup → "Run workflow" and confirm it goes green. A restored database
    that is not being backed up is the same position again.

### R-5 — Rotate a leaked secret

Decide first which of the three classes the value is in, from the inventory above.

Rotatable with no user impact — `RESEND_API_KEY`, `TRANSAK_API_KEY`, `TRANSAK_API_SECRET`,
`PROJECTX_SOCIAL_EDGE_SECRET`, `PROJECTX_SOCIAL_SEAL_API_KEY`,
`PROJECTX_WALRUS_PUBLISHER_JWT_SECRET`, `WEIR_EMAIL_TOKEN_SECRET`:

1. Revoke the old value at its issuer (Resend → API Keys → Revoke; Transak dashboard → Keys;
   for a generated secret there is nothing to revoke).
2. Generate the replacement: `openssl rand -hex 32` for the generated ones.
3. GitHub → Settings → Secrets and variables → Actions → update the repository secret.
4. Actions → "Set Vercel env" → Run workflow → target `production`, then again → `preview`
   (`.github/workflows/set-vercel-env.yml:14-22`). For a name not in that workflow's list, add it
   to the `for name in` loop at `set-vercel-env.yml:43` first.
5. Redeploy: R-1 from step 8. Vercel environment changes do not reach a running deployment.
6. `node packages/web/scripts/env-report.mjs packages/web/.env.local` — the fingerprint of the local
   copy must have changed (`packages/web/scripts/env-report.mjs:11-19`).
7. `python3 scripts/scan-secrets.py --all` — must print CLEAN, so the leaked value is not also in
   the tree.

Rotatable with a funded-address migration — `PROJECTX_SOCIAL_SPONSOR_KEY`,
`PROJECTX_DAEMON_SIGNER_SECRET`:

1. `sui client new-address ed25519` — note the new address.
2. Move the float off the old address in one transaction:
   `sui client transfer-sui --to <new address> --sui-coin-object-id <id> --gas-budget 10000000`.
   For the sponsor key that float is the entire exposure (`packages/web/lib/sponsor.ts:31-34`); for
   the daemon key it is gas only, and the key holds no capability (`CUSTODY.md:86`).
3. Set the new bech32 private key as above (steps 3-5 for the sponsor key; for the daemon,
   `sudo sed -i 's/^PROJECTX_DAEMON_SIGNER_SECRET=.*/PROJECTX_DAEMON_SIGNER_SECRET=<new>/' /var/lib/projectx-social/harvest-public.env`
   then restart the unit or container).
4. For the daemon, prove it with one tick: `pnpm --filter @projectx-social/daemon dry-run`, then
   let the scheduled tick run and check `pnpm --filter @projectx-social/daemon journal`.

Rotatable only by ceremony, or not at all:

- `PROJECTX_SOCIAL_AGENT_MANIFEST_KEY` — rotating changes the key every agent verifies the manifest
  against (`packages/web/lib/agent-manifest.ts:2265-2294`). Publish the new public key at
  `/security` in the same deploy that changes the variable.
- `PlatformCap`, the upgrade capability — 2-of-3 multisig (`CUSTODY.md:88`). Not an environment
  variable and not rotated from a keyboard; it is an on-chain transaction with two signatures.
- `PROJECTX_SOCIAL_ZKLOGIN_SEED` — **cannot be rotated** (`.env.example:67-78`). If it leaks, it
  does not let the holder spend: moving money needs a live Google-signed token plus the user's
  ephemeral key, and the seed produces neither. Do not change it. Record the leak, and treat any
  future decision to change it as an account migration for every zkLogin user, not a rotation.

### R-6 — Take the site to a read-only or maintenance state

The switch already exists and is the waiting-list gate.

1. Sign in with the publisher address — the authority checked is `Publisher`, not `PlatformCap`
   (`packages/web/app/api/site-mode/route.ts:14-21`, `packages/web/lib/site-admin.ts`).
2. `curl -X POST https://weir.social/api/site-mode -H 'content-type: application/json' \
   -d '{"waitlistMode":true}' --cookie "<the proved session cookie>"` — or use the admin page at
   https://weir.social/admin, which posts the same body.
3. Confirm within five seconds: the answer is cached for `CACHE_MS = 5_000`
   (`packages/web/lib/site-mode.ts:83`). `curl -sI https://weir.social/explore` must now redirect.
4. Know what stays open. `packages/web/lib/front-door.ts:75-99` exempts `/llms.txt`,
   `/register-agent.mjs`, `/waitlist`, `/signin`, `/auth/callback`, **`/api/`**, `/legal`,
   `/disclosure`, `/opengraph-image`, `/security` and `/agents`. The entire API stays reachable —
   deliberately, because closing it would break the call that reopens the site
   (`packages/web/lib/front-door.ts:80-83`). **This is a front door, not a read-only mode.** Writes
   through `/api/` still work while it is closed.
5. For an actual write freeze, set the breakers to zero, which is what they are for
   (`packages/web/lib/rate-limit.ts:60-62`): set `PROJECTX_SOCIAL_BREAKER_WRITE_PER_MINUTE=0`,
   `PROJECTX_SOCIAL_BREAKER_PUBLISH_PER_HOUR=0`, `PROJECTX_SOCIAL_BREAKER_PURCHASE_PER_HOUR=0` and
   `PROJECTX_SOCIAL_BREAKER_MESSAGE_PER_MINUTE=0` in Vercel production, then redeploy (R-1 from
   step 8). The refusal message names the variable (`packages/web/lib/rate-limit.ts:1150`), so a
   support reply can quote it.
6. Reopen: `curl -X POST … -d '{"waitlistMode":false}'`, and unset or restore the four breaker
   values, then redeploy.

### R-7 — Respond to a report of a paywall bypass

1. Acknowledge within the window `SECURITY.md:5-8` states: an answer within three days, a fix or a
   stated reason within fourteen. Do not open a public issue.
2. Reproduce against production with a wallet holding no entitlement:
   `curl -sS "https://weir.social/api/media/<postId>/<assetId>" -o /tmp/probe -w '%{http_code} %{size_download}\n'`.
   A body returned to an address holding no `Unlock` object is the bypass; a refusal is not.
3. Establish which layer failed. There are only two candidates and they have different fixes.
   Entitlement is decided by objects held on Sui and the database has no say in it
   (`packages/web/db/README.md:41-46`), so either the route's chain read is wrong
   (`packages/web/lib/entitlement.ts`) or the body was served by something that never asked
   (`packages/web/app/api/media/[postId]/[assetId]/route.ts`).
4. Close it at the door immediately, before the fix:
   set `PROJECTX_SOCIAL_BREAKER_READ_PER_MINUTE=0` in Vercel production and redeploy (R-1 from
   step 8). This stops identified callers; it does not stop anonymous ones, so also add a
   Cloudflare WAF rule — Security → WAF → Custom rules → Create → expression
   `http.request.uri.path contains "/api/media/"` → action Block — until the fix ships.
5. Determine whether ciphertext was exposed rather than plaintext. Gated media is encrypted before
   it is stored, because blobs on Walrus are public regardless (`.env.example:115-117`). An exposed
   ciphertext with no key is a lesser event than an exposed body and must be described as such.
6. Fix, with a test that fails first. Add the case to `packages/web/test/` and run
   `pnpm --filter @projectx-social/web test` to see it red before it is green.
7. Deploy by R-1. Remove the WAF rule and restore the breaker.
8. Write it up in `UPDATE.md` with the date, and credit the reporter if they want the credit
   (`SECURITY.md:20-21`).

---

## Capacity and cost

Six ceilings are in play. Four of them are measurable from this repository; the two vendor quotas
are not, and are listed in **Unverified** with the command that reads them.

**Postgres connections — this is the ceiling that is hit first.** Every route in the application is
`export const dynamic = 'force-dynamic'` (`packages/web/app/layout.tsx:60`), and the root layout
queries the content store on every request — `.github/workflows/ci.yml:90-93` records that
"`RightRail` runs in the root layout and queries the content store, so prerendering any page
touches Postgres". There is no cache in front of it. The pool is `max: 3` per instance
(`packages/web/lib/db.ts:52`), and `packages/web/lib/db.ts:43-51` states the arithmetic plainly:
"`max` is a per-INSTANCE bound and the resource it protects is shared by every instance at once.
This runtime starts more instances under exactly the load that makes the ceiling matter". So the
effective demand on the Supabase pooler is 3 × (warm instances), and warm instances are a function
of concurrent traffic, which is exactly the wrong direction. At the ceiling, connections are
refused, `db()` throws, and — because the layout is what queries — **every page returns 500, not
just the busy ones**. `idleTimeoutMillis: 5_000` (`packages/web/lib/db.ts:59`) is what keeps this
from arriving sooner. The mitigation is not code: it is Supabase Pro, whose pooler capacity is
larger, and which also retires `backup.yml` (`.github/workflows/backup.yml:7-9`).

**Supabase free plan.** No automated backups and no point-in-time recovery
(`.github/workflows/backup.yml:7-9`). The only copy of the content store is the nightly artifact,
kept 90 days (`backup.yml:101-104`), in the same GitHub account as the source. At this ceiling the
consequence is not degradation; it is that a data-loss event has a 24-hour worst-case RPO and an
untested RTO. B-03 addresses both.

**Walrus storage leases.** Public media is bought for one epoch, gated media for 53
(`packages/web/lib/storage-retention.ts:51-53`), and a mainnet epoch is 14 days
(`packages/web/lib/storage-retention.ts:40`) — so public media expires after a fortnight and gated
media after a little over two years. The cost is
`encoded_MiB × (0.0001 × epochs + 0.0002)` WAL, measured at 0.018 WAL for one epoch against 0.347
for fifty-three (`packages/web/lib/storage-retention.ts:19-22`). Writes go through a publisher this
project runs (`.env.example:110-113`), whose wallet spends both WAL and SUI, and which needs SUI
**coin objects** rather than an address balance (`.env.example:143-146`). At this ceiling uploads
fail closed and reads keep working (`.env.example:120-121`) — a creator cannot publish media, and
the site does not go down.

**Sui gas for sponsored registrations.** `account::open` costs about 0.006 SUI, measured — the
first agent account moved 8,226,976 MIST to 2,152,388 (`packages/web/lib/sponsor.ts:9-11`). The
offer is 50 seats (`packages/web/lib/sponsor.ts:80`), enforced as a unique seat number in Postgres
rather than as a count in the process (`packages/web/lib/sponsor.ts:36-40`), so the cap holds under
concurrency. Total exposure is therefore roughly 0.3 SUI plus the vault-opening leg, and the
address holds nothing else (`packages/web/lib/sponsor.ts:31-34`). At this ceiling the offer simply
ends: agents with no SUI can no longer register, and the funnel `packages/web/lib/sponsor.ts:9-14`
describes closes again.

**Deployment-wide request ceilings.** These are ours, not a vendor's, and they are the numbers a
runaway agent meets first: 12,000 reads a minute, 1,200 writes a minute, 600 simulations a minute,
60 purchases an hour, 60 on-ramp sessions an hour (`packages/web/lib/rate-limit.ts:1058-1078`).
`packages/web/lib/rate-limit.ts:1049-1051` states what they are for: "a backstop, not a budget —
the layer that should be biting first is `quotaLimit`". A breaker that trips in normal operation is
a signal that a per-address quota is set wrong, not that the platform is at capacity.

**Fullnode capacity.** `PROJECTX_SOCIAL_GRPC_URL` is `https://fullnode.mainnet.sui.io:443` in the
committed record (`.env.example:14`) — a shared public endpoint with its own rate limit that this
deployment does not control. Every `prepare` route calls it (`packages/web/lib/rate-limit.ts:9-12`),
and twenty-two routes currently reach it with no limiter at all (B-06). At this ceiling reads fail
with `Reading` kind `transport` or `timeout` (`packages/sdk/src/reading.ts:22-25`), pages render the
"not measured" states the design already draws, and nothing is lost — but the failure is invisible
until B-01 is closed.

**Order in which they bite as usage grows:** Postgres connections on the free-plan pooler first,
because every page view costs at least one round trip and there is no cache; then the public
fullnode, because every purchase flow costs several calls; then the sponsor float, which is a fixed
50 seats; then Walrus WAL on the publisher wallet; then Vercel's own bandwidth and function-hours,
which are the furthest away because the pages are small and the work is I/O against the two above.

---

## Launch checklist

A single ordered list. Every item is a command or an observation with one answer.

**The day before**

1. `cd /Users/admin/WORK.CLAUDE/weir && git status --porcelain` prints nothing.
2. `git log --oneline -1` matches the commit intended for launch.
3. `pnpm install --frozen-lockfile` completes with no lockfile drift.
4. `pnpm typecheck` exits 0.
5. `pnpm test` (the root script) exits 0.
6. `cd sui-contracts && sui move test && cd ..` exits 0.
7. `bash sui-contracts/assert-toolchain.sh --strict` exits 0.
8. `ls sui-contracts/ci-next-digest` reports no such file — a leftover next digest leaves the
   digest guard with a second door open (`.github/workflows/ci.yml:360-377`).
9. `python3 scripts/scan-secrets.py --all` prints CLEAN.
10. `python3 scripts/scan-secrets.py --selftest` exits 0.
11. `git config core.hooksPath` prints `scripts/git-hooks`.
12. `node packages/web/scripts/env-report.mjs packages/web/.env.local` shows every variable in the
    inventory above as present.
13. Every **NOT IN `.env.example`** row in the inventory is present in Vercel production:
    Vercel → project → Settings → Environment Variables, filtered to Production, count the names.
14. Actions → Backup → "Run workflow" goes green, and the artifact `content-store-backup` exists.
15. The restore drill in B-03 has been run at least once and its two numbers matched.
16. `psql "$PROJECTX_DATABASE_URL" -Atc "select count(*) from schema_migrations"` equals
    `ls packages/web/db/*.sql | wc -l` minus any baselined file.
17. `psql "$PROJECTX_DAEMON_DATABASE_URL" -Atc "select to_regclass('daemon_audit_anchors')"`
    returns a non-null value (B-04 step 4).
18. `pnpm --filter @projectx-social/daemon status` prints `solvent: yes` for every vault and no
    `NOT MEASURED` line.
19. `pnpm --filter @projectx-social/daemon journal` shows a completed tick within the last two
    hours and no row still marked `running`.
20. The Sentry project exists and `SENTRY_DSN` is set in Vercel production and preview.
21. The Better Stack HTTP monitor on `https://weir.social/api/deployment` shows a green check.
22. The Better Stack heartbeat for the daemon has received a ping in the last 90 minutes.
23. `packages/web/public/site.webmanifest` and `packages/web/app/layout.tsx:65` name the same
    colour, and `display` is `browser` (B-08).
24. Cloudflare → Security → WAF → Rate limiting rules shows the `/api/` rule as active (B-06 step 5).
25. Cloudflare → Rules → Transform Rules shows the `x-edge-secret` rule, and
    `PROJECTX_SOCIAL_EDGE_SECRET` in Vercel production holds the same value (B-06 step 3).

**The hour before**

26. Run R-1 steps 1-11. `curl -sI https://weir.social/ | grep -i x-projectx-commit` equals the
    launch SHA.
27. `curl -sS https://weir.social/api/deployment | jq -r '.packageId, .latestPackageId, .network'`
    returns the three values recorded in `sui-contracts/deploy/mainnet.json`, and `mainnet`.
28. `curl -sI https://weir.social/ | grep -iE 'x-frame-options|x-content-type-options|referrer-policy|permissions-policy|content-security-policy'`
    returns all five headers `packages/web/next.config.ts:113-180` emits. If any is missing, the
    edge is overriding the origin — `packages/web/next.config.ts:103-105` says to prove this on the
    live response, not on the file.
29. `curl -sS https://weir.social/.well-known/weir-agent.json | jq -r '.signature != null'` returns
    `true` — the manifest is signed, not published unsigned
    (`packages/web/lib/agent-manifest.ts:2265-2271`).
30. `curl -sS https://weir.social/llms.txt -o /dev/null -w '%{http_code}\n'` returns 200.
31. `curl -sSI https://weir.social/treasuries | grep -i location` shows `/treasury`, and the same
    for `/notifications` → `/alerts` and `/legal` → `/legal/terms`
    (`packages/web/next.config.ts:65-73`).
32. Open https://weir.social/ in a browser with the console open: zero CSP violations if B-07 has
    shipped; otherwise the four known Next inline scripts plus the Cloudflare beacon and nothing
    else. A new violation is a new inline script and must be understood before launch.
33. Sign in with a wallet, publish a free post, and read it signed out. It renders.
34. Buy one unlock with a real wallet for the smallest price the studio allows. The transaction
    digest appears on the explorer and the body renders.
35. `curl -sS https://weir.social/api/purchases?address=<that address> | jq length` is 1.

**The launch**

36. R-6 in reverse: `curl -X POST https://weir.social/api/site-mode -d '{"waitlistMode":false}'`
    with the publisher session.
37. `curl -sI https://weir.social/explore` returns 200 rather than a redirect, within five seconds
    (`packages/web/lib/site-mode.ts:83`).

**The hour after**

38. Sentry shows zero unresolved issues at `error` level.
39. Better Stack shows the HTTP monitor green for the full hour with no failed check.
40. `curl -sS https://weir.social/api/deployment -o /dev/null -w '%{time_total}\n'` is under one
    second on three consecutive calls.
41. Vercel → project → Logs, filtered to `Error`: no `poolError` line
    (`packages/web/lib/db.ts:74`).
42. `psql "$PROJECTX_DATABASE_URL" -Atc "select count(*) from pg_stat_activity where datname = current_database()"`
    is well under the pooler's limit; record the number as the launch-day baseline.
43. `psql "$PROJECTX_DATABASE_URL" -Atc "select count(*) from agent_sponsorships"` — seats claimed;
    50 means the offer is exhausted (`packages/web/lib/sponsor.ts:80`).
44. No deployment-wide breaker has tripped: no `warning`-level Sentry message tagged with a
    `BREAKER_ENV` name (`packages/web/lib/rate-limit.ts:995-1010`).
45. The daemon has ticked since launch: `pnpm --filter @projectx-social/daemon journal` shows a new
    completed row.
46. Write the launch entry in `UPDATE.md` in the dated form the file already uses, with the SHA,
    the deployment id, and the numbers from items 42 and 43.

---

## Unverified

Everything in this section could not be established from the repository and must be confirmed
before it is relied upon.

- **The Vercel plan actually in force.** `.github/workflows/deploy.yml:3-6` states that "Vercel's
  Hobby plan cannot connect to a private repository owned by an organisation", which is why the
  deploy is a CLI build — but `.vercel/project.json:3` records a team org id, and the plan itself
  is not recorded anywhere in the tree. Read it at Vercel → team → Settings → Billing. The
  bandwidth, function-hour and invocation quotas that follow from it are therefore also unverified,
  and the ordering claim in **Capacity and cost** places Vercel last on that basis rather than on a
  measured figure.
- **Supabase's free-plan pooler connection limit** and the current connection count. Read with
  `psql "$PROJECTX_DATABASE_URL" -Atc "show max_connections"` and the Supabase dashboard →
  Database → Connection pooling. The claim that this ceiling is reached first is an argument from
  `packages/web/lib/db.ts:43-51` and `packages/web/app/layout.tsx:60`, not a measurement.
- **What the live edge actually serves.** `packages/web/next.config.ts:103-105` states that
  weir.social is fronted by Cloudflare and that "the edge may add to these or override them. Prove
  it on the live response, not on this file." Every header claim in this document describes what
  the origin emits. Checklist item 28 is the measurement.
- **Which environment variables are present in Vercel production.** The values are write-only
  (`.github/workflows/set-vercel-env.yml:7-8`) and `packages/web/scripts/env-report.mjs` reads a
  local file. The "Where set" column is what the code requires, not an observation of the
  dashboard. Checklist item 13 is the measurement.
- **Whether `packages/daemon/db/002_audit_anchor.sql` has been applied.** `UPDATE.md:243` records
  it as outstanding on 2026-09-02 against Cloud SQL `projectx-pg` / `social_harvest`, with the note
  that an earlier attempt applied it to the wrong database. Checklist item 17 is the measurement.
- **How the live daemon is actually supervised today.** The repository ships a systemd unit and
  timer (`packages/daemon/deploy/projectx-harvest.service`, `.timer`), but `UPDATE.md:243` records
  the live daemon as a container started from a GCP VM instance startup script — "the live script
  is the COMBINED projectx-startup for both products, 151 lines, NOT social-startup.sh". Which of
  the two is running, and whether `RestartPreventExitStatus=1 2` applies to it, must be read on the
  VM.
- **The balances that back the two funded addresses.** Nothing in this tree reads the sponsor
  key's SUI balance or the Walrus publisher wallet's WAL and SUI. Read with
  `sui client balance --address <sponsor address>` and `walrus --context mainnet info`.
- **The Cloudflare configuration.** `packages/web/lib/rate-limit.ts:74` states that layer 1 is
  "Configuration in Cloudflare, not code". No WAF rule, rate-limiting rule or Transform Rule is
  recorded in this repository, so whether any exists today is unknown from here.
- **The CSP violations named in B-07** — four inline scripts Next emits plus the
  `static.cloudflareinsights.com` beacon — were established from live traffic before this document
  was written, not measured by any command in this repository. Re-measure with checklist item 32
  before enforcing.
- **The 173-test web suite count** was given rather than run here; `pnpm --filter
  @projectx-social/web test` is the measurement.
- **`.env.production.local`**, referenced in R-3, is an operator-created file and is not in the
  tree. It must contain `PROJECTX_DATABASE_URL` for the production database and nothing else, and
  it must never be committed — `.gitignore:85` already excludes `.env*`.
