// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Type-level assertions. **This file is compiled, never executed.**
 *
 * It carries no `.test.` in its name on purpose, so Vitest does not collect it, while
 * `tsconfig.json`'s `include: ["src", "test"]` does compile it. Its assertions are the compiler's
 * output, and `test/interface-variance.test.ts` is what turns that output into a passing or failing
 * test run.
 *
 * # What every `@ts-expect-error` below is really guarding
 *
 * `@ts-expect-error` fails **in both directions**, which is the whole reason it is used here rather
 * than a comment saying "this should not compile":
 *
 *   - If the line still errors, the directive is satisfied and `tsc` is silent.
 *   - If the line **stops** erroring — because somebody widened a type, or restored method syntax,
 *     or deleted a required field — the directive is unused and `tsc` raises **TS2578**.
 *
 * So a hole reopening is not a test that quietly keeps passing; it is a compile failure with a line
 * number. That property is what makes these assertions worth writing down at all.
 *
 * # The defect these exist for
 *
 * `SealDecryptor.decrypt` was declared with METHOD syntax — `decrypt(x): Promise<T>`. Under
 * `strictFunctionTypes`, TypeScript checks method parameters **bivariantly** (a deliberate
 * unsoundness kept for arrays and the DOM) and property-function parameters **contravariantly**.
 * Method syntax therefore accepts an implementation that demands MORE of its argument than the
 * interface promises to supply, in silence.
 *
 * The real implementation demanded `vaultId` and `contentKey` on a `SealApproval` that the
 * interface did not declare. It compiled. At run time it would have derived a Seal identity from
 * `undefined` — the right length, the wrong bytes — and a key server refusing that is
 * indistinguishable from this agent holding no entitlement at all.
 */

import { createAgent } from '../src/index.js';
import type { Agent, ReadOnlyAgent, Reading, SealApproval, SealDecryptor, SealedRef } from '../src/index.js';

type AssertNever<T extends never> = T;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type AssertTrue<T extends true> = T;

type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];

type DecryptParam = Parameters<SealDecryptor['decrypt']>[0];

type DemandsMore = DecryptParam & { readonly __anExtraRequirement: 'not on SealedRef' };

export const overSpecifiedDecryptor: SealDecryptor = {
  // @ts-expect-error — a decryptor demanding MORE than SealDecryptor promises must be REJECTED.
  decrypt: async (_input: DemandsMore) => new Uint8Array(),
};

export const underSpecifiedDecryptor: SealDecryptor = {
  decrypt: async (_input: Pick<DecryptParam, 'blobId'>) => new Uint8Array(),
};

type QuoteParam = Parameters<Agent['quote']>[0];
type UnlockParam = Parameters<Agent['unlock']>[0];

export const overSpecifiedQuote: Pick<Agent, 'quote'> = {
  // @ts-expect-error — an implementation of `quote` demanding more than `Agent` promises is REJECTED.
  quote: async (_p: QuoteParam & { readonly __extra: true }) => {
    throw new Error('never called');
  },
};

export const overSpecifiedUnlock: Pick<Agent, 'unlock'> = {
  // @ts-expect-error — same for `unlock`, which spends.
  unlock: async (_p: UnlockParam & { readonly __extra: true }) => {
    throw new Error('never called');
  },
};

type UnlockApproval = Extract<SealApproval, { kind: 'unlock' }>;
type SubscriptionApproval = Extract<SealApproval, { kind: 'subscription' }>;

export type _noOptionalOnUnlockApproval = AssertNever<OptionalKeys<UnlockApproval>>;
export type _noOptionalOnSubscriptionApproval = AssertNever<OptionalKeys<SubscriptionApproval>>;
export type _noOptionalOnSealedRef = AssertNever<OptionalKeys<SealedRef>>;

export type _decryptTakesTheRealSealedRef = AssertTrue<Equal<DecryptParam, SealedRef>>;

// @ts-expect-error — an 'unlock' approval without `vaultId` cannot derive an identity.
export const missingVaultId: SealApproval = { kind: 'unlock', contentKey: 'k', unlockId: '0x1' };

// @ts-expect-error — nor without `contentKey`.
export const missingContentKey: SealApproval = { kind: 'unlock', vaultId: '0x1', unlockId: '0x2' };

// @ts-expect-error — a subscription approval without `period` opens a creator's archive for ever.
export const missingPeriod: SealApproval = {
  kind: 'subscription',
  vaultId: '0x1',
  tier: 0n,
  subscriptionId: '0x2',
};

export const goodApprovals: SealApproval[] = [
  { kind: 'unlock', vaultId: '0x1', contentKey: 'k', unlockId: '0x2' },
  { kind: 'subscription', vaultId: '0x1', tier: 0n, period: 689n, subscriptionId: '0x2', coinType: '0x2::sui::SUI' },
];

type NeedsAKey =
  | 'address'
  | 'sign'
  | 'session'
  | 'openAccount'
  | 'unlock'
  | 'subscribe'
  | 'tip'
  | 'post'
  | 'send'
  | 'balance';

export type _noSigningMemberOnReadOnly = AssertNever<Extract<keyof ReadOnlyAgent, NeedsAKey>>;

export type _keyedAgentHasThemAll = AssertNever<Exclude<NeedsAKey, keyof Agent>>;

export type _readSetIsOnAgent = AssertNever<Exclude<keyof ReadOnlyAgent, keyof Agent>>;

declare const env: Record<string, string | undefined>;

const keyless = createAgent({ keypair: null, config: env });
export type _nullKeyGivesReadOnly = AssertTrue<Equal<typeof keyless, Reading<ReadOnlyAgent>>>;

export function cannotSpendWithoutAKey(agent: ReadOnlyAgent): void {
  // @ts-expect-error — no `unlock` on a read-only agent. A compile error, not a runtime throw.
  void agent.unlock;
  // @ts-expect-error — no `sign` either; a read session is minted by signing.
  void agent.sign;
  // @ts-expect-error — and no `address`, because there is no key to have one.
  void agent.address;
}

export function readsCompileOnEither(agent: ReadOnlyAgent): Promise<unknown> {
  return Promise.all([agent.quote({ vaultId: '0x1', contentKey: 'k' }), agent.balanceOf('0x2'), agent.feed({})]);
}

// @ts-expect-error — `keypair` must be given: a key, or `null` written out.
export const forgotTheKey = createAgent({ config: env });

// @ts-expect-error — `undefined` is refused; `process.env.X` is `string | undefined` and must be checked first.
export const undefinedKey = createAgent({ keypair: env['PROJECTX_SOCIAL_AGENT_SECRET'], config: env });

declare const maybeKey: string | null;
// @ts-expect-error — `string | null` matches neither overload; decide which agent you are building.
export const undecided = createAgent({ keypair: maybeKey, config: env });
