# Red-Team Review Approach — Weir Project

**Purpose:** Critique the delivery plan, code sweep, and blocker matrix for unsound claims,
missing functions, and unverifiable assertions. This is not a "find bugs" exercise; it is a
structured integrity check on what we *say* we have achieved vs what is *demonstrably* true.

---

## Review Framework

Every review item follows this template:

```
### <ID> — <Claim under review>

**Source:** (which document / PR / code area)
**Type:** (claim | assumption | gate | test | operator-action)
**Risk:** (S1 = money/data loss or unnoticed outage | S2 = defect in production | S3 = visible defect)
**Evidence required:** (what would satisfy the reviewer)
**Current status:** (verified | unproven | contradicted | operator-only)
**Verdict:** (pass | needs_revision | blocked | operator-action)
```

The reviewer **must not** fill in `Verdict` or `Evidence required` from memory. Those come from
explicit checks against the repository, the live site, or the operator. If the evidence does not
exist in the tree, the item is `needs_revision` or `blocked` with a concrete `blocked_reason`.

---

## Review Areas

### A. Plan ↔ Code Coverage

| ID | Claim | Source | Type | Risk | Evidence Required | Verdict |
|---|---|---|---|---|---|---|
| A1 | "All API routes record failures through `recordFailure`" | PR #236; the sweep content is on main via 391aac2 ("Give the product a memory: record every failure and show it on a page you can read") — the originally cited c57ed85 is unreachable from main (`git merge-base --is-ancestor c57ed85 main` fails) | claim | S2 | `grep -rl 'recordFailure' packages/web/app/api --include='route.ts' \| wc -l` — re-derived 2026-11-16: **61 of 73** route.ts files (58 at branch start; commit 194d65c added recordFailure to agents/mind, agents/seeking and agents/seeking/offers) | |
| A2 | "Error alarm fires hourly and reaches a human" | `error-alarm.yml` schedule + `onRequestError` hook | claim | S1 | `gh run list --workflow=error-alarm.yml --limit 1 --json databaseId,conclusion` shows SUCCESS; dashboard confirms issue filed | |
| A3 | "Restore drill runs end-to-end" | `backup.yml` + pg17 restore | claim | S1 | `pg_restore --no-owner --no-privileges --schema=public -d <db> <dump>` exits 0 with row counts matching original | |
| A4 | "Route edits cover all handlers that need catching" | merged into #236; on main via 391aac2 (c57ed85, the previously cited commit, is unreachable from main) | claim | S2 | count of route.ts files containing `recordFailure`: re-derived 2026-11-16 = **61 of 73** (58 at branch start; +3 in 194d65c). The old check's glob (`api/*/route.ts`) never reaches nested route directories — re-derive with `find packages/web/app/api -name route.ts` | |
| A5 | "CSP hardening is coded and working" (originally claimed as: "CSP nonce migration is coded and will work") | `next.config.ts` + `packages/web/test/csp.test.ts` | claim | S3 | Contradicted as originally written: **no nonce exists anywhere in the tree**. What actually shipped (re-derived 2026-11-16): an enforced CSP carrying only the four break-proof directives (`object-src`, `base-uri`, `form-action`, `frame-ancestors`), plus a **hash-pinned** (`'sha256-<INLINE_THEME_SCRIPT_SHA256>'`) `Content-Security-Policy-Report-Only` script-src reported to `/api/csp-report`, whose reports land in `error_events`; `csp.test.ts:44-48` asserts **no** script-src is enforced yet — enforcement awaits the operator's header switch (B-07) | |
| A6 | "Rate limiter covers the 22 previously-unprotected routes" | `rate-limit.ts` + B-06 fix description | claim | S2 | `grep -rl 'rateLimit\|simulateLimit\|quotaLimit\|tripBreaker' packages/web/app/api --include='route.ts' \| wc -l` — re-derived 2026-11-16: **73 of 73** route.ts files carry a limiter call | |
| A7 | "Daemon heartbeat only fires on clean tick" | `packages/daemon/src/index.ts` + test | claim | S1 | Test: `heartbeat-only-on-a-clean-tick.test.ts` passes 5/5; `fetchSpy` called exactly once on ok tick, zero times on failed/skipped | |

---

### B. Blocker Matrix Verification (08-LAUNCH.md)

| ID | Blocker | Category | Code State | Operator Action | Verified |
|---|---|---|---|---|---|
| B-01 | Nothing reports an error, nothing notices an outage | S1 | Code: `error-alarm.yml`, `onRequestError`, `error_events` table | Sentry DSN + Vercel env + uptime monitors | **operator-only** (no code dependency) |
| B-02 | Nothing automated gates the build that is deployed | S2 | Code: `deploy.yml` has `cancel-in-progress: false`; gate preserved | None (already green) | ✅ |
| B-03 | Backup has never been restored, so no known-good restore | S1 | Code: `restore-test` job merged; first-ever run successful | Operator confirms drill passes | ✅ |
| B-04 | Harvest daemon can stop and nobody is told | S1 | Code: `pingHeartbeat()` + test; env var on VM/local daemon | **operator** (daemon env: `PROJECTX_DAEMON_HEARTBEAT_URL` + monitor endpoint) | **blocked** until operator configures daemon env |
| B-05 | Secret and key custody has no inventory and no rotation drill | S2 | Code: no changes needed; audit procedures documented | None (procedural) | ✅ |
| B-06 | 22 API routes have no rate limit, edge secret unset | S2 | Code: every route.ts (73 of 73) carries a limiter call; **7** breaker env vars in `BREAKER_ENV` (`lib/rate-limit.ts:471-479`), all seven blank in `.env.example` since 2026-11-16 | Vercel + Cloudflare config | **blocked** until operator sets secrets + WAF rule |
| B-07 | CSP is Report-Only and cannot be enforced | S3 | Code: Report-Only policy ships with a hash-pinned script-src and a `/api/csp-report` collector writing to `error_events` (no nonce exists in the tree — see A5); operator to switch the header key | Vercel + Cloudflare CSP config change | **blocked** until operator enforces |
| B-08 | Manifest-page theme colour disagreement + `standalone` promise | S3 | Code: colours already `#03050a` agreement; sw.js present + registered; test passes | None (already resolved) | ✅ |

---

### C. Unverifiable Assertions — How to Handle

An assertion is **unverifiable** when:

1. **It references a live external state** (Vercel dashboard, GCP VM console, Cloudflare rules) that
   no code in this repository can observe or enforce.
2. **It depends on a future event** (e.g., "once Sentry is configured, errors will be reported").
3. **It relies on operator action** that has not been taken (e.g., "set the edge secret").

**Policy:** Unverifiable assertions must be marked `operator-only` and **not** blocked the code merge.
They must be recorded in the blocker matrix with a `blocked_reason` that names the exact missing
configuration, and a follow-up task must be created to track the operator action.

**Example:**

```
### B-01 — Nothing reports an error, and nothing notices an outage (S1)

**Source:** 08-LAUNCH.md:B-01; error-alarm.yml merged; no Sentry DSN in tree
**Type:** claim | assumption | gate | operator-action
**Risk:** S1 — money or data can be lost, or an outage runs unnoticed
**Evidence required:** Sentry DSN added to Vercel production/preview; uptime monitor created at
  Betterstack and subscribed to the six public routes plus /api/deployment
**Current status:** code: error-alarm.yml merged, onRequestError hook added, error_events table created.
  external: Sentry DSN **not present** in .env.local or Vercel dashboard; no uptime monitors configured.
**Verdict:** needs_revision (code pass) | blocked (operator): Sentry DSN + uptime monitors not configured.
  blocked_reason: "Sentry DSN and Betterstack uptime monitors are operator-configured; not in repo."
```

---

### D. Rating Scale

| Code | Meaning |
|---|---|
| `pass` | Claim is demonstrated true against the repository or live site. |
| `needs_revision` | Claim is mostly true but requires a code change before merge/release. |
| `blocked` | Claim cannot be confirmed until an operator action is completed. |
| `contradicted` | Evidence in the repository contradicts the claim. |

---

### E. Review Process

1. **Clone the repository** at the target commit (main is `9ecee1f` as of 2026-11-16 — always re-derive with `git rev-parse main`; never trust this line's hash).
2. **Run each checklist item** as an explicit command or test, recording the output.
3. **Mark every item** as `pass`/`needs_revision`/`blocked`/`contradicted`.
4. **For `blocked` items**: record the exact `blocked_reason` and the operator action required.
5. **For `needs_revision` items**: create a minimal fix and re-run the check.
6. **Produce a summary** with:
   - Count of `pass` / `needs_revision` / `blocked` / `contradicted`
   - List of all `blocked_reason` strings (for the operator hand-off)
   - Confirmation that no `contradicted` items exist (if they do, halt and fix)

---

### F. How to Use This Approach

**As a pre-merge gate:** Run the checklist against a PR branch before squash-merging. Any
`blocked` item with an operator action must be resolved by the operator before the merge is
considered complete. `needs_revision` items must be fixed in the PR before merge.

**As a post-delivery audit:** Run the checklist against `main` after the delivery window. Record
all `blocked_reason` strings and present them to the operator as a hand-off checklist. Items
marked `pass` are guaranteed by code; items marked `operator-only` are the operator's
responsibility per the delivery plan.

**As a continuous integrity check:** Schedule the checklist to run weekly (or on every main push)
and deliver a diff of changes from the prior run. This catches drift between what the code
claims and what the repo actually contains.

---

## Review This Document Itself

Before deploying this approach, the review team should answer:

1. Does the framework cover all B-01–B-08 blocker categories from `08-LAUNCH.md`?
2. Are the evidence requirements feasible to check automationally (yes/no for each)?
3. Is the `operator-only` vs `code` distinction clear for every item?
4. Does the rating scale adequately distinguish "code fix needed" from "operator action needed"?
5. Is the "how to use" section sufficient for a non-technical operator to understand their
   responsibilities?

If any answer is "no", revise the framework before applying it.

---

**End of document.**