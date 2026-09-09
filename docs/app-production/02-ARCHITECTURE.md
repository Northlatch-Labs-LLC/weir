# 02 — The application architecture

Weir is an application, not a website. The distinction is not a matter of taste and it is not
decoration: a website answers one request at a time and forgets you; an application holds state,
keeps it fresh, tells you what changed, survives a bad network, and never loses what you typed.

Today Weir is built as the first thing (`01-STATE.md` §4). This file specifies the second. Every
decision below is binding; alternatives that were considered and rejected are named so they are not
re-proposed.

The vocabulary, since it was asked for: what follows is an **app-shell architecture** with a
**client data layer** (cache, keys, invalidation), **optimistic mutations** for non-financial
writes, a **settlement state machine** for financial ones, a **realtime transport** with reconnect
and backfill, an **offline shell** via a service worker, and **machine-checked release gates**.
"Production-grade" means each of those exists, is instrumented, and fails loudly.

---

## 1. Rendering: what is server, what is client

**Rule.** The server renders what is true for everyone. The client owns what is true for you, and
what changes while you watch.

Today `dynamic = 'force-dynamic'` sits on the **root layout**, which forces all 105 route files to
render per request, including the 404. That was a correct fix for a real bug — `AppShell` reads the
proved session and the site mode, and a prerender has no request — but it made the whole product
uncacheable to fix a shell.

**Target.**

| Layer | Rendering | Cache |
|---|---|---|
| The shell (header, nav, footer, theme, session) | Client component, hydrated once, never re-rendered by navigation | — |
| Public read surfaces: `/`, `/explore`, `/creators`, `/c/:handle`, `/p/:id`, `/agents`, `/security`, `/legal/*` | Server components, cached | `revalidate` 30s, tag-invalidated on write |
| Anything reading a proved session: `/feed` (Following), `/vault`, `/purchases`, `/earnings`, `/messages`, `/alerts`, `/studio`, `/settings`, `/creator`, agent-market screens | Server shell + client data layer | per-user, never shared |
| Everything under `/api` | unchanged | unchanged |

Three consequences that must be honoured:

1. `AppShell` moves the session read out of the layout into a client boundary fed by
   `/api/session`, so a cached page can still carry a signed-in shell.
2. `force-dynamic` is removed from the root layout and applied **per route**, only where a proved
   session determines the HTML. A lint rule (`07-GATES.md`) blocks new ones.
3. Route-level `generateMetadata` stays dynamic where the title names a handle, and only there.

**Rejected:** making everything static and hydrating everything client-side. A creator's page must
be readable and correct without JavaScript, and it is the page search engines and agent crawlers
land on.

---

## 2. The client data layer

**Decision: TanStack Query v5.** The repository's instinct is to add no dependency that has not
earned its place, and this one has: cache keys, deduplication, invalidation, retry with backoff,
paused-while-offline and stale-while-revalidate are the exact set of behaviours being hand-rolled
badly today (a `router.refresh()` in one file and nothing anywhere else). Writing it by hand is a
second project.

**Rejected:** SWR (weaker mutation and invalidation story for a write-heavy product); a bespoke
store (the work is invalidation, not storage); server actions alone (they do not solve two
components disagreeing about the same figure).

### Rules

- **One key per API route, derived from the path.** `['posts', { handle }]`, `['vault', id]`,
  `['messages', 'threads']`. A file `packages/ui/src/data/keys.ts` is the only place keys are
  written; nothing constructs one inline.
- **Every mutation declares what it invalidates.** A mutation without an `invalidates` array fails
  review. The list is exhaustive, not "the obvious one".
- **A failed read is a `Reading<T>` failure, not an empty array.** The query layer must not coerce
  an error into `[]`. `ErrorState` renders; the list does not render empty. This is the existing
  codebase's rule and the data layer is where it is most easily lost.
- **`staleTime` is set per key deliberately.** Chain reads: 15s. Feed: 30s with realtime
  invalidation. Prices and manifest facts: 5 minutes. Nothing is `Infinity`.
- **Retries: 2, exponential, only on network and 5xx.** Never on 4xx. Never on a signature request.
- **Server-rendered data hydrates the cache** rather than being refetched on mount, so the first
  paint and the first client read agree.

---

## 3. Writes: two kinds, and never confused

This is the most important boundary in the application.

### 3.1 Optimistic writes — social actions only

Permitted for, and only for: follow / unfollow, comment (rendered pending, with the author's own
avatar and a muted state until acknowledged), notification read-marks, message read-marks, draft
autosave, theme and filter preferences.

Contract: apply locally, send, and on failure **revert and say so in place** — never a toast that
disappears, never a silent revert. The reverted item keeps the text the user wrote.

### 3.2 Settlement writes — money, keys and on-chain state

Never optimistic. Never a spinner with no stages. Every payment, subscription, tip, unlock,
withdrawal, vault action, name purchase, account creation and agent declaration runs one state
machine, and the user sees which state they are in:

```
idle → preparing → simulating → awaiting-signature → submitted → confirming → settled
                                      ↓                    ↓            ↓
                                  rejected              failed      failed
```

- `preparing` — building the transaction. Shows what will be paid, to whom, and the 2.9% fee.
- `simulating` — the existing simulate → quote step. A failure here shows the **translated abort
  code**, never a hex.
- `awaiting-signature` — the wallet or zkLogin prompt is open. The screen says what is being signed
  and what it authorises, in one sentence.
- `submitted` / `confirming` — the digest exists. It is shown, copyable, with an explorer link,
  **before** confirmation, because a user whose tab dies here needs it.
- `settled` — the effect is read back from the chain, not assumed from a 200.
- `rejected` — the user declined. Nothing was spent. Say exactly that.
- `failed` — say what failed, **what state the money is in**, and what to do next.

The prototype already models this (`packages/site/src/components/post/PaymentDialog.tsx`,
`preparing / submitted / confirming / settled / rejected / failed`). That component moves into
`packages/ui` and becomes the only path to a payment in the application.

**Idempotency.** Every settlement write sends an `Idempotency-Key` (the mechanism already exists at
`packages/web/lib/idempotent-route.ts`). A retried submit must never double-charge.

**Interruption.** If the tab closes between `submitted` and `settled`, the pending digest is
recorded in `localStorage` under the account address and resumed on next load: the application
reads the chain and shows the outcome. A payment must never disappear because a browser did.

---

## 4. Realtime

Nothing on any screen updates today without a reload. For a social product that is the defect, not
a refinement.

**Decision: Server-Sent Events on one multiplexed endpoint,** `GET /api/stream`.

**Rejected:** WebSockets (a second protocol, a second auth path, and a stateful connection that
Vercel's function model does not suit); polling everything (cost, and it still misses the fast
cases); a third-party realtime service (a second identity system and another place a leak can
happen).

### Contract

- One connection per tab. Topics are derived from the **proved** session server-side; a client
  cannot subscribe to a topic it has not proved a right to. Guest connections receive public topics
  only.
- Events carry a monotonic id. On reconnect the client sends `Last-Event-ID` and the server
  **backfills** what was missed, bounded to 200 events or 5 minutes, whichever is smaller; beyond
  that it sends `resync` and the client invalidates the affected query keys instead.
- Server side is Postgres `LISTEN`/`NOTIFY`, published from the same transaction that writes the
  row. A notification that can be sent for a write that then rolls back is a bug.
- **The stream never carries content, only invalidation.** An event says "post 8f2 in creator ada
  changed"; the client invalidates the key and refetches through the normal authorised path. This
  means the stream cannot leak a paid body, cannot leak a sealed key, and cannot drift from what
  the API would have returned.
- Vercel caps function duration, so a stream is capped at **55 seconds** and the client reconnects
  with `Last-Event-ID`. Reconnect backoff: 1s, 2s, 5s, 15s, 30s, then 30s steady, with jitter.
- **Degradation is explicit.** After three failed reconnects the client falls back to polling the
  affected keys at 60s and the shell shows a quiet "reconnecting" marker. It never silently stops.

### Topics

| Topic | Delivered to | Invalidates |
|---|---|---|
| `feed:everything`, `feed:people`, `feed:agents` | everyone | feed keys |
| `feed:following:<address>` | that reader | that reader's Following feed |
| `creator:<handle>` | everyone on that page | creator posts, profile, vault figures |
| `post:<id>` | everyone on that post | comments, unlock state |
| `messages:<address>` | that address | threads, unread count |
| `alerts:<address>` | that address | notifications, badge count |
| `settlement:<digest>` | the payer | that payment's state machine |
| `vault:<id>` | anyone watching it | principal, yield, ladder rungs |
| `site:mode` | everyone | the waiting-list gate |

`settlement:<digest>` is what turns the payment dialog from a poll into a confirmation.

---

## 5. Offline and installability

The manifest already claims `display: standalone`. Nothing supports the claim.

- **Service worker** at `/sw.js`, registered after first paint, precaching the app shell, the brand
  assets and the three font families. Navigation requests: network-first with a 3-second timeout,
  falling back to the cached shell and an offline screen that names what is unavailable.
- **GET API responses**: stale-while-revalidate, 60 seconds, for public reads only. Nothing behind a
  proved session is cached on disk. Nothing sealed is cached at all.
- **The write queue refuses money.** A queued payment is a lie: prices move, quotes expire, and a
  transaction signed against stale state aborts. Queued while offline: drafts, read-marks,
  preferences. Refused while offline, with a clear message: every settlement write.
- **Manifest corrected** to `#03050a` for both `theme_color` and `background_color`, matching
  `app/layout.tsx`, plus `id`, `scope`, `orientation: any`, and shortcuts to `/feed`, `/studio`,
  `/messages`.
- **Update flow.** A new service worker prompts, in the shell, once: "A new version is ready."
  It never reloads a page mid-composition.

---

## 6. Media

- All raster images through `next/image` with explicit `width`/`height` or a fixed aspect-ratio
  box. The feed must never reflow as images arrive (CLS budget in `07-GATES.md`).
- Walrus blobs are served through an application route that negotiates format and size. Sealed
  media keeps its existing path unchanged; the decrypt step is not touched by this work.
- Every asset row stores its intrinsic dimensions and a **blur placeholder hash** at upload time, so
  a locked or loading image reserves the right shape. This needs one additive migration.
- Upload: progress, cancel, resumable beyond 8MB, typed rejections in the prototype's words —
  "Rejected: the file is 180×180, below the 256×256 minimum", not "Upload failed".
- Aspect ratios are fixed by the design (`03-DESIGN-SYSTEM.md` §8), never by the image.

---

## 7. Session, wallet and the chain

- **Session expiry must not cost work.** Any composed post, comment, message or form is written to
  `sessionStorage` before a signature is requested. On re-authentication the user returns to the
  exact action with their text intact.
- **Wallet standard, many wallets.** The existing multi-wallet discovery stays. A wallet that is not
  installed is never rendered as an option that does nothing (a defect this codebase has already had
  twice — `components/SignIn.tsx:217`, `components/SignerProvider.tsx:241`).
- **Network mismatch is a blocking state, not a warning.** A wallet on testnet gets one screen: what
  network it is on, what network is required, and how to change it. No transaction may be built.
- **Address display is one rule everywhere**: `0xda78…715d`, mono, tabular, copy on click, with a
  confirmation that does not move the layout. Never truncated differently on two screens.
- **Gas and fee are always stated before a signature**, in SUI and in the fiat-free terms the
  product already uses. The 2.9% is named at settlement, as the copy already promises.
- **Chain slowness is a state.** Beyond 8 seconds in `confirming`, the screen says the chain is slow,
  shows the digest, and offers to keep watching in the background. It does not spin forever.

---

## 8. The agent side of the same door

Weir's premise is that a program uses the same routes as a person. Three obligations follow, and
they are checked in `07-GATES.md`:

1. **No screen may depend on an endpoint an agent cannot call.** If a new endpoint is added for a
   screen, it takes the same auth (signed statement), the same rate limits and the same error shape
   as the rest.
2. **New endpoints are declared in the same change**: `/llms.txt`, `/.well-known/weir-agent.json`,
   and the MCP tool list where the capability is one an agent would use.
3. **The realtime stream is available to agents too**, with the same topic authorisation. An agent
   watching `settlement:<digest>` is the same code path as a browser watching it.

---

## 9. Errors, everywhere, in one shape

Every failure a user can see renders through one component with four fields — the prototype's
`ErrorState({ cause, moneyState, next, retry })`:

- **cause** — what happened, in a sentence, in the product's own words. Never a status code alone.
- **moneyState** — what state their money is in. "Nothing was spent." / "0.4 SUI is committed and
  the transaction is confirming." / "The payment settled; the page could not be re-read." This field
  is mandatory on any screen where money is possible, and empty on screens where it is not.
- **next** — the one action that helps. Retry, reconnect a wallet, wait, or contact.
- **retry** — present only when retrying can actually succeed.

A screen with a bare "Something went wrong" fails review.

---

## 10. Performance budget

Per route, measured on the gate (`07-GATES.md` §5), emulated mobile, cold cache:

| Metric | Budget |
|---|---|
| LCP | ≤ 2.0s |
| INP | ≤ 200ms |
| CLS | ≤ 0.05 |
| First-load JS, per route | ≤ 180 KB gzipped |
| Font families | **3** (Inter, Source Serif 4, JetBrains Mono). Geist and Geist Mono are removed with `globals.css` |
| Blocking requests before first paint | 0 third-party |

---

## 11. What is deliberately not in this architecture

Named so they are not proposed again mid-build: no native mobile app; no push notifications beyond
the existing email path; no recommendation or ranking system; no analytics vendor beyond what
`08-LAUNCH.md` requires for errors and uptime; no new token, no new contract, no new on-chain
capability; no card on-ramp (removed deliberately, see `app/add-funds/page.tsx`); no server-side
rendering of sealed content.
