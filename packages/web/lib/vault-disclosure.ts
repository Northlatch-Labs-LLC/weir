// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * What a supporter is told before they deposit into a vault, and where the figures in it come from.
 *
 * # Why this is a module and not paragraphs on a page
 *
 * Every fact below was already true and already written down — in `content/legal/terms.md`, at
 * 1.3 (not a deposit account, not a security, staking rewards are the network's and are not
 * interest), 9.1 (the contracts are unaudited beta software and a defect could lose funds) and
 * 9.3 (the rate depends on validator performance, may be zero, and nothing here projects it).
 *
 * Section 9 of a terms document is not where somebody decides. The vault page said the mechanics
 * honestly and said nothing at all about magnitude or risk, so a supporter could read the whole
 * page, understand it correctly, and still be picturing money that this mechanism cannot produce.
 * Putting the clauses in one object and rendering them at the point of deposit is the whole of the
 * change; the terms are unchanged and remain the agreement.
 *
 * # The magnitude is the point, and it is derived rather than typed
 *
 * `lib/stake.ts` has said since it was written that a monthly amount of yield needs roughly eight
 * hundred times that amount delegated. That sentence lived in a doc comment, where the person it
 * was written for cannot read it.
 *
 * The range below is the network's, not this deployment's: Sui's staking rewards are set by the
 * protocol and the validator's commission, they move every epoch, and no figure read here would be
 * right for long. So a RANGE is published with its source named, and the multiple a reader actually
 * needs is COMPUTED from it. Writing "800×" beside "1–2% a year" would be two numbers that can
 * drift apart, which is the defect class `scale-guard.test.ts` exists for.
 *
 * # What is deliberately not said
 *
 * None of the vocabulary recommendation 23 forbids: no annualised-rate abbreviation, no "returns",
 * no interest-earning phrase, no "guaranteed", no investment framing, no deposit-account word.
 * (`test/vault-language.test.ts` holds the exact list, and reads this comment too, which is why
 * the words are described here rather than quoted.) Not because a disclaimer would be caught by the
 * language guard, but because the words are unnecessary: "nobody promises it" and "this is not
 * income" say the same thing without borrowing the register of the thing being disclaimed.
 */

/**
 * The annual staking rate, as a range, attributed to the network rather than to this platform.
 *
 * A range and not a figure because it is not ours to state precisely: the protocol sets it, the
 * validator's commission comes off it, and it changes every epoch. Sui's has run at roughly one to
 * two percent a year.
 */
export const ANNUAL_RATE_PERCENT = { low: 1, high: 2 } as const;

export type RateRange = { readonly low: number; readonly high: number };

/**
 * How many times a monthly amount must be delegated to produce it, at each end of the range.
 *
 * Derived, never written: `100 / percent * 12` months. At 2% a year that is 600×, at 1% it is
 * 1200×. Rounded to the nearest hundred, because a figure like 1,183 would claim a precision the
 * range it came from does not have.
 */
function monthlyMultiple(annualPercent: number): number {
  return Math.round(((100 / annualPercent) * 12) / 100) * 100;
}

export function multipleFor(rate: RateRange) {
  return { low: monthlyMultiple(rate.high), high: monthlyMultiple(rate.low) } as const;
}

export const MONTHLY_MULTIPLE = multipleFor(ANNUAL_RATE_PERCENT);

export type VaultClause = {
  /** Stable across rewording. Tests and the page both address a clause by this, never by its prose. */
  readonly id: string;
  readonly title: string;
  readonly body: string;
};

/**
 * The clauses, built from a rate range rather than written against one.
 *
 * # Why this takes the rate as an argument
 *
 * The first version of this module interpolated the module-level constants directly, and the test
 * that claimed to prove the figures were derived only proved they equalled today's numbers. A
 * mutation replacing `${MONTHLY_MULTIPLE.low}` with the literal `600` survived it, because 600 is
 * what that expression evaluates to — which is precisely the state a hardcoded figure is in on the
 * day it is written, and precisely the drift that appears the day the range moves.
 *
 * Taking the range as a parameter lets the test build the clauses from a DIFFERENT range and watch
 * the sentence follow. A hand-typed figure cannot follow, so it dies.
 */
export function vaultDisclosure(rate: RateRange): readonly VaultClause[] {
  const multiple = multipleFor(rate);
  const times = (n: number) => n.toLocaleString('en-US');

  return [
    {
      id: 'principal',
      title: 'Your deposit stays yours',
      body:
        'It is withdrawable in full at any time, with no lock-up, no notice period and no approval ' +
        'step. Only the staking yield it generates goes to the creator, never the principal. If the ' +
        'vault is short of liquid balance, withdrawing unwinds delegated stake in the same ' +
        'transaction — the forgone yield is the creator’s loss, not yours.',
    },
    {
      id: 'magnitude',
      title: 'How much this actually earns',
      body:
        'Sui’s staking rewards are set by the network and by the validator’s commission, not by ' +
        `Weir, and have run at roughly ${rate.low} to ${rate.high} percent a year. At that rate a ` +
        `vault needs somewhere between ${times(multiple.low)} and ${times(multiple.high)} times an ` +
        'amount sitting in it to hand that amount back over a month, before the creator’s share of ' +
        'it. This is a way to back someone at no cost to yourself. It is not income, and it is not ' +
        'a substitute for paying them.',
    },
    {
      id: 'not-promised',
      title: 'Nobody promises the rate',
      body:
        'It depends on validator performance and network conditions and it can be zero. Nothing on ' +
        'this page is a projection, and no figure here is owed to you by anyone.',
    },
    {
      id: 'contract-risk',
      title: 'The contract is beta software and is not audited',
      body:
        'The no-loss property is enforced by code, and code can be wrong. The contracts have not ' +
        'been independently audited. A defect in them, in the Sui network, or in a validator could ' +
        'delay or lose access to funds. There is no function by which Weir or a creator can move a ' +
        'supporter’s principal, which is a property of the contract rather than a promise from us.',
    },
    {
      id: 'what-this-is-not',
      title: 'What this is not',
      body:
        'Not a deposit account, not a security, and not financial advice. The rewards come from the ' +
        'Sui network’s delegated proof-of-stake, and they are not interest.',
    },
  ];
}

/**
 * The clauses this deployment renders — the builder above, applied to the published range.
 *
 * The page imports this and never the builder; the builder exists so the test can watch a
 * different range produce a different sentence.
 */
export const VAULT_DISCLOSURE: readonly VaultClause[] = vaultDisclosure(ANNUAL_RATE_PERCENT);

/**
 * The one-line form, for the moment of signature where a five-clause panel would be scrolled past.
 *
 * Built from the same range for the same reason.
 */
export function vaultDisclosureShort(rate: RateRange): string {
  return (
    `Staking pays roughly ${rate.low}–${rate.high} percent a year, set by the network and not ` +
    'promised by anyone. Your principal stays withdrawable in full. The contract is unaudited beta ' +
    'software.'
  );
}

export const VAULT_DISCLOSURE_SHORT = vaultDisclosureShort(ANNUAL_RATE_PERCENT);
