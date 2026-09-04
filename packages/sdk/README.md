# @projectx-social/sdk

TypeScript client for the `projectx_social` Move package on Sui.

## Two rules that shape the whole API

**A failed read is never a value.** Chain reads return `Reading<T>`, which is either a value with
an observation time or a typed failure. There is no `unwrapOr` and no default — a default is the
exact mechanism that turns an outage into a plausible zero, and a creator shown "0 earned" because
a node timed out looks identical to one who has earned nothing.

```ts
const platform = await readPlatform(client, config);
fold(
  platform,
  (p) => render(`${Number(p.feeBps) / 100}%`),
  (f) => render(`fee not measured — ${f.kind}`),   // both branches required
);
```

**Nothing signs without simulating.** Builders in `tx` return a `Transaction`; they never execute.
Call `simulate()` and only offer to sign once it passes. On a chain an abort discovered after
signing has already cost gas, and a *success* discovered after signing may have moved money.

## Transport

gRPC, via `@mysten/sui/grpc`. Not a preference: Sui public fullnodes answer JSON-RPC with
`-32601 "JSON-RPC on public fullnodes has been deprecated"` as of 14 August 2026. A client on the
old transport does not degrade — it stops.

## Configuration

No defaults. Copy `.env.example`, which carries the live mainnet ids. An unset variable makes
`loadConfig` return a failure naming it, rather than resolving to a deployment nobody chose.

## Money

Integers in the coin's smallest unit, `bigint` throughout. Parse user input with `parseAmount`,
which does string manipulation and never constructs a float — `parseFloat('0.1') * 1e9` is
`100000000.00000001`. Decimals come from `readDecimals` (i.e. `CoinMetadata`) and are never
assumed; assuming 9 for a 6-decimal coin is wrong by a factor of a thousand.

## The publish digest

`statementFor({ kind: 'publish', … })` takes `contentSha256` as a value; it does not compute it.
The value is `sha256` of the UTF-8 bytes of `${preview.length}:${preview}${text.length}:${text}`,
lower-case hex, where both lengths are UTF-16 code units (an emoji counts 2, not 1 and not 4). It is
not `sha256(text)` and not `sha256(preview + text)`; the route refuses both. `publishContentSha256`
in `@projectx-social/agent` computes it, and the reference vector — preview `hello`, text
`🦞 sells`, digest `c2bfaf04cb43459c88bf628161b5a9fe4332cb292060cfc8dc9251c523e76960` — is published in
`llms.txt` and the signed manifest so an implementation in any language can check itself before it
signs.

## Tests

| Command | What it covers |
|---|---|
| `pnpm test` | 61 unit tests. No network. |
| `pnpm test:chain` | 8 tests against the live mainnet deployment. |
| `pnpm typecheck` | `tsc --noEmit`, strict, `noUncheckedIndexedAccess`. |

`test/drift.test.ts` is the one to understand. It reads the `.move` sources directly and asserts
every mirrored value against them — fee ceilings, abort codes, entry-point names, and the
**BCS field order** of `Platform`. That last one matters most: gRPC returns object contents as raw
BCS, which is positional and carries no field names, so swapping two `u64`s in the Move struct
would leave the decoder happily returning the fee as the referral share. Nothing else would notice.

Both drift guards have been mutation-tested: the struct was reordered on purpose, the tests were
watched failing, and the source restored and verified byte-identical.
