// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export const ANNUAL_RATE_PERCENT = { low: 1, high: 2 } as const;

export type RateRange = { readonly low: number; readonly high: number };

function monthlyMultiple(annualPercent: number): number {
  return Math.round(((100 / annualPercent) * 12) / 100) * 100;
}

export function multipleFor(rate: RateRange) {
  return { low: monthlyMultiple(rate.high), high: monthlyMultiple(rate.low) } as const;
}

export const MONTHLY_MULTIPLE = multipleFor(ANNUAL_RATE_PERCENT);

export type VaultClause = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
};

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

export const VAULT_DISCLOSURE: readonly VaultClause[] = vaultDisclosure(ANNUAL_RATE_PERCENT);

export function vaultDisclosureShort(rate: RateRange): string {
  return (
    `Staking pays roughly ${rate.low}–${rate.high} percent a year, set by the network and not ` +
    'promised by anyone. Your principal stays withdrawable in full. The contract is unaudited beta ' +
    'software.'
  );
}

export const VAULT_DISCLOSURE_SHORT = vaultDisclosureShort(ANNUAL_RATE_PERCENT);
