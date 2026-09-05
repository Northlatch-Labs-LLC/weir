// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The purse itself: one request in, one decision out, one audit line either way.
 *
 * # The order of the five steps is not this file's to change
 *
 * Build, observe, gate, evaluate, record-then-sign belong to `policySigner`, and its header
 * explains why step 5 must never be swapped. This file adds exactly one thing before them —
 * turning an intent into a transaction, because the model must never supply bytes — and exactly one
 * thing around them: a line in `audit.jsonl` on **every** path, including the paths that never
 * reach the signer at all.
 *
 * Those paths are the reason the purse keeps its own chain. A malformed request and an intent the
 * schema rejected produce no signer entry, because no transaction was ever built. They are also the
 * two lines that show somebody probing the socket, and a log that only records what got as far as
 * the evaluator would not have them.
 *
 * # Every way out of `handle` is a value
 *
 * There is no `throw` on any path, including the unexpected ones: the whole body is wrapped, and an
 * exception becomes a recorded refusal. The caller is an unattended beat. An exception three frames
 * up becomes a retry, and a retry against a policy denial is a loop hammering a wall — the sentence
 * is `policySigner`'s and the hazard is the same one at this boundary.
 */
import { policySigner, } from '@projectx-social/signer';
import { AuditFile } from './audit-file.js';
import { buildIntent, nodeGas } from './build.js';
import { intentHash, parseIntent } from './intent.js';
import { SpendLedger, outflowsOf } from './ledger-file.js';
import { ruleIdIn } from './outcome.js';
import { requestSchema } from './protocol.js';
export function createPurse(options) {
    const gas = options.gas ?? nodeGas;
    const log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
    const address = options.signer.address;
    const signer = policySigner({
        inner: options.signer,
        policy: options.policy,
        client: options.client,
        ledger: () => options.ledger.state(),
        ...(options.simulation === undefined ? {} : { simulation: options.simulation }),
    });
    const record = async (fields) => {
        const line = await options.audit.append({
            ts: Date.now(),
            address,
            policyHash: options.policyHash,
            policyFileSha256: options.policyFileSha256,
            intentKind: fields.intentKind,
            intentHash: fields.intentHash,
            outcome: fields.refusal === null ? 'signed' : 'refused',
            ruleId: fields.refusal?.ruleId ?? '',
            reason: fields.refusal?.reason ?? '',
            txDigest: fields.txDigest,
        });
        log(`purse: ${fields.intentKind} ${line.outcome}` +
            (fields.refusal === null ? ` digest=${fields.txDigest}` : ` rule=${fields.refusal.ruleId}`) +
            ` seq=${String(line.seq)}`);
        return line;
    };
    const refused = async (refusal, about) => {
        await record({ ...about, refusal });
        return { ok: false, refused: refusal };
    };
    const answer = async (request) => {
        const envelope = requestSchema.safeParse(request);
        if (!envelope.success) {
            return refused({
                ruleId: 'request-malformed',
                reason: `the request is not \`{ "intent": … }\`. This purse answers one call and has no other ` +
                    `request kind: no key export, no sign-arbitrary-bytes, no policy reload, no health ` +
                    `call. An unrecognised field is refused rather than ignored.`,
            }, { intentKind: 'unparsed', intentHash: '', txDigest: '' });
        }
        const parsed = parseIntent(envelope.data.intent);
        if (!parsed.ok) {
            return refused({ ruleId: 'intent-invalid', reason: parsed.reason }, { intentKind: 'unparsed', intentHash: '', txDigest: '' });
        }
        const intent = parsed.intent;
        const about = { intentKind: intent.kind, intentHash: intentHash(intent), txDigest: '' };
        const built = buildIntent({
            intent,
            chain: options.chain,
            policy: options.policy,
            sender: address,
            gas,
        });
        if (!built.ok)
            return refused(built.refused, about);
        const signed = await signer.signTransaction(built.value);
        if (!signed.ok) {
            const detail = signed.failure.detail;
            const ruleId = ruleIdIn(detail);
            return refused(ruleId === null
                ? {
                    ruleId: 'gate-refused',
                    reason: `the gate refused before any rule was reached (${signed.failure.kind}): ${detail}`,
                }
                : { ruleId, reason: detail }, about);
        }
        /*
          Signed. Record the spend before answering.
    
          Before, not after: the response leaves this process and the beat may submit immediately, and
          a crash between answering and recording would leave a signature in the world that the next
          beat's ceiling does not know about. Recording first can at worst over-count a signature that
          was never submitted, which delays a post. The asymmetry is the same one `policySigner` gives
          for recording before signing, one layer out.
        */
        await options.ledger.record(outflowsOf(signed.value.effects, address));
        await record({ ...about, refusal: null, txDigest: signed.value.txDigest });
        return {
            ok: true,
            digest: signed.value.txDigest,
            txBytesB64: Buffer.from(signed.value.bytes).toString('base64'),
            signature: signed.value.signature,
        };
    };
    return {
        address,
        policyHash: options.policyHash,
        auditHead: () => options.audit.headHash,
        handle: async (request) => {
            try {
                return await answer(request);
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                const refusal = {
                    ruleId: 'gate-refused',
                    reason: `the purse raised an unexpected error and nothing was signed — ${detail}. This is a ` +
                        `fault in the purse rather than a decision about the intent, and it is recorded as a ` +
                        `refusal because the intent was in fact refused.`,
                };
                try {
                    await record({ intentKind: 'unparsed', intentHash: '', refusal, txDigest: '' });
                }
                catch {
                    // The append itself failed. Still a value, never a throw: the caller is a loop, and the
                    // one thing known for certain is that retrying will not help.
                }
                return { ok: false, refused: refusal };
            }
        },
    };
}
//# sourceMappingURL=purse.js.map