// Built-by: @projectx.sui

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Outcome } from './outcome.js';
import type { PurseResponse } from './protocol.js';
import { MAX_POST_TITLE_LENGTH } from './statement.js';

export const MAX_POST_PREVIEW_LENGTH = 1000;
export const MAX_POST_BODY_LENGTH = 100_000;
export const SUI_COIN_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

export const MIN_PRICE_MIST = 10_000_000n;
export const MAX_PRICE_MIST = 100_000_000n;

export const publishPlan = z.strictObject({
  kind: z.literal('publish-plan'),
  title: z.string().min(1).max(MAX_POST_TITLE_LENGTH).regex(/^[^\x00-\x1f\x7f]*$/, 'a title is one line'),
  preview: z.string().min(1).max(MAX_POST_PREVIEW_LENGTH),
  text: z.string().min(1).max(MAX_POST_BODY_LENGTH),
  access: z.enum(['public', 'paid']),
  priceMist: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .refine((v) => BigInt(v) >= MIN_PRICE_MIST && BigInt(v) <= MAX_PRICE_MIST, {
      message: `priceMist is between ${String(MIN_PRICE_MIST)} and ${String(MAX_PRICE_MIST)} (0.01 to 0.1 SUI)`,
    })
    .optional(),
}).refine((plan) => (plan.access === 'paid') === (plan.priceMist !== undefined), {
  message: 'a paid post carries priceMist; a public post carries none',
});

export type PublishPlan = z.infer<typeof publishPlan>;

export function contentDigest(preview: string, text: string): string {
  return createHash('sha256').update(`${preview.length}:${preview}${text.length}:${text}`).digest('hex');
}

export function parsePublishPlan(value: unknown): { ok: true; plan: PublishPlan } | { ok: false; reason: string } {
  const parsed = publishPlan.safeParse(value);
  if (parsed.success) return { ok: true, plan: parsed.data };
  const problems = parsed.error.issues.map((i) => `${i.path.length === 0 ? '(root)' : i.path.join('.')}: ${i.message}`).slice(0, 8);
  return { ok: false, reason: `the publish plan does not satisfy its schema — ${problems.join('; ')}. The values are not quoted.` };
}

export function looksLikePlan(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'publish-plan';
}

export interface HttpPort {
  readonly request: (input: { method: 'GET' | 'POST'; url: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; json: unknown }>;
}

export interface ChainRefPort {
  readonly sharedRef: (objectId: string) => Promise<{ objectId: string; initialSharedVersion: string; mutable: true }>;
  readonly ownedRef: (objectId: string) => Promise<{ objectId: string; version: string; digest: string }>;
  /**
   * What this content key is already priced at on the vault, or null if it is not priced.
   *
   * This is what makes a paid post resumable. Pricing and publishing are two systems and the API
   * refuses a paid post whose key is not already priced on chain (`app/api/posts/route.ts:50`), so
   * the irreversible half MUST go first and cannot be reordered. The only thing that makes the gap
   * between them survivable is that the second attempt costs nothing: the content key is the
   * sha256 of the body, so the same plan always produces the same key, and a key already priced at
   * the price being asked for needs no transaction at all.
   *
   * A read that fails returns null rather than throwing. The consequence of a wrong null is one
   * reprice of a key to the price it already has — a no-op that costs gas. The consequence of a
   * throw here would be the failure this whole port exists to remove.
   */
  readonly priceOf: (args: { vaultId: string; contentKey: string; coinType: string }) => Promise<string | null>;
}

export interface PublishPorts {
  readonly ask: (intent: unknown) => Promise<Outcome<PurseResponse>>;
  readonly http: HttpPort;
  readonly chain: ChainRefPort;
  readonly submit: (args: { txBytesB64: string; signature: string }) => Promise<string>;
  readonly now: () => number;
}

export interface PublishArgs {
  readonly plan: PublishPlan;
  readonly address: string;
  readonly origin: string;
  readonly beatId: string;
  readonly ports: PublishPorts;
  readonly profile: { name: string; bio: string };
}

export type PublishOutcome =
  | { readonly outcome: 'published'; readonly postId: string; readonly handle: string; readonly priceDigest?: string; readonly named: boolean; readonly resumedPrice?: boolean }
  | { readonly outcome: 'refused'; readonly ruleId: string; readonly error: string; readonly priceDigest?: string }
  | { readonly outcome: 'error'; readonly error: string; readonly priceDigest?: string };

interface Setup {
  stage: string;
  handle?: string;
  vaults?: { vaultId: string; capId: string; coinType: string; handle: string | null }[];
}

export async function runPublishPlan(args: PublishArgs): Promise<PublishOutcome> {
  const { plan, address, origin, ports } = args;
  let priceDigest: string | undefined;
  /** True when the key was already priced at this price and no transaction was needed. */
  let resumedPrice = false;
  const refusal = (ruleId: string, error: string): PublishOutcome => ({ outcome: 'refused', ruleId, error, ...(priceDigest === undefined ? {} : { priceDigest }) });
  const failure = (error: string): PublishOutcome => ({ outcome: 'error', error, ...(priceDigest === undefined ? {} : { priceDigest }) });

  const setupResponse = await ports.http.request({ method: 'GET', url: `${origin}/api/creator?owner=${address}` });
  if (setupResponse.status !== 200) return failure(`GET /api/creator answered ${String(setupResponse.status)}`);
  const setup = setupResponse.json as Setup;
  if (setup.stage !== 'ready' || typeof setup.handle !== 'string' || !Array.isArray(setup.vaults) || setup.vaults.length === 0) {
    return failure(`the creator setup for ${address} is not ready (stage ${String(setup.stage)}); the account or the vault is missing`);
  }
  const vault = setup.vaults.find((v) => v.coinType === SUI_COIN_TYPE) ?? setup.vaults[0]!;
  let handle = vault.handle ?? setup.handle;

  let named = false;
  if (vault.handle === null) {
    const nameIntent = {
      kind: 'statement',
      action: { kind: 'name-vault', vaultId: vault.vaultId, name: args.profile.name, bio: args.profile.bio, coinType: vault.coinType },
      timestampMs: ports.now(),
      origin,
    };
    const asked = await ports.ask(nameIntent);
    if (!asked.ok) return refusal(asked.refused.ruleId, asked.refused.reason);
    const answer = asked.value;
    if (!answer.ok) return refusal(answer.refused.ruleId, answer.refused.reason);
    if (!('statement' in answer)) return failure('the purse answered a name-vault intent with a transaction');
    if (answer.address !== address) return failure(`the purse signs as ${answer.address}, not the ${address} this beat was started for; nothing was sent`);
    const profileResponse = await ports.http.request({
      method: 'POST',
      url: `${origin}/api/creator/profile`,
      body: { owner: address, vaultId: vault.vaultId, coinType: vault.coinType, displayName: args.profile.name, bio: args.profile.bio, signature: answer.signature, timestampMs: answer.timestampMs },
    });
    if (profileResponse.status !== 200) return failure(`POST /api/creator/profile answered ${String(profileResponse.status)}: ${detailOf(profileResponse.json)}`);
    const filedAs = (profileResponse.json as { handle?: unknown } | null)?.handle;
    if (typeof filedAs === 'string' && filedAs !== '') handle = filedAs;
    named = true;
  }

  const digest = contentDigest(plan.preview, plan.text);
  const contentKey = plan.access === 'paid' ? digest : '';
  if (plan.access === 'paid') {
    /*
      Already priced at this price? Then the chain half of this post is done, and doing it again
      would be a second transaction to reach a state that already holds.

      This is the resume. A beat that priced and then failed before publishing — a node that hung
      up on the submit, a process killed between the two — leaves exactly this state: the key
      priced, no post. Wren was in it from 18:35 UTC on 2026-09-06 (price 5Jg4S1zh…, beat
      20260906T183348Z, phase two exit 1). Without this check the price is orphaned for ever,
      because the next beat writes different content and therefore a different key.
    */
    const alreadyPriced = await ports.chain.priceOf({ vaultId: vault.vaultId, contentKey, coinType: vault.coinType });
    if (alreadyPriced === plan.priceMist!) {
      resumedPrice = true;
    } else {
      const [vaultRef, capRef] = await Promise.all([ports.chain.sharedRef(vault.vaultId), ports.chain.ownedRef(vault.capId)]);
    const priceIntent = {
      kind: 'post',
      coinType: vault.coinType,
      vault: vaultRef,
      cap: capRef,
      contentKey,
      bodyDigestSha256: digest,
      priceMist: plan.priceMist!,
    };
    const asked = await ports.ask(priceIntent);
    if (!asked.ok) return refusal(asked.refused.ruleId, asked.refused.reason);
    const answer = asked.value;
    if (!answer.ok) return refusal(answer.refused.ruleId, answer.refused.reason);
    if (!('digest' in answer)) return failure('the purse answered a post intent with a statement');
      /*
        The submit is the one call in this function that can leave money spent and the work
        unfinished, so it is the one call that is caught. A throw here used to take the whole
        function with it and step 4 never ran — the defect this fix removes. The price may well
        have landed anyway; the next beat's `priceOf` above finds out and resumes rather than
        guessing.
      */
      try {
        priceDigest = await ports.submit({ txBytesB64: answer.txBytesB64, signature: answer.signature });
      } catch (thrown) {
        return {
          outcome: 'error',
          error:
            `the price was signed and the submit threw: ${thrown instanceof Error ? thrown.message : String(thrown)}. ` +
            `It may have landed. The next beat that writes this same body prices nothing and publishes it, ` +
            `because the content key is the body's digest.`,
        };
      }
    }
  }

  const publishIntent = {
    kind: 'statement',
    action: { kind: 'publish', handle, title: plan.title, access: plan.access, contentSha256: digest, contentKey, price: plan.access === 'paid' ? plan.priceMist! : '' },
    timestampMs: ports.now(),
    origin,
  };
  const asked = await ports.ask(publishIntent);
  if (!asked.ok) return refusal(asked.refused.ruleId, asked.refused.reason);
  const answer = asked.value;
  if (!answer.ok) return refusal(answer.refused.ruleId, answer.refused.reason);
  if (!('statement' in answer)) return failure('the purse answered a publish intent with a transaction');
  if (answer.address !== address) return failure(`the purse signs as ${answer.address}, not the ${address} this beat was started for; nothing was sent`);
  const postResponse = await ports.http.request({
    method: 'POST',
    url: `${origin}/api/posts`,
    headers: { 'idempotency-key': `heron-beat-${args.beatId}` },
    body: {
      handle,
      author: address,
      title: plan.title,
      preview: plan.preview,
      text: plan.text,
      access: plan.access,
      ...(contentKey === '' ? {} : { contentKey }),
      ...(plan.access === 'paid' ? { price: plan.priceMist! } : {}),
      signature: answer.signature,
      timestampMs: answer.timestampMs,
    },
  });
  if (postResponse.status !== 200) return failure(`POST /api/posts answered ${String(postResponse.status)}: ${detailOf(postResponse.json)}`);
  const postId = (postResponse.json as { post?: { id?: unknown } } | null)?.post?.id;
  if (typeof postId !== 'string' || postId === '') return failure('the post was accepted but no post id came back');
  return { outcome: 'published', postId, handle, named, resumedPrice, ...(priceDigest === undefined ? {} : { priceDigest }) };
}

function detailOf(json: unknown): string {
  const error = (json as { error?: unknown } | null)?.error;
  return typeof error === 'string' ? error.slice(0, 300) : 'no error text';
}
