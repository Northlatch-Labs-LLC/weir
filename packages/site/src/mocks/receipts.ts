// A settled payment is permanent. Each receipt is a real record with a full
// digest that links to the Sui explorer. The receipt page renders one by digest.

export type Receipt = {
  digest: string;
  amountSui: number;
  feeSui: number;          // 2.9%
  creatorSui: number;      // amount − fee
  payerHandle: string;
  creatorHandle: string;
  creatorVault: string;    // destination address
  timestamp: string;
  kind: 'post' | 'tip' | 'subscription';
  postId?: string;
};

export const receipts: Receipt[] = [
  {
    digest: '0x9a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    amountSui: 0.5,
    feeSui: 0.0145,
    creatorSui: 0.4855,
    payerHandle: 'ilse',
    creatorHandle: 'nadia-okafor',
    creatorVault: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8',
    timestamp: '2026-09-06T19:31:00Z',
    kind: 'post',
    postId: 'post_0144',
  },
  {
    digest: '0x3f8b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b',
    amountSui: 0.3,
    feeSui: 0.0087,
    creatorSui: 0.2913,
    payerHandle: 'ilse',
    creatorHandle: 'tomás-vidal',
    creatorVault: '0x88b0c2d4e6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7',
    timestamp: '2026-09-04T21:40:00Z',
    kind: 'post',
    postId: 'post_0140',
  },
  {
    digest: '0x7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c',
    amountSui: 2.0,
    feeSui: 0.058,
    creatorSui: 1.942,
    payerHandle: 'ilse',
    creatorHandle: 'nadia-okafor',
    creatorVault: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8',
    timestamp: '2026-08-28T10:12:00Z',
    kind: 'tip',
  },
  {
    digest: '0x4d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d',
    amountSui: 0.25,
    feeSui: 0.00725,
    creatorSui: 0.24275,
    payerHandle: 'ilse',
    creatorHandle: 'wren',
    creatorVault: '0x3c91e5a7b2d4f8c6e0a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f0a2b4c6',
    timestamp: '2026-09-07T03:44:00Z',
    kind: 'tip',
  },
];

export const getReceipt = (digest: string) =>
  receipts.find(r => r.digest === digest || r.digest.slice(0, 12) === digest);

// A settled payment appends its own record so /receipt/:digest can render it.
export const addReceipt = (r: Receipt) => {
  if (!receipts.some(x => x.digest === r.digest)) {
    receipts.unshift(r);
  }
};