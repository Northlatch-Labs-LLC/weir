// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(import.meta.dirname, '..', 'components/Messages.tsx'), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the four key states stay four', () => {
  it.each(['unchecked', 'checking', 'found', 'none', 'failed'])('%s exists', (state) => {
    expect(source).toContain(`'${state}'`);
  });

  it('a failed lookup is never treated as an absent key', () => {
    expect(code).toContain("theirKey.state === 'none'");
    expect(code).toContain("theirKey.state === 'failed'");
  });
});

describe('a price is never printed at an assumed scale', () => {
  it('has no six-decimal arithmetic compiled into it', () => {
    expect(code).not.toMatch(/1_000_000n|1000000n/);
  });

  it('does not name a coin the message might not be priced in', () => {
    expect(code).not.toMatch(/USDC/);
  });

  it('formats against decimals it was given', () => {
    expect(code).toContain('formatUnits');
    expect(code).toMatch(/decimals/);
  });

  it('says so when the scale could not be read, rather than choosing one', () => {
    expect(code).toContain('scale unknown');
  });
});

describe('Send is gated on knowing', () => {
  const canSend = code.slice(code.indexOf('const canSend ='), code.indexOf('const rendered'));

  it('refuses to send when the key could not be read', () => {
    expect(canSend).toMatch(/theirKey\.state !== 'failed'/);
  });

  it('allows plaintext only against a measured absence', () => {
    expect(canSend).toMatch(/theirKey\.state === 'none'/);
  });

  it('requires text and a recipient before either', () => {
    expect(canSend).toMatch(/recipient !== ''/);
    expect(canSend).toMatch(/text\.trim\(\) !== ''/);
  });

  it('drives the button, rather than being computed and ignored', () => {
    expect(code).toMatch(/disabled=\{busy \|\| !canSend\}/);
  });
});

describe('what the sender is told before pressing Send', () => {
  it('says "not measured" for an unreadable key, not "not encrypted"', () => {
    expect(source).toMatch(/Not measured: .*key could not be read/);
    expect(source).toContain('Nothing is sent until it can be');
  });

  it('names plaintext explicitly when the recipient has published no key', () => {
    expect(source).toMatch(/has not\s+published an encryption key, so this will be sent in plaintext/);
  });

  it('says it is still checking rather than defaulting to a badge', () => {
    expect(source).toMatch(/checking .*key/);
  });

  it('promises encryption to both parties, since a sender must read their own thread', () => {
    expect(source).toMatch(/encrypted to\{' '\}\s*\{short\(recipient\)\} and to you/);
  });
});

describe('reading a message', () => {
  it.each(['plain', 'decrypted', 'no-key', 'undecryptable', 'locked'])(
    'keeps %s a distinct outcome',
    (state) => {
      expect(source).toContain(`'${state}'`);
    },
  );

  it('never falls back to showing raw ciphertext', () => {
    expect(code).not.toMatch(/\{m\.ciphertext\}/);
  });
});

describe('the key registry is read from chain, not from this server', () => {
  it('queries the registry route rather than a local table', () => {
    expect(code).toContain('/api/keys');
  });

  it('treats a non-JSON response as a failure rather than as no key', () => {
    expect(code).toMatch(/await r\.text\(\)/);
    expect(code).toMatch(/state: 'failed'/);
  });
});
