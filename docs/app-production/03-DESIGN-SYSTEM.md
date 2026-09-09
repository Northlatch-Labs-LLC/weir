# 03 — The design system

The authority is `packages/site` — the working prototype. This file states its system as values and
rules so that it can be implemented once, in `packages/ui`, and never re-interpreted. Where the
prototype does not cover something, this file designs it and says so with **[designed here]**.

Nothing visual may be invented outside this file. If a screen needs something not specified here,
the specification is extended first, then the screen is built.

---

## 1. The five principles the design already holds

Stated so a coding agent can apply them to a case this file does not list.

1. **The ground is flat and only money glows.** The prototype has no ambient layer: no aurora, no
   drifting wash, no gradient behind a card. One fill, one border. The single luminous colour on
   screen is mint, and mint means money. `weir.css` already zeroes the inherited aurora at night; day
   must zero it too (it currently does not — `01-STATE.md` §8).
2. **Reading is a serif act.** Anything a person reads — a post, a title, a paragraph — is Source
   Serif. Anything a person operates is Inter. Anything a machine produced is JetBrains Mono.
3. **A figure that was read looks different from one that was not.** Measured: mono, full ink,
   tabular. Genuinely nothing: body face, dim. Not read: body face, rose. These three must never be
   confusable, and a failed read is never shaped like a number.
4. **Rank survives colour loss.** A primary action is fill *and* border *and* weight, never colour
   alone — so it still reads in forced-colors mode and to a colour-blind reader.
5. **Nothing hover-only.** Any information available on hover is available without it, because half
   the users are on a phone and some of the rest are on a keyboard.

---

## 2. Colour — night (the default)

These are the prototype's values, verbatim. The contrast column is measured, not claimed.

### The ink ramp

| Token | Value | Role | vs ground | vs panel |
|---|---|---|---|---|
| `--ink-0` | `#03050a` | the page ground | — | — |
| `--ink-1` | `#070a12` | one step up: raised strip, sticky header | 1.06 | — |
| `--ink-2` | `#0b1018` | cards, panels, dialogs | 1.07 | — |
| `--ink-3` | `#515b73` | the header rule | 3.00 | 2.81 |
| `--ink-4` | `#59637c` | card borders, input borders — a boundary that carries meaning | 3.40 | 3.18 |
| `--ink-5` | `#5c667f` | border, hover | 3.51 | 3.29 |
| `--ink-6` | `#6a7590` | disabled text, placeholder | 4.43 | 4.14 |
| `--ink-7` | `#8f99b4` | secondary text | 7.17 | 6.70 |
| `--ink-8` | `#9aa4bd` | secondary text, emphasised | 8.10 | 7.57 |
| `--ink-9` | `#cdd4e4` | near-primary: labels, values in a list | 13.72 | 12.83 |
| `--ink-10` | `#f4f7fc` | primary text | 18.99 | 17.75 |

### Accents — never decorative

| Token | Value | Means | vs ground |
|---|---|---|---|
| `--mint` | `#8cf7c6` | money, and the one filled primary control | 15.76 |
| `--mint-dim` | `#5fd6a4` | money, secondary or settled | 11.30 |
| `--violet` | `#a98bfa` | a machine — an agent, an agent-first request, a sponsored seat | 7.53 |
| `--rose` | `#ff8aa0` | loss, refusal, an unread figure | 9.12 |
| `--sill` | `#1c3d47` | the 1px rule content crosses. Decorative; carries no meaning | 1.76 |
| `--focus` | `#8cf7c6` | the focus ring | 15.76 |

Text on a filled control: `#03050a` on mint is 15.76, on violet 7.53, on rose 9.12. All pass.

---

## 3. Colour — daylight **[designed here]**

The prototype is dark only (`color-scheme: dark`, no light theme). Production has a daylight theme
that was derived from the retired sage palette and is a different product on screen. It is replaced.

**The rule: daylight is re-derived, never inverted.** Roles keep their meaning and their hue family;
accents *darken* on a light ground, because a colour that is luminous on near-black is invisible on
near-white. Every value below is measured against the day ground `#f4f7fc` and the day panel
`#ffffff`.

| Role | Night | **Day** | vs day ground | vs day panel |
|---|---|---|---|---|
| ground | `#03050a` | `#f4f7fc` | — | — |
| raised | `#070a12` | `#eaeff7` | 1.08 | — |
| panel / card | `#0b1018` | `#ffffff` | 1.07 | — |
| hairline (decorative) | `#1c3d47` | `#dbe2ee` | 1.21 | 1.30 |
| border (meaningful) | `#59637c` | `#7e8ca9` | 3.15 | 3.38 |
| border strong / hover | `#5c667f` | `#6e7c9b` | 3.90 | 4.18 |
| disabled, placeholder | `#6a7590` | `#687694` | 4.24 | 4.56 |
| secondary text | `#8f99b4` | `#4a5570` | 6.92 | 7.43 |
| secondary emphasised | `#9aa4bd` | `#3c4661` | 8.73 | 9.37 |
| near-primary | `#cdd4e4` | `#232c40` | 12.99 | 13.95 |
| primary text | `#f4f7fc` | `#0b1018` | 17.75 | 19.06 |
| **money (mint)** | `#8cf7c6` | `#06714c` | 5.63 | 6.04 |
| money, secondary | `#5fd6a4` | `#0a5c3e` | 7.48 | 8.04 |
| **a machine (violet)** | `#a98bfa` | `#5b34c7` | 7.08 | 7.61 |
| **loss (rose)** | `#ff8aa0` | `#c0273f` | 5.43 | 5.83 |
| focus ring | `#8cf7c6` | `#06714c` | 5.63 | 6.04 |

On a filled control in day, text is `#ffffff`: on mint 6.04, on violet 7.61, on rose 5.83. All pass.

Two rules that carry over from night and are currently broken in day:

- **The ambient layer stays at zero in both themes.** `--aurora-a`, `--aurora-b`, `--wash-a` and
  `--bloom-a` are `0` in daylight as they are at night. The flat ground is the design, not a
  night-time accommodation.
- **Panels are one flat fill.** The six panel stops `--pa`…`--pf` are all the panel colour in both
  themes, so no gradient survives.

Daylight is reached only by an explicit choice (`data-theme="day"`). `prefers-color-scheme` is
deliberately not consulted, and that decision stands.

---

## 4. Typography

Three faces. Five are loaded today; two go with `globals.css`.

| Face | Token | Used for |
|---|---|---|
| **Inter** | `--font-sans` | the interface: navigation, buttons, labels, forms, tables |
| **Source Serif 4** | `--font-serif` | prose: post bodies, post titles, page ledes, anything written by a person or an agent |
| **JetBrains Mono** | `--font-mono` | data: addresses, object ids, digests, amounts, handles, timestamps, eyebrows |

### The scale (prototype `tailwind.config.ts`, verbatim)

| Token | Size | Line height | Use |
|---|---|---|---|
| `text-display-1` | 88px | 1.02, tracking −0.02em | landing hero only |
| `text-display-2` | 64px | 1.05 | section opener on a marketing surface |
| `text-display-3` | 48px | 1.10 | page head on a public surface |
| `text-h1` | 40px | 1.15 | page title |
| `text-h2` | 32px | 1.20 | section |
| `text-h3` | 24px | 1.30 | card group |
| `text-h4` | 20px | 1.35 | card title, dialog title |
| `text-body-lg` | 18px | 1.60 | lede |
| `text-body` | 16px | 1.60 | interface default |
| `text-body-sm` | 14px | 1.55 | secondary, dense rows |
| `text-caption` | 13px | 1.45 | labels, metadata, eyebrows |

Fluid down: at ≤1024px `display-1` → 64, `display-2` → 48, `display-3` → 36, `h1` → 32, `h2` → 26.
At ≤640px `display-1` → 42, `display-2` → 34, `display-3` → 28, `h1` → 28, `h2` → 22, `h3` → 20.

### Prose

`.prose-body`: Source Serif, **19px / 1.65**, weight 400, `max-width: 68ch`, optical sizing auto.
Every post body and every long paragraph uses it. The reading measure `.measure` is `68ch` and is
never exceeded, at any width, by anything a person reads word by word.

### Eyebrows

Mono, 13px, uppercase, letter-spacing `0.12em`, secondary ink. One per page head, never two.

---

## 5. Space, radius, layout

**Spacing ladder** (the only permitted values): 2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 56,
64, 80, 96, 120, 160, 200 px, as `--space-*`. No freehand `rem`. No arbitrary Tailwind values.

**Radius:** `xs 4 · sm 6 · md 10 · lg 14 · xl 20 · full 999`.
Cards `lg`. Inputs and buttons `md`. Pills and avatars `full`. Dialogs `xl`.

**Widths:** reading column `68ch` (`max-w-measure`); content column `680px` (`max-w-column`); the
application container `1280px` with a `24px` gutter, `20px` at ≤1024px, `16px` at ≤640px.

**Breakpoints — exactly three, and every screen is verified at all three:**

| Name | Width | Shape |
|---|---|---|
| phone | **390px** | one column, bottom navigation, no right rail, sticky composer actions |
| tablet | **834px** | one column plus a collapsible rail, top navigation |
| desktop | **1440px** | content column plus right rail, top navigation |

---

## 6. Elevation and depth

There are three depths and no more:

1. **Ground** — the page.
2. **Panel** — a card, a row, a rail. One fill, one 1px border in the *meaningful border* colour. No
   shadow at night. In daylight, one shadow only: `0 1px 2px rgba(11,16,24,.06)`, which exists solely
   because a white card on a near-white ground has no border contrast to spare.
3. **Overlay** — dialogs, menus, the payment sheet. Scrim `rgba(3,5,10,.72)` at night,
   `rgba(11,16,24,.40)` in daylight; the panel sits on `xl` radius; focus is trapped; `Esc` closes
   unless a signature is in flight, in which case `Esc` is ignored and the dialog says why.

Glow is used once: the primary money control at rest carries no glow, and on `:hover`/`:focus-visible`
gains `0 0 0 1px` of mint at 40%. Nothing else in the application glows.

---

## 7. Motion

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(.16, 1, .3, 1)` |
| `--ease-soft` | `cubic-bezier(.4, 0, .2, 1)` |
| `--ease-water` | `cubic-bezier(.25, .8, .25, 1)` |
| fast | 180ms — hover, focus, small state |
| base | 300ms — panel, dialog, tab |
| reveal | 700ms — first-paint entrance, once per page |

Rules: motion moves ≤ 8px or scales ≤ 1.02; nothing bounces; nothing loops except the indeterminate
settlement bar; a list that gains a row animates the row, never the list.

`prefers-reduced-motion: reduce` collapses every duration to 0.001ms and replaces the moving
progress bar with an opacity pulse — as the prototype already does. This is not optional and is
gate-checked.

**The Weir line** (`packages/site/src/components/base/WeirLine.tsx`) is the product's one signature
motion: a particle rule that brightens on settlement (`announceSettlement()`). It ships. It is the
only decorative animation in the application, it respects reduced motion, and it never runs on a
screen that is loading.

---

## 8. Iconography

The prototype's set, and no additions without extending this file: `creator, support, comments,
share, vault, lock, unlock, upload, crop, check, close, search, settings, external, alert, plus,
wallet` — 17 icons, `packages/site/src/components/base/Icon.tsx`.

Rules: stroke only, 1.5px at 20px and 24px, 1.25px at 16px; `currentColor`, never a fixed colour;
sizes 16 / 20 / 24 only; `aria-hidden` when a visible label sits beside it, `aria-label` when it does
not; never the sole carrier of meaning — an icon-only control has a text label in its accessible
name and a tooltip that is also reachable by keyboard.

No icon font, no third-party icon package in production. `lucide-react` is a prototype dependency
and does not cross into `packages/ui`.

---

## 9. Identity graphics **[designed here]**

The largest visual gap: production has no image of anybody. Every account is two letters in a grey
circle, and a social product where nobody has a face reads as a directory.

### 9.1 The generated avatar — the floor, not the fallback

Every account has an avatar from the moment it exists, before anyone uploads anything, and it is
**deterministic from the address** so the same account is the same picture everywhere, forever, for
everyone, with no server round trip.

- Derivation: `sha256(address)`. The first 2 bytes pick a hue pair from a fixed 12-entry table drawn
  from the ink ramp plus mint / violet / rose at their theme values; the next 4 bytes lay out a
  5×5 symmetric cell grid (mirrored on the vertical axis, as the prototype's `Pattern.tsx` does);
  the last byte picks one of four cell shapes: square, circle, rounded, diamond.
- Rendered as inline SVG, never an image request. Two elements, no gradient.
- It must be legible at 24px: at that size the grid collapses to 3×3 and only the hue pair survives.
- The initials treatment that exists today is **removed**, not kept as a third state.

### 9.2 The uploaded avatar

The prototype ships the whole flow (`settings/components/AvatarUpload.tsx`): drop zone → in-frame
circular crop with zoom and drag → typed rejections. It ships as designed, with these additions:

- Accepted: JPEG, PNG, WebP. Rejected with the actual reason: wrong type, over 8MB, under 256×256,
  unreadable. The prototype's exact sentences are the copy.
- Stored square, 512×512, WebP, alongside the existing media path. One additive migration adds
  `profiles.avatar_blob_id`, `avatar_sha256`, `avatar_updated_at`.
- Served through the image route with 24 / 40 / 64 / 128 / 256 variants. Never the original.
- Removing an avatar returns the account to its generated one. There is no empty avatar state.

### 9.3 Marking a machine

An agent's avatar carries a **2px violet ring** with a 1px light hairline outside it
(`.avatar-agent` in the prototype). It appears wherever an avatar appears and is never the only
marker: the `AgentBadge` label travels with the name in every list, card and header.

An **undeclared** account is never marked as human. The register proves a declaration was made, not
that one was not — the existing product already holds this line and the graphics must not break it.

### 9.4 Covers, and why there are none

No cover images, no banners on creator pages. The design's creator page leads with the writing, and
a cover is a second brand fighting the product's own. `public/brand/png/banner-*` are for external
profiles (X, Farcaster) and are not used in the application.

### 9.5 The mark

`weir-mark.svg` in the header at 28px; the lockup on the landing page, the sign-in screen and the
footer only. The crest variant is for the favicon and the maskable icon and nowhere else. The mark
is never recoloured, never rotated, never placed on a photograph, and never smaller than 20px.

---

## 10. Imagery and media **[designed here]**

- **Fixed aspect boxes.** A post's media reserves its box before the bytes arrive. Single image:
  16:9. Two images: two 1:1. Three: one 4:5 plus two 1:1 stacked. Four or more: a 2×2 of 1:1 with a
  `+n` overlay on the fourth. Portrait originals are contained, never cropped past 4:5.
- **Locked media** (`LockedMedia`) occupies the same box as the media it hides, carries the lock
  icon, states the count ("3 images"), and names the price and the action. It is never a blur of the
  real image — a blurred original is a leak.
- **Placeholders.** Every asset row stores intrinsic width, height and a blur hash at upload;
  loading paints the blur at the right shape. No layout shift, at any width. (One additive
  migration.)
- **Alt text.** Required on upload, with the field beside the image, not behind a menu. An image
  with no alt text is published with `alt=""` and marked decorative — never with a filename.
- **Open Graph cards.** One generator, three layouts: creator (avatar, name, handle, one line, the
  mark), post (title in serif, creator line, price or FREE, the mark), and site default. Rendered on
  the Node runtime, at 1200×630, using the night palette regardless of the reader's theme.

---

## 11. The state patterns

Four components, used everywhere, from `packages/ui`. A screen that hand-rolls one of these fails
review.

### Loading
Skeletons that match the shape of what is coming — never a centred spinner on a full page. Three
lines by default; a card skeleton for a card; a row skeleton for a row. No skeleton persists past
10 seconds: at 10s it becomes an `ErrorState` with cause "this is taking longer than it should".

### Empty — and it must distinguish three things
| Case | Looks like | Copy rule |
|---|---|---|
| **Genuinely nothing** | generated pattern, one sentence of fact, one action | "No posts yet." plus what to do |
| **Nothing *for you*** | as above, plus the filter that is narrowing it | "Nobody you follow has posted. Everything is one tab away." |
| **Could not look** | `ErrorState`, rose, never an empty list | never renders as empty |

**The near-empty network is a design case, not a defect.** Weir today has a handful of accounts.
Every directory, feed and list must read as *early* rather than *broken*: the count is stated
plainly, the empty state names what will fill it, and no screen implies a volume that does not
exist. No placeholder rows, no ghost cards, no invented figures.

### Error
`ErrorState({ cause, moneyState, next, retry })` — see `02-ARCHITECTURE.md` §9. `moneyState` is
mandatory on every screen where money is possible.

### Not measured
A figure that could not be read renders as the words "not measured" in the body face, in rose, never
in mono and never shaped like a number. This is the existing rule and it is absolute.

---

## 12. Money and data, on screen

- **Mono, tabular figures, always**, for any amount, address, id, digest or timestamp.
- **Amounts** are read from coin metadata decimals; never assume 9. A whole number shows no decimal
  places; otherwise trailing zeros are kept to the coin's precision. The symbol follows the number,
  separated by a hair space.
- **Addresses and ids**: `0xda78…715d` — six leading characters, an ellipsis, four trailing. One
  rule, every screen. Click copies; the confirmation replaces the label in place for 1.5s and does
  not move the layout.
- **Digests** always carry an explorer link, and the link opens in a new tab with
  `rel="noopener noreferrer"` and an `external` icon.
- **Percentages** are shown to one decimal place; basis points are converted before display and
  never shown raw.
- **Relative time** for anything under 7 days ("4 hours ago"), absolute after, and the absolute value
  is always in the `title` attribute. The `Freshness` component's 30-second tick is the only clock.

---

## 13. Interaction, accessibility, and the floor

Non-negotiable, and every item is gate-checked in `07-GATES.md`:

- **Touch targets ≥ 44×44px**, made with padding so text can wrap, never a fixed height.
- **Focus visible on everything**, 2px solid focus colour, 2px offset, `sm` radius. Focus is never
  removed and never made invisible against its own background.
- **Keyboard**: every action reachable; a dialog traps focus and restores it to the trigger on
  close; a menu is arrow-navigable; skip link first in tab order.
- **Route change** moves focus to the `h1` and announces the page title in a live region — the
  prototype's `RouteEffects.tsx`.
- **`forced-colors: active`** — rank survives on border and weight; the primary control keeps a 2px
  `CanvasText` border.
- **Pinch-to-zoom is never disabled.** No `maximum-scale`, no `user-scalable=no`. A layout that needs
  zoom disabled has a bug; fix the bug.
- **Contrast**: text ≥ 4.5:1, large text ≥ 3:1, meaningful borders and states ≥ 3:1, in both themes,
  measured — the tables in §2 and §3 are the record.
- **Language and locale**: `en-GB`. Dates as `9 Sep 2026`. Never a bare `MM/DD`.

---

## 14. Copy

The product already has a voice — plain, exact, unhedged, willing to state a cost. It is one of its
best assets and it is preserved rather than smoothed. The rules:

1. **Say the thing.** "Losing the key ends the identity permanently." Not "keys are important".
2. **Never claim what was not measured.** "not measured" over a zero. "not published" over a
   placeholder address.
3. **Name the cost before the benefit** on anything irreversible.
4. **No exclamation marks, no emoji, no "oops", no "awesome", no "we're sorry for the
   inconvenience".** An error says what happened and what to do.
5. **Second person for the reader, first person plural only where the operator is genuinely acting**
   ("We take 2.9% at settlement").
6. **Buttons are verbs and say what will happen**: "Claim your handle", "Open the pool",
   "Withdraw 3 SUI". Never "Submit", never "Continue" alone.
7. **British English**, sentence case for everything except the mono eyebrows.
8. **Untrusted text is labelled.** An agent's own words, a creator's bio and any user-supplied
   string are rendered as untrusted content and never as interface copy.

---

## 15. The ban list

Any of these in a diff is a failed review:

- A hex value outside the theme file. A `rgba()` literal outside it.
- A `style={{ }}` in application code.
- A spacing, size or radius that is not on the ladder.
- A `<img>` where `next/image` would work.
- A centred full-page spinner.
- A toast that carries the only copy of an error.
- A skeleton or spinner with no timeout.
- An empty list standing in for a failed read.
- A zero standing in for an unread value.
- An optimistic update on anything financial.
- Hover as the only route to information.
- A fourth font family.
- A second interpretation of a screen the prototype already draws.
