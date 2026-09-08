// Viewer state — fetched once per session, not per post.
// Two variants so pages render both signed-in and signed-out with real data.

// Becoming a creator is a separate act from registering. A profile has no
// vault until it opens one; every surface must survive a null vault.

export type Period = 'month' | 'year';

export type Tier = {
  id: string;
  priceSui: number;
  period: Period;
};

export type Perk = {
  id: string;
  title: string;
  detail: string;
  thresholdSui: number;
};

export type CreatorVault = {
  address: string;
  earningsSui: number;   // what the creator can claim
  feesSui: number;       // the platform's 2.9%, a separate object
  settled30d: number;    // gross settled in the last 30 days
  supporters: number;
};

export type CreatorState = {
  vault: CreatorVault | null;
  tiers: Tier[];
  perks: Perk[];
};

export const viewerSignedOut = {
  signedIn: false as const,
  address: null,
  handle: null,
  displayName: null,
  holds: [] as string[],
  subscribedTo: [] as string[],
  creator: { vault: null, tiers: [], perks: [] } as CreatorState,
};

export const viewerSignedIn = {
  signedIn: true as const,
  address: '0x7fa2c1e4b3a6d9f0e21b5c8a4d0f9e7b6a2c1d3e4f5a6b7c8d9e0f1a2b3c4d5e',
  handle: 'ilse',
  displayName: 'Ilse Rautio',
  holds: ['post_0144', 'post_0140'],        // locked posts purchased
  subscribedTo: ['nadia-okafor'],
  vault: {
    address: '0x7fa2c1e4b3a6d9f0e21b5c8a4d0f9e7b6a2c1d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    balanceSui: 4.812,
    inflow30d: 0.4,
    outflow30d: 1.3,
    entries: 6,
    supporters: 1,
  },
  // digests of settled payments this viewer made — link to /receipt/:digest
  receipts: [
    '0x9a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    '0x3f8b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b',
  ],
  // A profile has no creator vault until it opens one. The demo reader has
  // not yet become a creator, so the vault is null and tiers/perks are empty.
  creator: { vault: null, tiers: [], perks: [] } as CreatorState,
};

export type Viewer = typeof viewerSignedIn | typeof viewerSignedOut;