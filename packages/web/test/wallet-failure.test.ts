// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { readWalletFailure, wasDismissed } from '@/lib/wallet-failure';

describe('what a wallet throws, said to the reader', () => {
  it('the EIP-1193 rejection code is a decision, and carries nothing to display', () => {
    const f = readWalletFailure({ code: 4001, message: 'User rejected the request.' });
    expect(f.kind).toBe('dismissed');
    expect(f.say).toBeNull();
    expect(wasDismissed({ code: 4001 })).toBe(true);
  });

  it('wallets that reject in words rather than codes are read the same way', () => {
    for (const message of [
      'User rejected the request',
      'The request was cancelled by user',
      'Rejected by the user.',
      'User denied transaction signature',
    ]) {
      expect(readWalletFailure(new Error(message)).kind, message).toBe('dismissed');
    }
  });

  it('a locked wallet is told to unlock, not shown the extension’s words', () => {
    const f = readWalletFailure(new Error('Wallet is locked'));
    expect(f.kind).toBe('locked');
    expect(f.say).toBe('Unlock your wallet, then press it again.');
    expect(f.say).not.toContain('locked');
  });

  it('the wrong chain names the chain to switch to', () => {
    expect(readWalletFailure(new Error('Unsupported chain requested')).say).toContain('Sui mainnet');
  });

  it('a popup already open sends the reader to it rather than asking twice', () => {
    expect(readWalletFailure(new Error('Request already pending')).kind).toBe('already-pending');
  });

  it('a transport fault is not blamed on the reader', () => {
    expect(readWalletFailure(new TypeError('Failed to fetch')).kind).toBe('offline');
  });

  it('something unrecognised still says what to do, and never shows the raw text', () => {
    const f = readWalletFailure(new Error('0x800f0922 EPARSE'));
    expect(f.kind).toBe('unknown');
    expect(f.say).toBe('That did not go through. Try again, or use a different wallet.');
    expect(f.raw).toContain('0x800f0922');
  });

  it('nothing thrown at all is still answered', () => {
    expect(readWalletFailure(undefined).say).not.toBeNull();
    expect(readWalletFailure(null).kind).toBe('unknown');
  });
});
