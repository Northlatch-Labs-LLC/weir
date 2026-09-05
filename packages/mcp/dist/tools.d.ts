import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WeirBinding } from './transport.js';
/**
 * The reserved marker inside a content key — the same one `packages/agent` and the web refuse.
 * Declared here rather than imported: this package loads the agent library dynamically and only in
 * an armed deployment, and a static import for one string would put it in every address space.
 * `test/price-tool.ts` pins it to the agent's export so the copies cannot drift.
 */
export declare const MACHINE_EDITION_MARKER = "#machine";
/**
 * Put on the server exactly the tools this binding can honour, and no others.
 *
 * # Absence, never a tool that refuses
 *
 * A registered tool that always answers "not available in this deployment" is worse than nothing
 * twice over. It costs the model context on **every single turn** to describe a capability that
 * does not exist — the tool list is re-sent with each request — and it gives the model something to
 * keep trying, which turns one missing feature into a loop. A tool that is not in `tools/list`
 * cannot be called and cannot be reasoned about.
 *
 * # The capability set is computed from the implementation, not from configuration
 *
 * {@link capabilitiesOf} looks at what the bound port actually provides and whether a signing
 * signer and a policy are both present. Configuration says what an operator intended; this says
 * what will succeed. Two consequences that are live today and are not bugs:
 *
 *  - **`weir_search` is absent**, because `@projectx-social/agent` exports no `feed` yet. The old
 *    one went through `GET /api/posts`, which has no `GET`; every call was a 405. The endpoint it
 *    now targets exists — `GET /api/browse`, the shop window: a fixed page of twenty, `truncated`
 *    measured by the server, an opaque cursor — and the port's `feed` carries exactly that shape.
 *    The tool registers the moment the agent implements it.
 *  - **`weir_quote` takes a vault id and a content key, not a post id.** The post-id form needed an
 *    HTTP endpoint to resolve the id, and that endpoint is the same missing `GET`. The vault-and-key
 *    form reads the price straight off the chain and has always worked. It is the honest half.
 *
 * Both are recorded in the README's open list with what would have to exist for them to return.
 *
 * # The `!` in every handler, and why it is not a hole
 *
 * Each handler calls its port method with a non-null assertion — `weir.feed!(…)`. Every member of
 * `WeirPort` is optional, because absence is what {@link capabilitiesOf} reads, so the compiler
 * cannot see that a handler is only ever registered when its method exists.
 *
 * The assertion is discharged by the line immediately above it: a `register*` function is called
 * only from inside `when(capability, …)`, and that capability is in the set only because
 * `capabilitiesOf` found the method. Registration and the assertion are eight lines apart in one
 * file, which is close enough that a future edit separating them is visible in the diff.
 *
 * The alternative — narrowing each method into a local before registering — would put a runtime
 * check in front of a condition already proven, and would leave the reader wondering which of the
 * two checks was the real one. There is one, and it is `capabilitiesOf`.
 *
 * # One ledger per server, shared by every spending tool
 *
 * Created here so that a retry of `weir_buy` and the original `weir_buy` meet in the same map. See
 * `idempotency.ts` for why the map holds a promise rather than a finished result.
 *
 * # Which tools demand a live tether, and — as importantly — which do not
 *
 * {@link requireLiveTether} is spent by `weir_post` and `weir_send` alone. The rule it applies is
 * **does this cost the platform**, not "does this write" and not "does this spend": the platform is
 * the party with no signature on the transaction and no way to refuse afterwards.
 *
 *   - `weir_post` — **gated.** `POST /api/posts` seals a paid body to both editions and leases
 *     durable storage for each; a public body is still a row the platform keeps.
 *   - `weir_send` — **gated.** `POST /api/messages` stores a row. The tool attaches no payment and
 *     burns no gas, so the platform pays for all of it.
 *   - `weir_buy`, `weir_subscribe` — **not gated.** They move the caller's own coin under the
 *     caller's own gas, through `creator::unlock` and its subscription twin. The platform pays
 *     nothing; a creator is paid. Refusing these would cost a creator a sale to enforce a rule about
 *     the platform's costs, which is the wrong party to charge for it.
 *   - `weir_price` — **not gated.** `creator::set_content_price` is one on-chain call on the
 *     caller's own vault, at the caller's own gas. What bounds it is AUTHORITY, and the operator's
 *     policy is where that already lives.
 *   - `weir_declare` — **NEVER gated, and this is the one that must not be changed by anybody
 *     reading the list above and being thorough.** It is how an undeclared agent becomes declared.
 *     Requiring a live tether in order to file for one is a door that can only be opened from
 *     inside: every agent that needs this tool is, by definition, an agent that would fail the check.
 *   - `weir_search`, `weir_read`, `weir_quote`, `weir_authorship`, `weir_agents`, `weir_seeking`,
 *     `weir_balance` — **not gated.** Free reads. Two reasons, and the second is the one that
 *     settles it: an undeclared address is indistinguishable from a person, so there is no ground on
 *     which to refuse one; and `weir_agents` and `weir_seeking` are the register and the list of
 *     agents who have no operator yet, so gating either would be circular.
 */
export declare function registerTools(server: McpServer, binding: WeirBinding): string[];
//# sourceMappingURL=tools.d.ts.map