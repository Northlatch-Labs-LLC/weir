// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it, vi } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64, fromBase64 } from '@mysten/sui/utils';
import {
  isUsableWallet,
  walletSigner,
  walletSupport,
  type WalletCapabilities,
} from '@/lib/signer';

function wallet(name: string, chains: string[], features: string[]): WalletCapabilities & { name: string } {
  return { name, chains, features };
}

const SUI = ['sui:mainnet'];
const MODERN = ['standard:connect', 'sui:signTransaction', 'sui:signPersonalMessage'];

describe('walletSupport', () => {
  it('accepts a wallet carrying the current feature names', () => {
    expect(walletSupport(wallet('Slush', SUI, MODERN))).toEqual({ ok: true, missing: [] });
    expect(isUsableWallet(wallet('Slush', SUI, MODERN))).toBe(true);
  });

  it('accepts the older transaction-signing feature name', () => {
    const legacy = wallet('Phantom', SUI, [
      'standard:connect',
      'sui:signTransactionBlock',
      'sui:signPersonalMessage',
    ]);
    expect(walletSupport(legacy).ok).toBe(true);
  });

  it('names what a wallet is missing rather than dropping it', () => {
    const noMessages = wallet('Phantom', SUI, ['standard:connect', 'sui:signTransaction']);
    expect(walletSupport(noMessages)).toEqual({ ok: false, missing: ['signing messages'] });
  });

  it('reports every missing capability, not just the first', () => {
    expect(walletSupport(wallet('Half', SUI, ['standard:connect'])).missing).toEqual([
      'signing transactions',
      'signing messages',
    ]);
  });

  it('says nothing about a wallet for another chain', () => {
    const ethereum = wallet('SomeEvmWallet', ['eip155:1'], ['standard:connect']);
    expect(walletSupport(ethereum)).toEqual({ ok: false, missing: [] });
    expect(isUsableWallet(ethereum)).toBe(false);
  });

  it('refuses a wallet that cannot connect at all', () => {
    const noConnect = wallet('Odd', SUI, ['sui:signTransaction', 'sui:signPersonalMessage']);
    expect(walletSupport(noConnect).missing).toEqual(['connecting']);
  });
});

describe('walletSigner', () => {
  async function preparedBytes(): Promise<string> {
    const tx = new Transaction();
    tx.setSender(`0x${'1'.repeat(64)}`);
    tx.setGasPrice(1000n);
    tx.setGasBudget(2_000_000n);
    tx.setGasPayment([
      { objectId: `0x${'a'.repeat(64)}`, version: '1', digest: '11111111111111111111111111111111' },
    ]);
    return toBase64(await tx.build());
  }

  function kitSigner(reply?: (bytes: string) => { bytes: string; signature: string }) {
    const seen: { transaction?: Uint8Array; message?: Uint8Array } = {};
    return {
      seen,
      signTransaction: vi.fn(async (bytes: Uint8Array) => {
        seen.transaction = bytes;
        const echoed = toBase64(bytes);
        return reply?.(echoed) ?? { bytes: echoed, signature: 'sig-from-slush' };
      }),
      signPersonalMessage: vi.fn(async (bytes: Uint8Array) => {
        seen.message = bytes;
        return { signature: 'msg-sig' };
      }),
    };
  }

  const ADDRESS = `0x${'1'.repeat(64)}`;

  it('hands the kit raw bytes, not the base64 the server produced', async () => {
    const bytes = await preparedBytes();
    const signer = kitSigner();

    const signature = await walletSigner({ signer, address: ADDRESS, label: 'Slush' })
      .signTransaction(bytes);

    expect(signer.seen.transaction).toBeInstanceOf(Uint8Array);
    expect(signer.seen.transaction).toEqual(fromBase64(bytes));
    expect(signature).toBe('sig-from-slush');
  });

  it('refuses to return a signature over bytes that are not the ones simulated', async () => {
    const bytes = await preparedBytes();
    const tampered = kitSigner(() => ({ bytes: 'AAAA', signature: 'sig-from-slush' }));

    await expect(
      walletSigner({ signer: tampered, address: ADDRESS, label: 'Slush' }).signTransaction(bytes),
    ).rejects.toThrow(/changed the transaction before signing/);
  });

  it('names the wallet in that refusal, because the reader has to know which one to distrust', async () => {
    const bytes = await preparedBytes();
    const tampered = kitSigner(() => ({ bytes: 'AAAA', signature: 'x' }));

    await expect(
      walletSigner({ signer: tampered, address: ADDRESS, label: 'Phantom' }).signTransaction(bytes),
    ).rejects.toThrow(/^Phantom changed/);
  });

  it('says nothing was submitted, because nothing was', async () => {
    const bytes = await preparedBytes();
    const tampered = kitSigner(() => ({ bytes: 'AAAA', signature: 'x' }));

    await expect(
      walletSigner({ signer: tampered, address: ADDRESS, label: 'Slush' }).signTransaction(bytes),
    ).rejects.toThrow(/Nothing has been submitted/);
  });

  it('passes an honest round trip through unchanged', async () => {
    const bytes = await preparedBytes();

    await expect(
      walletSigner({ signer: kitSigner(), address: ADDRESS, label: 'Slush' }).signTransaction(bytes),
    ).resolves.toBe('sig-from-slush');
  });

  it('passes a personal message through as the raw bytes it was given', async () => {
    const signer = kitSigner();
    const message = new TextEncoder().encode('read:0xabc');

    const signature = await walletSigner({ signer, address: ADDRESS, label: 'Slush' })
      .signPersonalMessage(message);

    expect(signer.seen.message).toEqual(message);
    expect(signature).toBe('msg-sig');
  });

  it('reports the address and label it was built with', async () => {
    const active = walletSigner({ signer: kitSigner(), address: ADDRESS, label: 'Slush' });
    expect(active).toMatchObject({ kind: 'wallet', address: ADDRESS, label: 'Slush' });
  });
});
