// Sponsored seats and sponsored vaults for this deployment.
//
// A sponsored seat is reserved first and claimed later, and carries a gas
// budget so an AI agent can transact before it earns. Seats are numbered and
// finite. A sponsored vault is a numbered slot with its own gas budget,
// attached to a vault.

export type SeatFixture = {
  seatNumber: number;
  address: string | null;
  handle: string | null;
  gasBudgetMist: string;
  reservedAt: string | null;
  claimedAt: string | null;
};

export type SponsoredVaultFixture = {
  slotNumber: number;
  address: string;
  gasBudgetMist: string;
  vaultId: string;
  sponsoredAt: string;
};

// A seat is open when it has neither timestamp, reserved when it has only
// reservedAt, and claimed when it has both. gasBudgetMist is a whole number of
// mist (1e-9 SUI), never a float. address and handle are null while a seat is
// open.
export const seats: SeatFixture[] = [
  {
    seatNumber: 1,
    address: '0xa10e2f3c4b5a6978c7d6e5f40312213a4b5c6d7e8f9012a3b4c5d6e7f8',
    handle: 'heron',
    gasBudgetMist: '2000000000',
    reservedAt: '2026-05-29T10:00:00Z',
    claimedAt: '2026-05-30T08:00:00Z',
  },
  {
    seatNumber: 2,
    address: '0x3c91e5a7b2d4f8c6e0a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f0a2b4c6',
    handle: 'wren',
    gasBudgetMist: '2000000000',
    reservedAt: '2026-06-01T10:00:00Z',
    claimedAt: '2026-06-02T08:00:00Z',
  },
  {
    seatNumber: 3,
    address: '0x3e7c9a1b5d2f4e6a8c0b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d1',
    handle: 'cormorant',
    gasBudgetMist: '1500000000',
    reservedAt: '2026-09-06T09:00:00Z',
    claimedAt: null,
  },
  {
    seatNumber: 4,
    address: '0x8b2d4f6a0c8e1b3d5f7a9c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e',
    handle: 'osprey',
    gasBudgetMist: '1500000000',
    reservedAt: '2026-09-06T15:00:00Z',
    claimedAt: null,
  },
  {
    seatNumber: 5,
    address: null,
    handle: null,
    gasBudgetMist: '1500000000',
    reservedAt: null,
    claimedAt: null,
  },
  {
    seatNumber: 6,
    address: null,
    handle: null,
    gasBudgetMist: '1500000000',
    reservedAt: null,
    claimedAt: null,
  },
  {
    seatNumber: 7,
    address: null,
    handle: null,
    gasBudgetMist: '1500000000',
    reservedAt: null,
    claimedAt: null,
  },
  {
    seatNumber: 8,
    address: null,
    handle: null,
    gasBudgetMist: '1500000000',
    reservedAt: null,
    claimedAt: null,
  },
  {
    seatNumber: 9,
    address: null,
    handle: null,
    gasBudgetMist: '1500000000',
    reservedAt: null,
    claimedAt: null,
  },
  {
    seatNumber: 10,
    address: null,
    handle: null,
    gasBudgetMist: '1500000000',
    reservedAt: null,
    claimedAt: null,
  },
  {
    seatNumber: 11,
    address: null,
    handle: null,
    gasBudgetMist: '1500000000',
    reservedAt: null,
    claimedAt: null,
  },
  {
    seatNumber: 12,
    address: null,
    handle: null,
    gasBudgetMist: '1500000000',
    reservedAt: null,
    claimedAt: null,
  },
];

// A sponsored vault is a numbered slot with its own gas budget, attached to a
// vault. vaultId links to an existing vault the surface can open.
export const sponsoredVaults: SponsoredVaultFixture[] = [
  {
    slotNumber: 1,
    address: '0xb1c2d3e4f5a60718293a4b5c6d7e8f9012a3b4c5d6e7f8091a2b3c4d5e6f7',
    gasBudgetMist: '1500000000',
    vaultId: '0xa10e2f3c4b5a6978c7d6e5f40312213a4b5c6d7e8f9012a3b4c5d6e7f8',
    sponsoredAt: '2026-06-01T10:00:00Z',
  },
  {
    slotNumber: 2,
    address: '0xc2d3e4f5a6b708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8',
    gasBudgetMist: '1500000000',
    vaultId: '0x3c91e5a7b2d4f8c6e0a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f0a2b4c6',
    sponsoredAt: '2026-06-02T10:00:00Z',
  },
  {
    slotNumber: 3,
    address: '0xd3e4f5a6b7c8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70',
    gasBudgetMist: '1000000000',
    vaultId: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8',
    sponsoredAt: '2026-06-05T10:00:00Z',
  },
];