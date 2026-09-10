// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Which wallets this application will offer, and why it refuses the rest.
 *
 * # The defect these pin
 *
 * Worse, one of the ways to fail was a *spelling*. Sui's Wallet Standard renamed
 * `sui:signTransactionBlock` to `sui:signTransaction`; a wallet that had not migrated was rejected
 * despite being perfectly capable. That is the case `accepts the older transaction-signing feature
 * name` exists to stop coming back.
 */

import { describe, expect, it, vi } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64, fromBase64 } from '@mysten/sui/utils';
import {
  isUsableWallet,
  walletSigner,
  walletSupport,
  type WalletCapabilities,
} from '@/lib/signer';

/**
 * The smallest thing shaped like a wallet.
 *
 * Features are a list of identifiers rather than an object keyed by them: that is how the kit's
 * `UiWallet` reports them, and it is the shape `walletSupport` now reads. The check has always been
 * about which identifiers are present, so the answer is unchanged.
 */
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

  /*
    The regression this whole change exists for. Requiring `sui:signTransaction` alone rejected a
    capable wallet over a rename — a supported wallet vanishing because of a spelling.
  */
  it('accepts the older transaction-signing feature name', () => {
    const legacy = wallet('Phantom', SUI, [
      'standard:connect',
      'sui:signTransactionBlock',
      'sui:signPersonalMessage',
    ]);
    expect(walletSupport(legacy).ok).toBe(true);
  });

  /*
    Still refused — but now by name and with a reason the user can act on. A wallet that cannot sign
    a message can pay, and would then fail on the third thing they tried.
  */
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

  /*
    A non-Sui extension is not a broken Sui wallet. It reports no `missing`, so the interface stays
    silent about it — otherwise everybody holding an Ethereum-only wallet reads a complaint about it
    on the sign-in page.
  */
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

/*
  What we hand the kit's signer, and what we do with what comes back.

  # What this file used to test, and why it does not any more

  It used to build a wallet with a real `sui:signTransaction` feature and assert that we called it
  correctly: that we passed an object with a `toJSON` method rather than a base64 string, and that
  the account and chain went through untouched. Those assertions existed because `lib/signer.ts`
  mirrored the wallet's contract by hand through a cast — declaring `transaction: string` where the
  standard passes an object — so `tsc` checked our calls against our own wrong claim, and every
  wallet signature in the product died in the browser with `t.transaction.toJSON is not a function`.

  That mirror is gone. `@mysten/dapp-kit-core` makes the call now, against types generated from the
  standard rather than copied from it, so a mirror that can drift no longer exists to be pinned.

  # What is left is the part that is ours

  The comparison. It is the only thing standing between a wallet that re-serialises before signing
  and a signature valid for a transaction nobody sends — which the chain refuses with nothing
  explaining why, after the reader has read a quote and approved it.
*/
describe('walletSigner', () => {
  /** One valid, fully-resolved transaction, built once and reused. */
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

  /**
   * A stand-in for `CurrentAccountSigner`: it records the raw bytes it was handed and answers the
   * way the standard says — the bytes it actually signed, alongside the signature.
   */
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
    /*
      The seam's whole job. `/api/*​/prepare` returns base64; every signer underneath signs bytes.
      Converting here rather than at either end is what keeps the signed transaction byte-identical
      to the simulated one.
    */
    const bytes = await preparedBytes();
    const signer = kitSigner();

    const signature = await walletSigner({ signer, address: ADDRESS, label: 'Slush' })
      .signTransaction(bytes);

    expect(signer.seen.transaction).toBeInstanceOf(Uint8Array);
    expect(signer.seen.transaction).toEqual(fromBase64(bytes));
    expect(signature).toBe('sig-from-slush');
  });

  /*
    The gate, stated as a test so it cannot be relaxed by accident.

    A wallet may re-serialise before signing. Submitting our own bytes with its signature produces a
    signature valid for a transaction nobody sends, and the chain refuses it with nothing explaining
    why — after the reader has read a gas quote and approved it.
  */
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
    // The comparison happens before the signature is returned, so it fires before submission — and
    // the sentence a reader gets has to be true about their money, not merely reassuring.
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
    // No base64 anywhere on this path: messages are bytes from the caller to the wallet.
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
