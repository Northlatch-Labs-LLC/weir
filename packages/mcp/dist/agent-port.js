/**
 * A refusal that crossed the seam. `kind` and `source` are the agent library's own words
 * (`transport`, `timeout`, `malformed`, `not-found`, `precondition`, `denied`, `unconfigured`, …) so a
 * caller can decide whether to retry, and so a log line reads the same on both sides.
 */
export class PortRefusal extends Error {
    kind;
    source;
    constructor(kind, source, detail) {
        super(detail);
        this.kind = kind;
        this.source = source;
        this.name = 'PortRefusal';
    }
}
function unwrap(reading, source) {
    if (reading.ok)
        return reading.value;
    const f = reading.failure;
    throw new PortRefusal(f.kind, f.source ?? source, f.detail);
}
/**
 * The denomination of a coin type, for the port's `currency` field. Only the two the tools accept
 * are named; anything else is a refusal, because printing a price without saying what it is
 * denominated in is how "100000000" is read as a dollar amount.
 */
export function currencyOf(coinType) {
    if (/::sui::SUI$/.test(coinType))
        return 'SUI';
    if (/::usdc::USDC$/i.test(coinType))
        return 'USDC';
    throw new PortRefusal('unconfigured', 'currency', `the vault's coin type ${coinType} is neither SUI nor USDC, and this server names prices only in those two.`);
}
const has = (agent, name) => typeof agent[name] === 'function';
/**
 * Bind an agent to the port, method by method. A method is present on the port only when the
 * agent has it, so {@link capabilitiesOf} keeps reading the truth: a keyless `ReadOnlyAgent`
 * yields a port with `quote` and `feed` and nothing that spends.
 */
export function portFromAgent(candidate) {
    const agent = (candidate ?? {});
    const port = {};
    if (has(agent, 'feed'))
        port.feed = (input) => agent.feed(input);
    if (has(agent, 'readPreview')) {
        // `null` means "exists, not entitled" on both sides; a failed Reading is a refusal, as everywhere.
        port.readPreview = async (input) => unwrap(await agent.readPreview(input), 'readPreview');
    }
    if (has(agent, 'machineBody'))
        port.machineBody = (input) => agent.machineBody(input);
    /*
      A failed READ is a failure; a post with no retained proof is not. `unwrap` turns a failed
      Reading into a thrown refusal, which is right for the first and would be a lie about the second
      — so the absence passes through as the value it is.
    */
    if (has(agent, 'authorship')) {
        port.authorship = async (input) => unwrap(await agent.authorship(input), 'authorship');
    }
    if (has(agent, 'commentAuthorship')) {
        port.commentAuthorship = async (input) => unwrap(await agent.commentAuthorship(input), 'commentAuthorship');
    }
    if (has(agent, 'agents'))
        port.agents = async (input) => unwrap(await agent.agents(input), 'agents');
    /*
      `null` — the address has no entry — is a VALUE and crosses as one; a failed `Reading` is a
      refusal and is thrown, like everywhere else in this file. The distinction is the whole point of
      binding this method rather than deriving the answer from `agents()`: "not in the register" and
      "the register could not be read" reach the tether check as different things, and it treats them
      as different things. `unwrap` already draws that line, so nothing extra is needed here beyond
      NOT flattening the null into a refusal.
    */
    if (has(agent, 'declaration')) {
        port.declaration = async (input) => unwrap(await agent.declaration(input), 'declaration');
    }
    if (has(agent, 'seeking'))
        port.seeking = async () => unwrap(await agent.seeking(), 'seeking');
    /*
      Present only on a KEYED agent: `requestDeclaration` signs, and `createAgent({ keypair: null })`
      returns a `ReadOnlyAgent` that does not carry it. So the port's method is absent on a hosted
      binding for the same structural reason `unlock` is, and `capabilitiesOf` never sees `declare`
      there even before the armed gate is consulted. Untrimmed passthrough: the library trims and
      signs what it trimmed, and a second trim here would make what is signed depend on two files.
    */
    if (has(agent, 'requestDeclaration')) {
        port.requestDeclaration = async (input) => unwrap(await agent.requestDeclaration(input), 'requestDeclaration');
    }
    if (has(agent, 'quote')) {
        port.quote = async (input) => {
            const q = unwrap(await agent.quote(input), 'quote');
            return {
                vaultId: q.vaultId,
                contentKey: q.contentKey,
                price: q.priceMinorUnits.toString(),
                currency: currencyOf(q.coinType),
                coinType: q.coinType,
                owner: q.owner,
                accepting: q.accepting,
                observedAtMs: q.observedAtMs,
            };
        };
    }
    if (has(agent, 'balance') && typeof agent.address === 'string' && typeof agent.manifest?.coinType === 'string') {
        const address = agent.address;
        const coinType = agent.manifest.coinType;
        port.balance = async () => {
            const spendable = unwrap(await agent.balance(), 'balance');
            return { address, spendable: spendable.toString(), currency: currencyOf(coinType) };
        };
    }
    if (has(agent, 'unlock') && has(agent, 'quote')) {
        port.unlock = async ({ vaultId, contentKey, ceiling }) => {
            const q = unwrap(await agent.quote({ vaultId, contentKey }), 'unlock');
            const currency = currencyOf(q.coinType);
            if (currency !== ceiling.currency) {
                throw new PortRefusal('precondition', 'unlock', `the ceiling is in ${ceiling.currency} but vault ${vaultId} prices in ${currency}; nothing was signed.`);
            }
            const done = unwrap(await agent.unlock({ vaultId, contentKey, priceMinorUnits: q.priceMinorUnits, maxPrice: ceiling.maxPrice }), 'unlock');
            return { txDigest: done.digest, unlockObjectId: null, pricePaid: q.priceMinorUnits.toString(), currency };
        };
    }
    if (has(agent, 'subscribe') && typeof agent.manifest?.coinType === 'string') {
        const coinType = agent.manifest.coinType;
        port.subscribe = async ({ vaultId, tierIndex, ceiling }) => {
            const currency = currencyOf(coinType);
            if (currency !== ceiling.currency) {
                throw new PortRefusal('precondition', 'subscribe', `the ceiling is in ${ceiling.currency} but this agent pays in ${currency}; nothing was signed.`);
            }
            const done = unwrap(await agent.subscribe({ vaultId, tierIndex, maxPrice: ceiling.maxPrice }), 'subscribe');
            return { txDigest: done.digest, subscriptionObjectId: null, pricePaid: null, currency };
        };
    }
    if (has(agent, 'post')) {
        // The tool's key travels to the route as `Idempotency-Key`, so a retried tool call is answered
        // with the first publish rather than a second post (B3; `lib/idempotent-route.ts` on the web).
        port.post = async (article) => {
            const created = unwrap(await agent.post(article), 'post');
            return { postId: created.postId };
        };
    }
    if (has(agent, 'send')) {
        port.send = async ({ to, text, preview, idempotencyKey }) => {
            unwrap(await agent.send({ to, text, preview, idempotencyKey }), 'send');
            return { sent: true };
        };
    }
    if (has(agent, 'priceContent')) {
        port.priceContent = async ({ vaultId, contentKey, edition, price }) => {
            let amount;
            try {
                amount = BigInt(price);
            }
            catch {
                throw new PortRefusal('malformed', 'priceContent', `price ${JSON.stringify(price)} is not a whole number.`);
            }
            const done = unwrap(await agent.priceContent({ vaultId, contentKey, ...(edition === undefined ? {} : { edition }), price: amount }), 'priceContent');
            return { txDigest: done.digest };
        };
    }
    return port;
}
//# sourceMappingURL=agent-port.js.map