/**
 * The adapter between `@projectx-social/agent` and this server's {@link WeirPort}.
 *
 * # Why this file exists
 *
 * Until 2026-09-02 `agentFromReading` returned the agent object *as* the port — one cast. The two
 * shapes disagree on every write:
 *
 * - the port's `unlock` carries `ceiling: { maxPrice, currency }`; the agent's takes `maxPrice`
 *   and `priceMinorUnits` as bare fields, so under the cast an armed `weir_buy` reached the agent
 *   with `maxPrice === undefined` and was refused every time ("maxPrice is required");
 * - the agent answers every call with a `Reading<T>` — `{ ok, value }` or `{ ok, failure }` —
 *   while the port promises bare receipts, so `weir_post` read `created.postId` off an envelope
 *   and reported success with `postId: undefined` on a REFUSED publish; `weir_price` reported no
 *   digest; `weir_quote` spread an envelope holding a `bigint`, which `JSON.stringify` cannot
 *   serialise.
 *
 * Every one of those is a seam between two tested modules that no test crossed. This file is the
 * seam made explicit, and `test/agent-port.ts` crosses it.
 *
 * # The two rules
 *
 * 1. **A failed `Reading` is a refusal, never a throw of convenience and never a success.** It
 *    surfaces as a {@link PortRefusal} carrying the agent's own failure kind and source, which
 *    `tools.ts` turns into the tool's refusal shape. A tool result that says `ok: true` therefore
 *    means the agent said `ok: true`.
 * 2. **Nothing here applies a ceiling.** The ceiling is carried to the agent, whose `guardPrice`
 *    compares it against the live price it reads itself. This file only translates the shape.
 *
 * # What a receipt can and cannot carry
 *
 * The agent's `Executed` is `{ digest, simulation }` — no created object ids (the executor reads
 * no effects, by its own documented decision). So `unlockObjectId` and `subscriptionObjectId` are
 * `null` here, and the type says so; the object is on chain under the digest. `pricePaid` on an
 * unlock is the live price the adapter read immediately before the buy — the same number the
 * agent funds and guards, unless the creator repriced in the milliseconds between the two reads,
 * in which case the agent's own guard still bounds the spend. A subscription's tier price is not
 * exposed by the agent's read surface, so its `pricePaid` is `null`: not read, never guessed.
 */
import type { WeirPort, Currency } from './transport.js';
/**
 * A refusal that crossed the seam. `kind` and `source` are the agent library's own words
 * (`transport`, `timeout`, `malformed`, `not-found`, `precondition`, `unconfigured`, …) so a
 * caller can decide whether to retry, and so a log line reads the same on both sides.
 */
export declare class PortRefusal extends Error {
    readonly kind: string;
    readonly source: string;
    constructor(kind: string, source: string, detail: string);
}
/**
 * The denomination of a coin type, for the port's `currency` field. Only the two the tools accept
 * are named; anything else is a refusal, because printing a price without saying what it is
 * denominated in is how "100000000" is read as a dollar amount.
 */
export declare function currencyOf(coinType: string): Currency;
/**
 * Bind an agent to the port, method by method. A method is present on the port only when the
 * agent has it, so {@link capabilitiesOf} keeps reading the truth: a keyless `ReadOnlyAgent`
 * yields a port with `quote` and `feed` and nothing that spends.
 */
export declare function portFromAgent(candidate: unknown): WeirPort;
//# sourceMappingURL=agent-port.d.ts.map