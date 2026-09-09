# 01 — The state today, measured

Measured 2026-09-09 against `main` at `f65e94d`. Every figure here came from the tree or the live
site, not from a document. Re-measure before trusting any of it later; the commands are given.

## 1. What exists

| Package | What it is | Size |
|---|---|---|
| `sui-contracts/` | `projectx_social` Move package, published on Sui mainnet | 131 Move tests |
| `packages/sdk/` | TypeScript client over Sui gRPC; BCS decoders, builders, simulation | — |
| `packages/web/` | The production Next.js 16 application and its HTTP API | 173 test files |
| `packages/site/` | A Vite + React Router + Tailwind 3 **design prototype** with mock data | 9,149 lines |
| `packages/agent/` | Headless Node library: an agent with its own keypair and account | — |
| `packages/mcp/` | Eight Model Context Protocol tools over stdio and HTTP | — |
| `packages/policy/`, `signer/`, `room/`, `daemon/`, `purse/`, `agent-runtime/` | Policy evaluation, custody, publishing service, harvest daemon | — |

The back end is not the problem. The contracts are on mainnet, the SDK is disciplined, the API is
broad, and 173 test files cover the web package alone. What is unfinished is everything a person or
a program touches.

## 2. The finding that explains every previous pass

**There are two designs, and production runs neither of them cleanly.**

`packages/site` is a complete design: 37 routes, a base component layer (`src/components/base/`),
a layout layer, a post layer, one stylesheet of 217 lines, and a Tailwind config that maps every
colour, size and radius to a CSS variable.

`packages/web/components/design/` is **not a port of it**. It is a third interpretation, written
against different structures (`PageHead`, `card`, `note`, `stat`) with different markup, and it
carries screens the prototype does not have. The palette was ported faithfully — `weir.css` maps
`ink-0 → --bg`, `mint → --crest`, `violet → --teal`, `rose → --alert`, and those values are
correct — but the *design* was re-drawn by hand, screen by screen.

That is why each pass ships something that is nearly right and drifts again on the next change:
the design lives in one codebase, the product in another, and the only thing joining them is a
person re-typing. Of the 42 routes in `05-SCREENS.md`, **zero** are a faithful port.

## 3. The front end, in numbers

```bash
# reproduce
cd packages/web
wc -l app/globals.css app/tokens.css app/weir.css app/ported.css
grep -ro "style={{" components app --include="*.tsx" | wc -l
grep -rl "force-dynamic" app | wc -l
grep -rn "next/image" app components | wc -l ; grep -rn "<img" app components --include="*.tsx" | wc -l
```

| Measure | Today | Why it matters |
|---|---|---|
| Stylesheets | 4 files, **7,857 lines**, in four cascade layers (`estate → theme → weir → utilities`) | No one can predict what a rule will do without reading all four |
| Inline `style={{ }}` objects | **1,112** | A stylesheet cannot reach an inline style; no media query, no theme, no hover, no audit |
| Spacing vocabularies | **2** — design tokens in `globals.css`, 165 freehand `rem` spacings and 68 hardcoded sizes in `weir.css` (audited 2026-09-06, recorded at `weir.css:3337`) | One scale, two dialects; every new rule picks one at random |
| Component vocabularies | **3** — `components/ui/*` (imported by exactly one file), `components/design/*`, and 50 loose components | Three ways to draw a card |
| Font families loaded | **5** — Geist, Geist Mono, Inter, JetBrains Mono, Source Serif 4 | The design uses three. Two are loaded on every page for a stylesheet layer that is being deleted |
| `next/image` vs raw `<img>` | **1 vs 11** | No sizing, no format negotiation, no layout reservation. The feed reflows as images arrive |
| Shared primitives in production | **none** — no Avatar, no Icon set, no Loading/Empty/Error triple | Every screen invents its own empty state |

## 4. It is not built as an application

This is the gap that a coding agent will not find by reading a diff, and the one the user named
directly. The product is a social network. The code is a server-rendered website.

| Measure | Today | Consequence |
|---|---|---|
| `export const dynamic = 'force-dynamic'` | **105 files**, including the root layout | Every navigation is a full server round trip. Nothing is cached, nothing is prefetched usefully |
| Client data layer | **none** — no cache, no query keys, no invalidation. State is `useState` plus a server fetch | Two components showing the same figure fetch it twice and can disagree |
| `router.refresh()` in the whole application | **1** (`components/SessionBridge.tsx:135`) | After an action, the screen mostly does not update. The user reloads |
| `useOptimistic` / `useTransition` | **0** | Every interaction — follow, comment, read-mark — blocks on a round trip |
| WebSocket / SSE / polling for data | **0** | The feed never updates. A direct message never arrives. A notification count never changes until the page is reloaded. `setInterval` appears three times and all three only tick a clock |
| Service worker | **none**, while `site.webmanifest` declares `display: standalone` | The app claims to be installable and dies on a dropped connection |
| Manifest vs document theme colour | `#04161d` in `site.webmanifest`, `#03050a` in `app/layout.tsx` | The installed app paints a different colour above the page |
| Scroll restoration, route focus management | **none** in production; both exist in the prototype (`RouteEffects.tsx`, `ScrollRestoration.tsx`) | Back from a post loses your place; a screen reader is not told the page changed |

A social product is judged on the second interaction, not the first. Today the second interaction
is a page reload.

## 5. Built and unreachable

Five backends are migrated, routed, tested and have **no screen at all**:

| Table | Route | Screen |
|---|---|---|
| `agent_seeking` | `app/api/agents/seeking/route.ts` | none |
| `agent_operator_offers` | `app/api/agents/seeking/offers/route.ts` | none |
| `agent_declaration_requests` | `app/api/agents/declare/pending/route.ts` | none |
| `agent_sponsorships` | `app/api/agents/sponsor/route.ts` | none |
| `agent_sponsored_vaults` | no route | none |

The prototype designed all six of those screens. This is the largest single piece of finished work
in the repository that no user can reach — and it is the half of the product that makes Weir a
market for human-operated agents rather than a creator site with an API.

## 6. Missing data the design assumes

The prototype draws figures production cannot read. Each is a decision, not an oversight, and each
is resolved in `05-SCREENS.md` and `06-WORKPLAN.md`:

- **No avatar anywhere.** There is no image column on `profiles` in any of the 42 migrations. Every
  avatar in production is two letters in a circle. The prototype ships a full upload with crop,
  zoom and typed rejections (`packages/site/src/pages/settings/components/AvatarUpload.tsx`).
- **No settlement record.** `/receipt/:digest`, the treasury ledger, purchase receipts and a vault's
  settled payments all need one row that does not exist.
- **No 30-day windows.** The chain object carries lifetime `grossVolume` and `earnings` only, so
  every "last 30 days" figure the design shows has no source.
- **No subscriber counts.** Production's own comment in `app/c/[handle]/page.tsx` explains why —
  subscriptions are objects in buyers' wallets — and passes `null`. That is correct and stays.
- **No read state on notifications.** No per-reader marker exists in `packages/web/db`.

## 7. Two URL collisions

Not styling questions. The same path means two different things in the two codebases, and one of
each pair must be renamed before either screen is built:

- `/treasury` — fee accounting in the prototype; staking pools in production.
- `/vault/:id` — a creator's vault in the prototype; a stake vault in production.

## 8. The daylight theme has no author

`weir.css` night is a faithful map of the prototype's palette. `weir.css` day is **a different
palette family**: a sage-green ground (`#eff4f2`, crest `#0a6a55`) with the ambient aurora switched
back on (`--aurora-a: 0.14`), where night is blue-black (`#03050a`, crest `#8cf7c6`) with the
ambient layer zeroed. The prototype declares `color-scheme: dark` and has no light theme at all.

So daylight was derived by hand from the retired palette, and a visitor who toggles the theme sees
a different product. `03-DESIGN-SYSTEM.md` re-derives daylight from the prototype's own ink ramp.

## 9. The gate proves almost nothing

- CI on every commit runs a **secret scan** and a **contract digest guard**. That is all.
- The 173 web tests, the Move suite and typecheck run **on the developer's laptop, by hand**.
- Deployment is a manual act gated on a CI run that no longer contains the suites — recorded
  honestly in the comment at the top of `.github/workflows/deploy.yml`.
- There is **no visual regression test, no accessibility check, no performance budget, and no
  browser-level test of any kind** anywhere in the repository.

This is the mechanical reason each pass ends in "another beta". Nothing in the system can tell the
difference between a finished screen and an unfinished one, so the judgement falls to whoever is
looking that day. `07-GATES.md` replaces that judgement with a command.

## 10. What is already right, and must not be disturbed

Listed so no work package "fixes" it:

- `Reading<T>`: a failed chain read is never a value; pages print "not measured".
- Simulate → quote → sign, with abort codes translated before a person sees them.
- Integer money in the smallest unit, decimals read from coin metadata.
- Soulbound accounts, and the honesty about what that costs.
- Every signature single-use, reads included.
- Mirrored constants tested against the Move source.
- Migrations: numbered, checksummed, dry-run by default, refusing a file that changed after it ran.
- `app/add-funds/page.tsx`: the card on-ramp was removed deliberately and the page says why. The
  prototype's funding flow **must not** ship.
- The `/security` page's discipline: an unpublished address reads "not published", never a
  placeholder dressed as a live one.
