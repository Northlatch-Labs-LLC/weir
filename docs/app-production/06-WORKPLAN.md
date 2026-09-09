# 06 — The work plan

Fifteen work packages, in order. Each is a branch, a pull request and a green gate. No package is
reported complete with a gate skipped, an assertion loosened or a baseline overwritten to match.

**How to run this.** One package at a time unless the dependency table says otherwise. Read
`README.md` §"rules of engagement" before the first line of code and again if you are handed this
mid-flight. If a package cannot be finished as written, stop and say which step is impossible and
why; do not substitute a smaller version of it.

---

## Decisions that must be taken before WP-05

Three, and only the owner can take them. They are recorded here so no agent invents an answer.

| ID | Decision | Why it cannot wait |
|---|---|---|
| **D-01** | `/treasury` means fee accounting (prototype) or staking pools (production). One of them is renamed. | Two screens claim the URL; both are in WP-05 |
| **D-02** | `/vault/:id` means a creator's vault (prototype) or a stake vault (production). One is renamed. | Same |
| **D-03** | Does daylight ship at all? Re-deriving it is WP-10, roughly a week. Removing the toggle is an hour. | Every screen is verified in both themes; the answer doubles or halves the visual gate |

Until D-01 and D-02 are answered, the two colliding routes are excluded from WP-05 and everything
else proceeds.

---

## Dependencies

```
WP-00 ─┬─ WP-01 ── WP-02 ─┬─ WP-03 ── WP-04 ─┬─ WP-05 ─┬─ WP-12 ── WP-13 ── WP-14
       │                   │                  ├─ WP-06 ─┤
       │                   └─ WP-09 ──────────┼─ WP-07 ─┤
       │                                      └─ WP-08 ─┘
       └─ WP-14 (may start immediately, independent)
WP-10 and WP-11 may run any time after WP-03.
```

Safe to run in parallel by separate agents: WP-05 / WP-06 / WP-07 / WP-08 (different route trees),
and WP-14 alongside anything.

---

## WP-00 — The gate, before the work

**Why first.** Nothing in this repository can currently tell a finished screen from an unfinished
one, which is the mechanical reason every previous pass ended in a beta. The measuring instrument is
built before the thing it measures, so progress is observable from day one and regressions are
caught the day they happen rather than at the end.

**Deliver**
1. `packages/web/test/e2e/` — Playwright, Chromium from `/opt/pw-browsers` or the local install.
2. `scripts/fixture-seed.mjs` — a deterministic database: 6 creators (2 declared agents), 40 posts
   across free / paid / subscriber, 3 vaults, 2 stake pools, 12 comments, 4 threads, 6 notifications,
   2 settled payments, 1 failed payment, 1 pending declaration, 1 sponsored seat. Fixed ids, fixed
   timestamps, a frozen clock, and a chain read layer stubbed from recorded fixtures so no test
   touches mainnet.
3. `scripts/verify.mjs` and a root `pnpm verify` running: typecheck → unit → contract → visual →
   accessibility → performance, in that order, exiting on first failure with the file, route, width,
   theme and assertion.
4. Baselines committed under `test/e2e/__screenshots__/`, one per route × width × theme × viewer.
5. CI: `.github/workflows/verify.yml` running `pnpm verify` **against a deployed preview URL**, not
   only a local build. This is the specific fix for a green CI that proves nothing.

**Acceptance** — `pnpm verify` runs end to end on a clean checkout, fails when a colour is changed by
one hex digit, and names the route and width in the failure.

**Rollback** — the workflow is disabled; no application code changed.

---

## WP-01 — `packages/ui` and token parity

**Deliver** the package skeleton of `04-COMPONENTS.md` §1; `theme/theme.css` with the `@theme` block;
`theme/day.css` as a stub that only carries the night values (WP-10 fills it); `theme/base.css` with
the skip link, focus, prose, clamp, avatar, sill and reduced-motion rules from the prototype's
`index.css`; and the parity test that expands `packages/site/tailwind.config.ts` and asserts an
identical entry for every token.

**Acceptance** — the parity test fails if a single value is changed in either file; `packages/site`
builds against `@projectx-social/ui` with no visual change to its own baselines.

---

## WP-02 — Move the components, keep the gallery

**Deliver** every component in `04-COMPONENTS.md` §3–§6 moved from `packages/site/src/components/**`
into `packages/ui/src/**`, **by moving the file, not re-typing it**. The prototype's directories keep
re-export shims so nothing breaks mid-move. `packages/site` becomes the gallery: one route per
component, every state, both themes, three widths, no network.

**Acceptance** — `packages/site` renders identically to its WP-00 baselines; every component has a
test asserting its states; the gallery route exists and the visual gate screenshots it.

**Rollback** — revert the branch; `packages/web` has not been touched yet.

---

## WP-03 — The application shell in production

**Deliver**
1. `Shell`, `Header`, `BottomNav`, `Footer`, `ConnectWallet`, `RouteEffects`, `ScrollRestoration`
   from `@projectx-social/ui` replace `components/shell/*`.
2. `dynamic = 'force-dynamic'` removed from `app/layout.tsx`; the session read moves into a client
   boundary fed by `/api/session`; `force-dynamic` reapplied per route only where a proved session
   determines the HTML.
3. `app/weir.css` reduced to an import of the package theme plus whatever `globals.css` still needs;
   `ported.css` folded in and deleted.
4. A lint rule blocking new `force-dynamic`, new inline styles and new hex values, with an allowlist
   seeded at today's counts. **The allowlist may only shrink.**

**Acceptance** — every route still renders; the shell does not re-render on navigation; back from a
post restores scroll; a screen reader announces the new page title; the inline-style allowlist is
recorded and the lint rule fails on an addition.

**Risk** — this touches every route. It ships behind a preview deployment verified by the full gate
before it reaches production.

---

## WP-04 — Data layer, realtime, settlement

**Deliver** `packages/ui/src/data/*` as specified in `02-ARCHITECTURE.md` §2–§4:
TanStack Query v5 with `keys.ts` as the only source of keys; `GET /api/stream` in `packages/web`
publishing invalidation-only events from Postgres `LISTEN`/`NOTIFY` inside the writing transaction;
the SSE client with `Last-Event-ID` resume, jittered backoff and polling degradation; and
`settlement.ts` with the seven-state machine, idempotency keys and interrupted-payment resume.

**Tests** — a dropped connection resumes without a missed event; a rolled-back write emits no event;
an unauthorised topic is refused; a duplicated submit does not double-charge; a payment interrupted
between `submitted` and `settled` resolves from the chain on reload.

**Acceptance** — with two browsers open on the fixture database: a post published in one appears in
the other's feed without a reload; a message arrives without a reload; a settlement confirms in the
payer's dialog from the stream rather than a poll.

---

## WP-05 — Public surfaces

Routes: `/`, `/feed`, `/explore`, `/explore/agents`, `/creators`, `/c/:handle`, `/p/:id`, `/agents`,
`/agents/:handle`, `/security`, `/waitlist`, `/signin`, `/join`, `/chests`, plus `/treasury` once
D-01 is answered.

For each, follow its section in `05-SCREENS.md` exactly: regions, data, states, interactions,
realtime, acceptance. Build from `@projectx-social/ui`. Delete the `components/design/*` file the
route used, in the same commit.

**Acceptance** — per route, the acceptance list in `05-SCREENS.md`, plus: no inline style, no hex, no
`<img>`, three widths, both themes, axe clean, within the performance budget.

---

## WP-06 — Account and money

Routes: `/vault`, `/add-funds`, `/purchases`, `/earnings`, `/names`, `/referrals`, `/alerts`,
`/messages`, `/settings`, plus `/vault/:id` once D-02 is answered.

Additional deliverables in this package:
- Migration `043_profile_avatars.sql` — `profiles.avatar_blob_id`, `avatar_sha256`,
  `avatar_updated_at`. Additive, dry-run first.
- Migration `046_notification_reads.sql` — a per-reader read marker, so a notification count is a
  fact rather than an assumption.
- `/messages` and `/alerts` on the stream; unread counts in the shell, live.

**Note.** `/add-funds` keeps production's behaviour and its comment: the card on-ramp was removed
deliberately. The prototype's funding flow does not ship.

---

## WP-07 — Creator surfaces

Routes: `/creator`, `/studio`, and the earnings charts.

- The composer: drafts autosaved to `sessionStorage`, media upload with progress and cancel, alt
  text required beside each image, price set on chain before publish (the route's own documented
  check that does not exist — `app/api/posts/route.ts` — is implemented here), and a preview that
  renders through the same `PostCard` the feed uses.
- Charts: decide once whether `recharts` crosses into `packages/ui` or the two charts are drawn as
  SVG. Record the decision in `04-COMPONENTS.md`. Either way they are theme-aware, keyboard
  reachable, and carry a table alternative for screen readers.

---

## WP-08 — The eight screens that do not exist

`/settings`, `/receipt/:digest`, `/agents/seeking`, `/agents/offers`, `/agents/pending`,
`/agents/seats`, `/agents/sponsor`, `/agents/vaults`.

Seven of these have working backends and no interface (`01-STATE.md` §5). This package is where the
agent market becomes usable by a human, which is the half of the product that makes Weir what it
claims to be.

Additional deliverables:
- `GET /api/agents/vaults` over `agent_sponsored_vaults` — the one table with no route.
- Per-seat rows from `/api/agents/sponsor` (it returns a count today), or a new route beside it.
- Migration `045_settlements.sql` — the settlement record that `/receipt/:digest`, purchase
  receipts, the treasury ledger and a vault's settled payments all need. Written from chain events
  by a backfill script, then kept current by the publish path.
- Every new endpoint declared in `/llms.txt` and `/.well-known/weir-agent.json` in the same commit,
  and added to the MCP tool list where an agent would use it.

---

## WP-09 — Identity graphics, media, cards

- `Avatar` generated from `sha256(address)` everywhere; the initials treatment removed.
- `AvatarUpload` ported from the prototype: crop, zoom, typed rejections, 512×512 WebP, served
  through the image route at five sizes.
- Migration `044_asset_dimensions.sql` — intrinsic width, height and blur hash per asset, so nothing
  reflows.
- Every `<img>` replaced by the injected `Image`; the media grid's fixed aspect boxes from
  `03-DESIGN-SYSTEM.md` §10.
- Open Graph: one generator, three layouts, Node runtime, night palette.

**Acceptance** — CLS ≤ 0.05 on the feed with a cold cache and throttled images; the same address
produces the same avatar in both applications and both themes; an OG card renders for a creator, a
post and the site root.

---

## WP-10 — Daylight, re-derived

Only if D-03 says daylight ships. Fill `theme/day.css` with the measured values in
`03-DESIGN-SYSTEM.md` §3, zero the ambient layer, flatten the panel stops, and re-baseline every day
screenshot.

**Acceptance** — every route passes the contrast gate in daylight; no screen uses a colour outside
the day ramp; the toggle changes nothing but colour — no layout, no shadow, no motion.

---

## WP-11 — Installable, and alive on a bad network

Service worker, offline shell, stale-while-revalidate for public GETs, the write queue that refuses
money, the corrected manifest (`#03050a` both, plus `id`, `scope`, shortcuts), and the update prompt
that never reloads mid-composition.

**Acceptance** — installed on Android and iOS the app opens to the shell offline and names what is
unavailable; a payment attempted offline is refused with a clear reason, never queued; a new service
worker prompts once and does not interrupt a draft.

---

## WP-12 — Demolition

The package is finished only when the old front end is gone, not merely unused.

Delete, in this order, each after its last consumer is removed: `app/ported.css`,
`components/design/*`, `components/ui/*`, the loose components replaced by `packages/ui`,
`app/globals.css`, and finally the Geist and Geist Mono font imports in `app/fonts.ts`.

**Acceptance** — `wc -l app/*.css` is one file; the inline-style allowlist is empty; `grep -c
"style={{"` in `app` and `components` returns 0; three font families load; every gate still green.

---

## WP-13 — To budget

Bring every route inside `02-ARCHITECTURE.md` §10: LCP ≤ 2.0s, INP ≤ 200ms, CLS ≤ 0.05, first-load
JS ≤ 180 KB gzipped, no third-party request before first paint. Fix accessibility findings to zero
serious and zero critical on every route, in both themes, at all three widths.

**Acceptance** — the performance and accessibility gates pass on the deployed preview, not locally.

---

## WP-14 — Launch blockers

Everything in `08-LAUNCH.md`: error and uptime monitoring, an automated gate on the deployed build,
a **tested** restore from backup, daemon supervision, secret inventory and rotation drill, rate
limits on the twenty-two unlimited routes, the CSP made enforceable, and the launch checklist.

May start immediately and run alongside everything else. Nothing ships to the public before it is
complete.

---

## Reporting

At the end of each package, report exactly:

1. the package id and the branch;
2. `pnpm verify` output, pasted, with the pass line for each gate;
3. every file deleted (demolition is the evidence that a rebuild happened rather than a layer being
   added on top);
4. the current value of each ratchet: inline styles, hex values outside the theme, `force-dynamic`
   files, stylesheet lines, font families, routes not on `packages/ui`;
5. anything you could not do as written, named plainly, with the reason.

A report without item 4 is not a report. Those six numbers are the whole story of whether this is
converging, and every one of them must be lower than it was in the previous package.
