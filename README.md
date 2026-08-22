# Weir

A creator network on Sui where support stays yours. Supporters pool SUI behind a creator; the
vault delegates it to a validator and only the staking yield reaches the creator — the principal
is withdrawable in full at any time. Subscriptions, one-off unlocks and tips settle on chain in the
same transaction that pays the creator. Live at [weir.social](https://weir.social).

Built-by: @projectx.sui /|\ · Co-authored-by: Claude — see `NOTICE`.

## What is here

| Path | What it is |
|---|---|
| `sui-contracts/` | The `projectx_social` Move package: accounts, creator vaults, tiers, subscriptions, unlocks, tips, the no-loss stake vault with its withdrawal ladder, and the key registry. |
| `packages/sdk/` | TypeScript client over Sui gRPC: BCS decoders for every on-chain object, transaction builders, simulation and abort decoding. Every chain read returns a `Reading<T>` — a failed read is never a value. |
| `packages/web/` | The Next.js application: feed, creator pages, treasury, chests, the creator studio, zkLogin and wallet sign-in, Seal/Walrus-backed paid bodies, the waiting-list gate and access codes. |
| `packages/daemon/` | The harvest daemon that keeps each stake vault's seven-rung ladder turning, one rung per epoch. |

## Running it

Requirements: Node 22+, pnpm 9+, Postgres 16+, and for the contracts the Sui CLI.

```bash
pnpm install
cp .env.example .env            # fill in the chain and database values; nothing has a default
pnpm -r build                   # the SDK compiles to dist/, which web and daemon consume
pnpm -r typecheck
pnpm -r test
```

The web app reads `packages/web/.env.local`. Database migrations are the numbered files in
`packages/web/db/` and are applied by hand, in order, with `psql`; there is no migration runner.
Tests that need Postgres read `PROJECTX_TEST_DATABASE_URL` (CI sets it; locally put it in
`.env.local`) and fail loudly rather than skip when it is absent.

```bash
cd packages/web && pnpm dev     # http://localhost:3000
```

## Design rules the code follows

- **Nothing is hardcoded that belongs to a deployment.** Package ids, object ids, endpoints and
  fees come from configuration or from the chain. A missing value is a refusal, not a default.
- **A failed read is never a value.** `Reading<T>` carries `ok: false` with the reason; pages
  render "not measured" and never a zero they did not observe.
- **Mirrored constants are tested against their source.** Every BCS layout and every protocol
  constant in the SDK has a test that reads the Move source and asserts the copy.
- **Nothing is signed that was not first simulated.** Every transaction goes simulate → quote →
  sign, and the abort code is translated before it reaches a person.
- **Integers for money.** Amounts are `bigint` in the smallest unit; decimals are read from coin
  metadata, never assumed.

## Contracts

The package is published on Sui mainnet; ids are recorded in `sui-contracts/deploy/mainnet.json`
and shown, with explorer links, on the site's Security page. Economic parameters are set by
transaction after publish and ship at zero.

## Licence

No licence file is included yet; all rights reserved until one is added.
