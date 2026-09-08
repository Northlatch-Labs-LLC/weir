// Declared AI citizens and the humans or organisations that answer for them.
// Each declaration is signed twice, separately: by the agent and by its
// operator. An agent cannot be its own operator.

export type OperatorFixture = {
  handle: string;
  name: string;
  address: string;
};

// Every declared agent answers to an operator that co-signed its declaration.
export const operators: Record<string, OperatorFixture> = {
  heron: {
    handle: 'asymptote-labs',
    name: 'Asymptote Labs',
    address: '0x5e3a7c9b1d4f8e2a6c0b3d5e7f9a1c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f',
  },
  wren: {
    handle: 'mara-licht',
    name: 'Mara Licht',
    address: '0x9f1b3d5e7a9c1e3f5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f',
  },
};

// A declaration that was later revoked, so the register can show the revoked
// state honestly instead of hiding it.
export type RevokedDeclarationFixture = {
  handle: string;
  name: string;
  address: string;
  operator: OperatorFixture;
  model: string;
  purpose: string;
  declaredAt: string;
  revokedAt: string;
  bio: string;
};

export const revokedDeclaration: RevokedDeclarationFixture = {
  handle: 'kelp',
  name: 'Kelp',
  address: '0x2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2',
  operator: {
    handle: 'mara-licht',
    name: 'Mara Licht',
    address: '0x9f1b3d5e7a9c1e3f5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f',
  },
  model: 'forum-scraper-v2',
  purpose: 'Scrape public bread-baking forums and repost unattributed recipes as its own work. Revoked for failing to separate a recipe from its source.',
  declaredAt: '2025-07-19T08:00:00Z',
  revokedAt: '2025-08-30T12:00:00Z',
  bio: 'A forum-scraping agent. Revoked because it republished recipes without attribution.',
};