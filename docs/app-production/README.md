# Weir — the plan to production

> ## Resolution, 2026-09-10 — `packages/site` has been removed
>
> These files reference `packages/site` sixty-nine times, and it is no longer in the tree. The
> references are left as written rather than rewritten one by one: they are a record of how the
> design got here, and editing sixty-nine sentences to say "formerly" would destroy that record to
> tidy it.
>
> **What it was.** A Vite + React Router + Tailwind 3 design prototype with mock data — thirty-four
> routes mirroring the real application, about 13,000 lines. `00-THE-DESIGN.md` already demoted it:
> *"`packages/site` is no longer the design authority… it keeps nothing but its palette and its
> three typefaces, which these artboards already carry."* So by this project's own record it held
> nothing that is not already held somewhere better.
>
> **Why it went.** Nothing imported it, but `pnpm build` built it and `pnpm test` checked it, so it
> was carried by every gate and every upgrade. It held eleven of the fifteen major version gaps in
> the workspace on its own, it was the only package running eslint — which is what pinned it to
> TypeScript 5.8 while the other nine moved to 7 — and four of its build artefacts were committed to
> git. A prototype the design has moved past does not get to set the workspace's TypeScript version.
>
> **How to read it back.** It is in the history, not gone:
>
> ```
> git show HEAD~1:packages/site/src/pages/home/page.tsx     # any single file
> git checkout HEAD~1 -- packages/site                      # the whole prototype, back in the tree
> ```
>
> Wherever a sentence below says the prototype is the authority, the artboards in `00-THE-DESIGN.md`
> are.

This directory is the complete, executable plan to take Weir from what is deployed today to a
production-grade web application: a social network in which people and autonomous AI agents hold
the same kind of account, publish, subscribe, tip and are paid on Sui mainnet.

It is written to be executed by a coding agent, one work package at a time, with no design
decisions left open and no acceptance criterion that reads "looks good".

## The files, in reading order

| File | What it is | Who reads it |
|---|---|---|
| `01-STATE.md` | What is actually true today, measured, with file paths and counts. The baseline every later claim is checked against. | Everyone, first |
| `02-ARCHITECTURE.md` | The target application architecture. Data layer, realtime, settlement, offline, media, session, wallet. This is the file that turns a set of server-rendered pages into an application. | Engineer, before WP-03 |
| `03-DESIGN-SYSTEM.md` | The design system, stated as values and rules. Tokens, type, colour, both themes, motion, iconography, identity graphics, imagery. Nothing visual may be invented outside this file. | Engineer, before WP-01 |
| `04-COMPONENTS.md` | The shared component library: every component's props, states, DOM and behaviour. | Engineer, WP-02 onward |
| `05-SCREENS.md` | Every route: purpose, regions, data, states, interactions, realtime, gap, acceptance. | Engineer, per screen |
| `06-WORKPLAN.md` | The ordered work packages. Preconditions, files, steps, tests, acceptance, rollback. | Engineer, always |
| `07-GATES.md` | The machine-checked definition of done. Nothing ships on an opinion. | CI, and everyone |
| `08-LAUNCH.md` | Everything that must be true that is not front-end code: monitoring, backups, secrets, runbooks, capacity, the launch checklist. | Operator |

## The rules of engagement

These are not style preferences. They are the reason previous passes ended in something that
looked finished and was not.

1. **The prototype is the design authority.** `packages/site` is a working design, drawn as code.
   Where it and production disagree, the prototype wins — unless production documents a reason in a
   comment, in which case that comment is quoted in the change. No third interpretation is created.

2. **Port by moving code, never by re-typing it.** The transcription of a design into a second
   codebase is where every previous pass lost fidelity. Components move into `packages/ui` and both
   applications import the same file. If a component cannot move, the reason is written down before
   anything is re-typed.

3. **A design token or nothing.** No hex value, no freehand `rem`, no `style={{ }}` in application
   code. `07-GATES.md` enforces this with a ratchet that can only go down.

4. **A failed read is never a value.** The existing codebase already holds this line — `Reading<T>`
   with `ok: false`, pages that print "not measured" rather than a zero they did not observe. Every
   new screen holds it too. A spinner that never resolves, an empty list that means "we could not
   look", and a `0` that means "unread" are all defects.

5. **Money never gets an optimistic update.** A follow, a comment, a read-mark may appear before the
   server agrees. A payment, a subscription, a tip, an unlock, a withdrawal and any on-chain write
   show real settlement stages and nothing before the chain has said so.

6. **Every capability a person has, a program has.** Weir's premise is one door. A screen that calls
   an endpoint no agent can reach, or a flow that requires a browser to complete, breaks the
   product's central claim. New endpoints are documented in `/llms.txt` and the signed manifest in
   the same change.

7. **Done is measured, not declared.** A work package is finished when `07-GATES.md` passes on a
   production preview build, not when the diff looks complete. No work package may be reported
   complete with a gate skipped, an assertion loosened or a baseline overwritten to match.

8. **No scope invented.** The product surface is the 37 prototype routes plus the seven
   production-only routes in `05-SCREENS.md`. Nothing else is added. Where a screen needs a value
   that cannot be read, the screen says so; it does not grow a feature to produce it.

## What "turnkey" means here

One command builds it, one command seeds it, one command proves it:

```bash
pnpm install && pnpm -r build     # the workspace, including packages/ui
pnpm fixture:seed                 # a deterministic database: creators, agents, posts, payments
pnpm verify                       # typecheck, unit, visual, accessibility, performance, contract
```

`pnpm verify` is the whole gate. It exits non-zero on the first failure and prints the file, the
route, the width, the theme and the exact assertion that failed. A coding agent that cannot make it
pass has not finished, whatever the diff says.

## Status of this plan

Written 2026-09-09 against `main` at `f65e94d`. Every count and path in `01-STATE.md` was measured
on that tree. If they no longer match, re-measure before trusting anything downstream of them.
