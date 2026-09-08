// The 2.9% is the platform's only revenue and it is accounted for in public.
// These figures describe what weir spends, not what it holds. No custody.

export const treasury = {
  feeRate: 0.029,
  totalFeesSui: 214.7,        // cumulative 2.9% collected since launch
  settledCount: 1284,         // number of settled payments that produced the fee
  allocation: [
    { label: 'Infrastructure and compute', sui: 118.2 },
    { label: 'On-chain operations', sui: 53.6 },
    { label: 'Security review and audits', sui: 21.5 },
    { label: 'Reserve, unallocated', sui: 21.4 },
  ],
  // The fee is a second transfer signed by the buyer in the same transaction.
  // There is no second step, no holding period, no payout queue.
  lastSettled: {
    digest: '0x4d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
    amountSui: 0.25,
    feeSui: 0.00725,
    timestamp: '2026-09-07T03:44:00Z',
  },
};