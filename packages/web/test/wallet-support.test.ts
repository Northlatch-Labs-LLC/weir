// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
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

import { describe, expect, it } from 'vitest';
import type { Wallet, WalletAccount } from '@mysten/wallet-standard';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { isUsableWallet, walletSigner, walletSupport } from '@/lib/signer';

/**
 * The smallest thing shaped like a wallet.
 *
 * Only `name`, `chains` and the *keys* of `features` are read, so the values can be empty objects —
 * and the cast stays confined to this helper rather than spread across every case.
 */
function wallet(name: string, chains: string[], features: string[]): Wallet {
  return {
    name,
    chains,
    features: Object.fromEntries(features.map((feature) => [feature, {}])),
  } as unknown as Wallet;
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
  What we hand a wallet, and what we do with what comes back.

  `sui:signTransaction` takes an object it calls `.toJSON()` on. We passed a base64 string, and the
  hand-written cast in `lib/signer.ts` declared `transaction: string` — so `tsc` checked the call
  against our own wrong claim rather than the wallet's contract, and every wallet signature in the
  product died in the browser with `t.transaction.toJSON is not a function`. That blocked handle
  registration end to end.

  A mirrored signature is only safe if something fails when the original moves. Nothing did. These
  are that something: they assert the shape at the call site rather than the shape we wrote down.
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
   * A wallet that records what it was handed and answers the way the standard says: the bytes it
   * actually signed, alongside the signature.
   */
  function signingWallet(reply?: (bytes: string) => { bytes: string; signature: string }) {
    const seen: { transaction?: unknown; account?: unknown; chain?: unknown } = {};
    const handle = {
      name: 'Slush',
      chains: SUI,
      features: {
        'sui:signTransaction': {
          version: '2.0.0',
          async signTransaction(input: { transaction: { toJSON: () => Promise<string> } }) {
            Object.assign(seen, input);
            // The wallet's own round trip: it calls `toJSON`, and a string has no such method.
            const json = await input.transaction.toJSON();
            const rebuilt = toBase64(await Transaction.from(json).build());
            return reply?.(rebuilt) ?? { bytes: rebuilt, signature: 'sig-from-slush' };
          },
        },
      },
    } as unknown as Wallet;
    return { handle, seen };
  }

  const account = { address: `0x${'1'.repeat(64)}` } as unknown as WalletAccount;

  it('hands the wallet a transaction it can serialise, not a base64 string', async () => {
    const bytes = await preparedBytes();
    const slush = signingWallet();

    const signature = await walletSigner({
      wallet: slush.handle,
      account,
      chain: 'sui:mainnet',
    }).signTransaction(bytes);

    expect(typeof (slush.seen.transaction as { toJSON?: unknown })?.toJSON).toBe('function');
    expect(signature).toBe('sig-from-slush');
  });

  /*
    The chain comes from the deployment's configuration and is passed through untouched. A wallet
    connected to testnet has to be able to refuse; a literal here would make that mismatch silent.
  */
  it('passes the account and the configured chain through to the wallet', async () => {
    const bytes = await preparedBytes();
    const slush = signingWallet();

    await walletSigner({ wallet: slush.handle, account, chain: 'sui:mainnet' }).signTransaction(bytes);

    expect(slush.seen.account).toBe(account);
    expect(slush.seen.chain).toBe('sui:mainnet');
  });

  /*
    The gate, stated as a test so it cannot be relaxed by accident.

    A wallet may re-serialise before signing. Submitting our own bytes with its signature produces a
    signature valid for a transaction nobody sends, and the chain refuses it with nothing explaining
    why — after the reader has read a gas quote and approved it.
  */
  it('refuses to return a signature over bytes that are not the ones simulated', async () => {
    const bytes = await preparedBytes();
    const tampered = signingWallet(() => ({ bytes: 'AAAA', signature: 'sig-from-slush' }));

    await expect(
      walletSigner({ wallet: tampered.handle, account, chain: 'sui:mainnet' }).signTransaction(bytes),
    ).rejects.toThrow(/changed the transaction before signing/);
  });

  /*
    The round trip has to be lossless or the gate above fires on every honest wallet. The server
    resolved every input before building — gas coin, budget and price are fixed values — which is
    exactly what makes re-serialising deterministic rather than merely usually equal.
  */
  it('survives the wallet’s own rebuild of the transaction unchanged', async () => {
    const bytes = await preparedBytes();
    const slush = signingWallet();

    await expect(
      walletSigner({ wallet: slush.handle, account, chain: 'sui:mainnet' }).signTransaction(bytes),
    ).resolves.toBe('sig-from-slush');
  });

  it('says which wallet cannot sign rather than failing on an absent feature', async () => {
    const cannot = { name: 'Odd', chains: SUI, features: {} } as unknown as Wallet;

    await expect(
      walletSigner({ wallet: cannot, account, chain: 'sui:mainnet' }).signTransaction('AAAA'),
    ).rejects.toThrow('Odd cannot sign transactions');
  });
});
