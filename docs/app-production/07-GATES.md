# 07 — The gate: what "done" means, mechanically

The repository has 173 web test files and no way to tell whether a screen is finished. Correctness is
tested; *the product* is not. This file replaces judgement with a command.

```bash
pnpm verify
```

Seven gates, in order, exiting on the first failure, naming the file, the route, the width, the
theme and the assertion. A work package is complete when this passes on a **deployed preview**, not
on a laptop.

---

## 0. The fixture

Every gate below runs against one deterministic world, so a failure means a change and never a
coincidence.

`scripts/fixture-seed.mjs` writes: 6 creators (2 declared agents, 1 undeclared, 1 with no vault, 1
with a closed pool, 1 brand new with nothing published), 40 posts spanning free / paid / subscriber
/ sealed-media / thread-grouped, 3 creator vaults, 2 stake pools at different ladder rungs, 12
comments, 4 message threads, 6 notifications (3 unread), 2 settled payments, 1 failed payment, 1
payment interrupted between submit and settle, 1 pending declaration, 1 open sponsored seat, 1
claimed seat, and one creator whose chain read is stubbed to **fail**, so "not measured" is exercised
on every screen that can show it.

The clock is frozen at `2026-09-09T12:00:00Z`. Chain reads come from recorded fixtures. No gate
touches mainnet, and no gate needs a wallet.

Four viewers are exercised on every route that varies by them: **guest**, **signed-in reader**,
**creator**, **declared agent operator**.

---

## 1. Typecheck and unit

`pnpm -r typecheck && pnpm -r test` — unchanged from today, plus the new component tests in
`packages/ui`. Runs on a clean checkout with no incremental cache, because `tsc` has already reported
success against a stale one in this repository's history.

---

## 2. Contract gates — the cheap ones that catch the expensive mistakes

| Check | Fails when |
|---|---|
| **Token parity** | a colour, size, line height, radius or max-width exists in `packages/site/tailwind.config.ts` with no identical entry in `packages/ui/src/theme/theme.css`, or the reverse |
| **Theme completeness** | a token defined for night has no daylight value, or a value appears in `day.css` that is not in the day ramp of `03-DESIGN-SYSTEM.md` §3 |
| **Route parity** | a route in `packages/site/src/router/config.tsx` has no production route, or a production route is in neither the prototype nor the production-only list in `05-SCREENS.md` |
| **Key discipline** | a query key is constructed outside `packages/ui/src/data/keys.ts` |
| **Mutation invalidation** | a mutation is declared with no `invalidates` array |
| **Agent parity** | an `app/api/**` route exists that is named in no `/llms.txt` entry and no manifest endpoint list |
| **Money safety** | `useOptimistic`, or an optimistic `onMutate`, appears in a file that also imports the settlement machine |
| **Format discipline** | an amount, address, digest or relative time is formatted outside `packages/ui/src/data/format.ts` |

Each is a plain Node script under `scripts/gates/`, each under 80 lines, each with its own test.

---

## 3. The ratchets

Six numbers. Each has a recorded ceiling that **may only go down**. A pull request that raises one
fails, with no override flag — if a number must rise, the ceiling is changed in a separate commit
that says why, and that commit is reviewed on its own.

| Ratchet | Today | Target |
|---|---|---|
| `style={{` occurrences in `app/` + `components/` | **1,112** | 0 |
| hex and `rgba()` literals outside `packages/ui/src/theme/` | measure at WP-00 | 0 |
| files with `export const dynamic = 'force-dynamic'` | **105** | ≤ 14 (session-dependent routes only) |
| total stylesheet lines in `packages/web/app/*.css` | **7,857** | ≤ 300 (one import file) |
| font families loaded | **5** | 3 |
| routes not built from `@projectx-social/ui` | **42** | 0 |

These six numbers are the honest progress report. Every work package reports them
(`06-WORKPLAN.md` §Reporting), and if they are not falling, the work is not converging however good
the diff looks.

---

## 4. Visual regression

Playwright, Chromium, against the fixture.

- **Matrix**: every route × {390, 834, 1440} × {night, day} × the viewers that route varies by.
  With 42 routes that is roughly 500 screenshots. They run in parallel and take minutes.
- **Determinism**: frozen clock, animations disabled via `prefers-reduced-motion`, fonts preloaded
  and awaited, network idle plus an explicit "content settled" marker the shell sets when no query
  is in flight. Any test that needs a `waitForTimeout` is a broken test.
- **Threshold**: `maxDiffPixelRatio: 0.001`. A one-hex-digit colour change fails. This is the point.
- **Baselines** are committed. `pnpm verify:visual --update` regenerates them and the diff is
  reviewed like code. **A baseline is never updated in the same commit as the change that moved it
  without the diff being shown in the pull request.**
- **State coverage**: for every route, additional shots of its loading, empty and error states, and
  of the payment dialog at each of its seven stages, driven by fixture flags rather than by timing.

---

## 5. Accessibility

`@axe-core/playwright` on every route × theme × viewer.

- **Zero serious, zero critical.** Moderate findings are listed in the run and tracked; they do not
  block.
- **Keyboard traversal test** per route: tab from the top, assert the skip link is first, assert every
  interactive element is reachable, assert no focus trap outside a dialog, assert focus returns to
  the trigger when a dialog closes.
- **Contrast** is asserted from the token tables rather than sampled from pixels: a test reads
  `theme.css` and `day.css` and computes every text-on-surface and border-on-surface pair, failing
  below 4.5:1 for text, 3:1 for large text and meaningful borders. The tables in
  `03-DESIGN-SYSTEM.md` §2 and §3 are the expected values.
- **Touch targets**: every interactive element's box is measured at 390px; below 44×44 fails.
- **Reduced motion**: with the preference set, assert no element has a non-trivial animation or
  transition duration.
- **Forced colours**: one screenshot per route in forced-colors mode; primary actions must remain
  distinguishable.

---

## 6. Performance

Lighthouse CI against the deployed preview, emulated mobile, cold cache, three runs, median.

| Budget | Value |
|---|---|
| LCP | ≤ 2.0s |
| INP | ≤ 200ms |
| CLS | ≤ 0.05 |
| First-load JS per route | ≤ 180 KB gzipped |
| Third-party requests before first paint | 0 |
| Fonts | 3 families, self-hosted, preloaded |

Plus a bundle report per route committed to the run, so a dependency that arrives quietly is visible
in the diff rather than in a user's battery.

---

## 7. Where it runs

`.github/workflows/verify.yml`, on every pull request and on `main`:

1. build the workspace;
2. deploy a preview;
3. seed the fixture database for that preview;
4. run gates 1–6 **against the preview URL**;
5. publish the screenshot diffs and the ratchet numbers as a comment on the pull request.

The deploy workflow gates on this run's conclusion. That closes the hole recorded in the comment at
the top of `deploy.yml`: today a green CI means the secret scan and the digest guard passed and
nothing more, and a red tree reaches production exactly as fast as a green one.

**Neither the gate nor its thresholds may be weakened to make a package pass.** If a threshold is
wrong, it is changed in its own commit, with the measurement that justifies it, before the work that
needed it.

---

## 8. The definition of done, in one paragraph

The front end is production-ready when: every route in `05-SCREENS.md` is built from
`@projectx-social/ui`; all six ratchets are at target; `pnpm verify` passes on a deployed preview
across every route, width, theme and viewer; the eight missing screens exist and their endpoints are
declared to agents; the design gallery renders every component in every state; and the launch
checklist in `08-LAUNCH.md` is complete with a restore drill actually performed. Not before, and not
on anyone's opinion that it looks finished.
