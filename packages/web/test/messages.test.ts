// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * `Messages` — the encryption surface, and the downgrade it must never perform silently.
 *
 * This component has already produced the exact bug it now guards against. `/api/keys` returned
 * 500 on a non-hex address, the key lookup stuck on "checking", and the Send button stayed enabled
 * — so a message the user believed was encrypted went out in plaintext with nothing on screen
 * saying so. Nothing threw. Nothing logged.
 *
 * The fix was to make the four key states distinct and to gate Send on them. These tests pin that
 * gate, by reading the source: the condition is a single expression, and the ways it goes wrong are
 * substitutions a compiler is happy with.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(import.meta.dirname, '..', 'components/Messages.tsx'), 'utf8');
/** Comments describe the defect; they are not the defect. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the four key states stay four', () => {
  it.each(['unchecked', 'checking', 'found', 'none', 'failed'])('%s exists', (state) => {
    /*
     * `none` and `failed` are the pair that matters. "They have published no key" is a fact the
     * sender can act on — plaintext is the honest option. "We could not read the registry" is not,
     * and collapsing the two turns an outage into consent.
     */
    expect(source).toContain(`'${state}'`);
  });

  it('a failed lookup is never treated as an absent key', () => {
    // The literal collapse: `state !== 'found'` standing in for both.
    expect(code).toContain("theirKey.state === 'none'");
    expect(code).toContain("theirKey.state === 'failed'");
  });
});

/**
 * A locked message states a price, and a price is meaningless without its scale.
 *
 * The component formatted one with `1_000_000n` compiled in and the word USDC written beside it, so
 * a message priced in any other coin was displayed at the wrong magnitude under the wrong name.
 * Nothing threw; the number simply lied. This is the same defect that was fixed in `explore`, on
 * the creator page, on the home page and in notifications — this file was the fourth of four.
 */
describe('a price is never printed at an assumed scale', () => {
  it('has no six-decimal arithmetic compiled into it', () => {
    expect(code).not.toMatch(/1_000_000n|1000000n/);
  });

  it('does not name a coin the message might not be priced in', () => {
    // The symbol arrives with the price, from the vault's own type tag.
    expect(code).not.toMatch(/USDC/);
  });

  it('formats against decimals it was given', () => {
    expect(code).toContain('formatUnits');
    expect(code).toMatch(/decimals/);
  });

  it('says so when the scale could not be read, rather than choosing one', () => {
    /*
      `readScales` yields `decimals: null` for a coin whose metadata is unreadable. Rendering that
      as a number would be the original bug wearing a plumbing diagram — the absence has to reach
      the screen.
    */
    expect(code).toContain('scale unknown');
  });
});

describe('Send is gated on knowing', () => {
  const canSend = code.slice(code.indexOf('const canSend ='), code.indexOf('const rendered'));

  it('refuses to send when the key could not be read', () => {
    // The precise regression. With a secret enabled and an unreadable key, neither "encrypted" nor
    // "plaintext" is known to be true, so the only safe answer is to send nothing.
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
    /*
     * A badge is a claim. "Not encrypted" asserts the message will go in plaintext, which is a
     * different statement from "we do not know", and only one of them is true here.
     */
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
      /*
       * "I have no key on this device", "this ciphertext will not open", and "this is paid content
       * I have not bought" are three different problems with three different remedies. Rendering
       * them as one empty bubble would send everybody to the wrong fix.
       */
      expect(source).toContain(`'${state}'`);
    },
  );

  it('never falls back to showing raw ciphertext', () => {
    // An undecryptable message renders as a stated failure, not as base64 the reader might paste
    // somewhere trying to make sense of it.
    expect(code).not.toMatch(/\{m\.ciphertext\}/);
  });
});

describe('the key registry is read from chain, not from this server', () => {
  it('queries the registry route rather than a local table', () => {
    expect(code).toContain('/api/keys');
  });

  it('treats a non-JSON response as a failure rather than as no key', () => {
    // The original bug: a 500 rejected inside `r.json()` and left the state on "checking", which
    // read as harmless while Send fell through to plaintext.
    expect(code).toMatch(/await r\.text\(\)/);
    expect(code).toMatch(/state: 'failed'/);
  });
});
