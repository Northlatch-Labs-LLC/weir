// A name is an on-chain object its owner holds. These fixtures seed the names
// the demo reader already owns. The availability check also treats existing
// creator handles as taken, so a search never offers a name someone holds.

export type OwnedNameFixture = {
  name: string;
  owner: string;
  pointsTo: string | null;
  registeredAt: string;
};

export const ownedNames: OwnedNameFixture[] = [
  {
    name: 'ilse',
    owner: '0x7fa2c1e4b3a6d9f0e21b5c8a4d0f9e7b6a2c1d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    pointsTo: '0x7fa2c1e4b3a6d9f0e21b5c8a4d0f9e7b6a2c1d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    registeredAt: '2025-07-01',
  },
  {
    name: 'rautio',
    owner: '0x7fa2c1e4b3a6d9f0e21b5c8a4d0f9e7b6a2c1d3e4f5a6b7c8d9e0f1a2b3c4d5e',
    pointsTo: null,
    registeredAt: '2025-07-03',
  },
];