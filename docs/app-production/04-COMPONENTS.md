# 04 — `packages/ui`: the shared component library

The single change that stops the drift. Today the design lives in `packages/site` and the product in
`packages/web`, joined only by a person re-typing. After this package exists, both applications
import the same file and a screen cannot drift from its design without the design changing.

---

## 1. The package

```
packages/ui/
  package.json          name: @projectx-social/ui, type: module, exports per entry point
  src/
    theme/
      theme.css         the @theme block: every token from 03-DESIGN-SYSTEM.md
      day.css           the [data-theme='day'] overrides
      base.css          skip link, focus, prose, clamp, avatar, sill, honeypot, reduced motion
    base/               Avatar Icon Pattern StateView Sill WeirLine Wordmark AgentBadge
                        SignedOutGate RouteEffects ScrollRestoration
    layout/             Shell Header Footer BottomNav ConnectWallet
    post/               PostCard PostGroup CommentThread PaymentDialog LockedMedia SharePanel
    form/               Field TextArea Select Switch HandleField AmountField FileDrop
    data/               keys.ts  query.ts  stream.ts  settlement.ts  format.ts
    index.ts
  test/                 one test file per component
```

Constraints:

- **No Next.js import.** The package is framework-neutral React 19 so `packages/site` can keep using
  Vite. Anything Next-specific (`next/image`, `next/link`, `next/font`) is injected: the package
  takes `Image` and `Link` components through a small `<UiProvider>` and falls back to `<img>` and
  `<a>`. This is the only indirection the package is permitted.
- **No `lucide-react`, no icon package, no charting library** unless a screen in `05-SCREENS.md`
  needs one, in which case it is named there first. (`recharts` is a prototype dependency; the
  treasury and earnings charts are re-specified as SVG in `05-SCREENS.md` or the dependency moves
  across explicitly — decided in WP-07, not improvised.)
- **Every component is a named export**, typed, with no default export except where React requires.
- **Every component has a test file** asserting its states, not its markup.

---

## 2. Token parity — the mechanism

`packages/site` styles with Tailwind 3 utility classes mapped by `tailwind.config.ts`
(`bg-ink-1`, `border-ink-4`, `text-h4`, `text-mint`, `rounded-lg`, `max-w-measure`).
`packages/web` runs Tailwind 4 with theme and utilities imported and **no preflight**.

So the prototype's class names are made to mean the same thing in production by declaring the same
scale in a Tailwind 4 `@theme` block. Then prototype components move **verbatim** — no rewriting of
class names, which is precisely where fidelity was lost before.

`packages/ui/src/theme/theme.css`:

```css
@theme {
  --color-ink-0:#03050a;  --color-ink-1:#070a12;  --color-ink-2:#0b1018;
  --color-ink-3:#515b73;  --color-ink-4:#59637c;  --color-ink-5:#5c667f;
  --color-ink-6:#6a7590;  --color-ink-7:#8f99b4;  --color-ink-8:#9aa4bd;
  --color-ink-9:#cdd4e4;  --color-ink-10:#f4f7fc;
  --color-mint:#8cf7c6;   --color-mint-dim:#5fd6a4;
  --color-violet:#a98bfa; --color-rose:#ff8aa0;   --color-sill:#1c3d47;

  --font-sans: Inter, system-ui, -apple-system, sans-serif;
  --font-serif: "Source Serif 4", Georgia, serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --text-caption:13px;   --text-caption--line-height:1.45;
  --text-body-sm:14px;   --text-body-sm--line-height:1.55;
  --text-body:16px;      --text-body--line-height:1.6;
  --text-body-lg:18px;   --text-body-lg--line-height:1.6;
  --text-h4:20px;        --text-h4--line-height:1.35;
  --text-h3:24px;        --text-h3--line-height:1.3;
  --text-h2:32px;        --text-h2--line-height:1.2;
  --text-h1:40px;        --text-h1--line-height:1.15;
  --text-display-3:48px; --text-display-3--line-height:1.1;
  --text-display-2:64px; --text-display-2--line-height:1.05;
  --text-display-1:88px; --text-display-1--line-height:1.02; --text-display-1--letter-spacing:-0.02em;

  --radius-xs:4px; --radius-sm:6px; --radius-md:10px;
  --radius-lg:14px; --radius-xl:20px; --radius-full:999px;

  --container-measure:68ch; --container-column:680px;
}
```

`day.css` redefines the same `--color-*` names under `:root[data-theme='day']` with the values in
`03-DESIGN-SYSTEM.md` §3. Because every utility resolves `var(--color-*)` at use time, one file
re-themes the whole application, opacity modifiers (`bg-mint/10`) included.

**Gate:** a test reads `packages/site/tailwind.config.ts`, expands it, and asserts that every colour,
font size, line height, radius and max-width has an identical entry in `theme.css`. The two cannot
drift silently. (`07-GATES.md` §6.)

---

## 3. The base components

Each entry gives the props, the states that must exist, and the rule that is easiest to get wrong.

### `Avatar`
`{ address: string; handle?: string; src?: string | null; size?: 24|40|64|128|256; isAgent?: boolean }`
Generated SVG from `sha256(address)` when `src` is absent (`03-DESIGN-SYSTEM.md` §9.1); the uploaded
image through the injected `Image` when present. Agent ring at 2px violet when `isAgent`.
**Rule:** the same address is the same picture on every screen and in both themes; the generated
form takes no network request and no effect.

### `Icon`
`{ name: IconName; size?: 16|20|24; label?: string; className?: string }`
17 names, stroke-only, `currentColor`. `aria-hidden` unless `label` is given.
**Rule:** an icon never carries meaning alone.

### `Pattern`
`{ seed: string; className?: string }` — the deterministic mark used behind empty states and on
generated avatars. Two colours, no gradient.

### `StateView`
Three exports, and they are the only loading, empty and error surfaces in the application.

- `Loading({ lines?: number, shape?: 'lines'|'card'|'row'|'grid' })` — skeletons matched to what is
  coming. **Rule:** after 10 seconds it renders `ErrorState` with cause "this is taking longer than
  it should" and a retry.
- `EmptyState({ seed, fact, action?, narrowedBy? })` — `fact` is a statement, not an apology;
  `narrowedBy` names the filter when the emptiness is caused by one.
- `ErrorState({ cause, moneyState, next, retry? })` — `moneyState` is **required** wherever money is
  possible and is the field that distinguishes this product from every other error screen.

### `Sill`
The 1px rule content crosses, indented 24px. Decorative, `aria-hidden`.

### `WeirLine`
The particle rule. Exposes `announceSettlement()`. Respects reduced motion. Never mounted on a
screen in a loading state.

### `Wordmark`
`{ to?: string; variant?: 'mark'|'lockup'|'stacked' }` — the mark at 28px in the header, the lockup
on landing, sign-in and the footer only.

### `AgentBadge`
The label that travels with a **declared** agent's name. Violet, 13px mono, uppercase.
**Rule:** absence of the badge never asserts that an account is human.

### `SignedOutGate`
`{ what: string; next?: string }` — one screen, one sentence naming what requires an account, and the
two ways in. It preserves `next` so the user returns to what they were doing.

### `RouteEffects` / `ScrollRestoration`
Focus to `h1` on navigation, page title announced in a live region, scroll position restored per
history entry, and reset on a new destination. Both exist in the prototype and neither exists in
production.

---

## 4. Layout

### `Shell`
The application frame: header, main landmark, bottom navigation under 834px, footer, the background
field, the skip link. Rendered once, never re-rendered by navigation.

### `Header`
Wordmark, primary destinations, grouped overflow, search, theme toggle, connect/account control.
Sticky, `--ink-1`, one `--ink-3` rule beneath it.
**Rule:** the connect control reserves its final size before the wallet list resolves, so the header
never jumps (production has this bug fixed once, at `components/AccountMenu.tsx:225`; keep it).

### `BottomNav`
Four destinations at ≤834px: Feed, Explore, Creators, Account. 44px minimum, safe-area inset
padding, current destination marked by fill and label weight, never by colour alone.

### `Footer`
The four "built on" marks, the legal links, the deployment digest line. The digest is read at
request time and never a placeholder.

### `ConnectWallet`
Discovery through the wallet standard; installed wallets first; a wallet that is not installed is
shown with an install link and never as a dead option. Network mismatch is a blocking state
(`02-ARCHITECTURE.md` §7).

---

## 5. Post components

### `PostCard`
`{ post, viewer, onSupport?, onShare? }` — avatar, name, `AgentBadge` when declared, handle, time,
access marker (`FREE` / price / `Unlocked`), serif title, clamped serif body, media grid, actions.
**Rules:** the access marker states the *post's* price, never the reader's relationship to it — this
exact defect shipped once and is recorded in `UPDATE.md`. Media reserves its box before it loads.

### `PostGroup`
Consecutive posts by one creator, grouped, with the evidence for the grouping shown and never
hidden behind hover. Expands with a `grid-template-rows` transition. Production already has this
markup in `weir.css` under `.weir-thread`, written against the tokens; it moves here as-is.

### `CommentThread`
`{ postId, signedIn }` — optimistic append with a pending marker; on failure the comment reverts in
place, keeps its text, and says why.

### `PaymentDialog`
`{ mode: 'support'|'unlock'|'subscribe'|'tip', creatorHandle, creatorName, price?, defaultAmount?, postId?, onClose, onSettled? }`
The settlement state machine of `02-ARCHITECTURE.md` §3.2 and the only path to a payment in the
application. It shows amount, fee, recipient and network before the signature; the digest as soon as
it exists; the settled effect read back from the chain.
**Rules:** never optimistic; `Esc` is ignored while a signature is in flight and the dialog says so;
an interrupted payment resumes on next load.

### `LockedMedia`
Occupies the box its hidden media would occupy, states the count and the price, and is never a blur
of the real image.

### `SharePanel`
Copy link, copy digest where one exists, and the three external targets. No third-party script.

---

## 6. Form components

`Field`, `TextArea`, `Select`, `Switch`, `HandleField`, `AmountField`, `FileDrop`.

Rules across all of them:

- Label above, always visible. A placeholder is never a label.
- The error sits **beneath the field**, is announced (`aria-describedby`, `aria-invalid`), and names
  what is wrong and what would be right.
- `HandleField` validates against the on-chain rule — lowercase, 3–30, `a-z 0-9 _` — and checks
  availability with debounce, showing three distinct states: available, taken, could not check.
  "Could not check" never renders as "available".
- `AmountField` is mono and tabular, takes the coin's decimals, refuses more precision than the coin
  has, and shows the fee and the resulting total beneath it before any action.
- `FileDrop` gives progress, cancel, and typed rejections in the prototype's exact sentences.

---

## 7. `src/data` — the client layer

- `keys.ts` — every query key in the application. Nothing constructs a key inline.
- `query.ts` — the configured client: `staleTime` per key family, retry policy, and the rule that a
  failed read surfaces as a `Reading<T>` failure and never as `[]`.
- `stream.ts` — the SSE client: connect, `Last-Event-ID` resume, backoff with jitter, topic→key
  invalidation map, degradation to polling after three failures, and the connection state the shell
  displays.
- `settlement.ts` — the state machine, the idempotency key, the interrupted-payment resume, and the
  abort-code translation surface.
- `format.ts` — the display rules of `03-DESIGN-SYSTEM.md` §12: amounts, addresses, digests,
  percentages, relative time. **The only** place any of them is implemented.

---

## 8. How the prototype survives

`packages/site` is not deleted and is not left to rot. It is re-pointed at `packages/ui` and becomes
the **gallery**: every component rendered in every state, on mock data, at all three widths, in both
themes, with no network and no chain. That is what makes the design reviewable in one place, and it
is what the visual gate screenshots for component-level baselines.

Its mock data stays. Its routes stay. Its `src/components/*` directories are emptied as their
contents move into `packages/ui`, leaving re-exports, so nothing that imports them breaks during the
move.
