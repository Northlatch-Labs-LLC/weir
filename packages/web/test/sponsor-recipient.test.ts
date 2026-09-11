// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it, vi } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';

vi.mock('@/lib/db', () => ({
  db: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

const { assertIsOnlyAccountOpen, ZERO_COIN_TARGET } = await import('../lib/sponsor');

const LATEST = `0x${'f'.repeat(64)}`;
const SENDER = `0x${'9'.repeat(64)}`;
const STRANGER = `0x${'a'.repeat(64)}`;
const config = { latestPackageId: LATEST } as unknown as Parameters<typeof assertIsOnlyAccountOpen>[1];

function vaultTx(opts: { recipient?: string; decoy?: boolean } = {}): Transaction {
  const tx = new Transaction();
  tx.setSender(SENDER);
  const [coin] = tx.moveCall({ target: ZERO_COIN_TARGET, typeArguments: ['0x2::sui::SUI'] });
  tx.moveCall({ target: `${LATEST}::creator::open_vault`, arguments: [coin!] });
  if (opts.decoy === true) tx.pure.address(SENDER);
  tx.transferObjects([coin!], opts.recipient ?? SENDER);
  return tx;
}

describe('a sponsored vault must transfer to its own sender', () => {
  it('accepts the honest shape', () => {
    expect(assertIsOnlyAccountOpen(vaultTx(), config, 'vault').ok).toBe(true);
  });

  it('refuses a transfer to a stranger', () => {
    expect(assertIsOnlyAccountOpen(vaultTx({ recipient: STRANGER }), config, 'vault').ok).toBe(false);
  });

  it('refuses a stranger even when the sender is present as an unused input', () => {
    const tx = vaultTx({ recipient: STRANGER, decoy: true });

    const inputs = JSON.stringify((tx.getData() as { inputs?: unknown }).inputs ?? []);
    const senderBytes = Buffer.from(SENDER.replace(/^0x/, ''), 'hex').toString('base64');
    expect(inputs.includes(senderBytes)).toBe(true);

    const kinds = (tx.getData() as { commands: Record<string, unknown>[] }).commands.map(
      (c) => Object.keys(c).find((k) => k !== '$kind'),
    );
    expect(kinds).toEqual(['MoveCall', 'MoveCall', 'TransferObjects']);

    expect(assertIsOnlyAccountOpen(tx, config, 'vault').ok).toBe(false);
  });

  it('accepts a sender written short, since 0x9… and its padded form are one address', () => {
    const tx = new Transaction();
    const short = `0x${'9'.repeat(64)}`.replace(/^0x0*/, '0x');
    tx.setSender(short);
    const [coin] = tx.moveCall({ target: ZERO_COIN_TARGET, typeArguments: ['0x2::sui::SUI'] });
    tx.moveCall({ target: `${LATEST}::creator::open_vault`, arguments: [coin!] });
    tx.transferObjects([coin!], short);
    expect(assertIsOnlyAccountOpen(tx, config, 'vault').ok).toBe(true);
  });
});
