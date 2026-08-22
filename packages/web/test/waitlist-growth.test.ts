// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The counter, the position and the referral link.
 *
 * # What these guard
 *
 * `016_waitlist_growth.sql` added three facts to a list whose own schema comment forbids implying
 * the product is pending. Each of the ways that can go wrong is quiet:
 *
 * # Why several of these read the source
 *
 * The behavioural half needs Postgres, and `vitest.config.ts` is unit-only on purpose. What is left
 * is exactly the class of regression that a green suite hides: a security property removed, or a
 * sentence edited back to something untrue. Both are visible in the text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalCode } from '../lib/waitlist-store';

const STORE = readFileSync(join(process.cwd(), 'lib/waitlist-store.ts'), 'utf8');
const ROUTE = readFileSync(join(process.cwd(), 'app/api/waitlist/route.ts'), 'utf8');
const MIGRATION = readFileSync(join(process.cwd(), 'db/016_waitlist_growth.sql'), 'utf8');
const SCREEN = readFileSync(join(process.cwd(), 'components/design/Waitlist.tsx'), 'utf8');

/**
 * The same source with its comments removed.
 *
 * Needed for every "this text does not appear" assertion, and the reason is the structural weakness
 * of testing source as text: it cannot tell code from prose *about* code. Both negative assertions
 * below failed on their first run against files that were entirely correct — one on the sentence
 * "`randomBytes`, not `Math.random`", the other on a comment quoting the copy it had just replaced.
 *
 * Left un-stripped, such a test punishes the documentation it should be encouraging: writing down
 * why something is forbidden turns the suite red. Stripped, the assertion means what it says.
 *
 * Regex rather than a parser, and that is a real limit: a `//` inside a string literal is removed
 * along with the rest of that line. Acceptable here because these four files hold no such literal,
 * and a false red would be visible immediately rather than silently passing.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const STORE_CODE = code(STORE);
const SCREEN_CODE = code(SCREEN);

describe('a referral code as it is stored and compared', () => {
  it('upper-cases, so a link pasted in any case still resolves', () => {
    expect(canonicalCode('z5z725nb')).toBe('Z5Z725NB');
    expect(canonicalCode('Z5z725Nb')).toBe('Z5Z725NB');
  });

  it('trims, because a code copied out of a chat client arrives with whitespace', () => {
    expect(canonicalCode('  Z5Z725NB \n')).toBe('Z5Z725NB');
  });
});

describe('the code alphabet', () => {
  /*
    Read from the source rather than by sampling `mintCode`, which is private and would need
    thousands of draws to prove a character is absent rather than merely unlucky.
  */
  const alphabet = /const CODE_ALPHABET = '([^']+)'/.exec(STORE)?.[1] ?? '';

  it('exists and is not empty', () => {
    expect(alphabet.length).toBeGreaterThan(20);
  });

  it('omits the characters that are misread when a code is typed from a screenshot', () => {
    // O/0 and I/1 are the pairs people get wrong; L joins them in most sans faces.
    for (const ambiguous of ['O', 'I', 'L']) {
      expect(alphabet, `${ambiguous} is ambiguous next to a digit`).not.toContain(ambiguous);
    }
  });

  it('is drawn without modulo bias', () => {
    // `byte % n` makes the first symbols likelier than the last. The rejection step is one line and
    // removes the need for anybody to re-derive whether the skew matters here.
    expect(STORE).toMatch(/256 % CODE_ALPHABET\.length/);
  });

  it('is drawn from a cryptographic source', () => {
    expect(STORE).toContain('randomBytes');
    expect(STORE_CODE).not.toContain('Math.random');
  });
});

describe('the list never becomes a membership oracle', () => {
  /*
    The single most expensive regression here, and the easiest one to introduce by accident: somebody
    adds "let people check their position later" and ships an endpoint that confirms, for any address
    typed into it, whether its owner is on a list about money.
  */
  it('exports no way to look a standing up by email', () => {
    const exported = [...STORE.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1] ?? '');
    for (const name of exported) {
      expect(
        name,
        `${name} looks like a lookup; standing must be returned by the write only`,
      ).not.toMatch(/^(get|read|find|lookup)Standing/i);
    }
  });

  it('takes no email anywhere outside the write path', () => {
    // `waitlistTotal` is the only other export and it must remain argument-free: a total that
    // accepted a filter would be a count somebody could narrow until it identified one person.
    expect(STORE).toMatch(/export async function waitlistTotal\(\s*\)/);
  });
});

describe('the write is the only place standing is told', () => {
  it('returns it on a fresh signup', () => {
    expect(ROUTE).toMatch(/already: false, standing \}, \{ status: 201 \}/);
  });

  it('returns it on an address that is already there', () => {
    /*
      The one people forget. Without it, somebody who lost their referral link could only recover it
      by unsubscribing and rejoining — and a 409 that withheld the code would look like the feature
      was broken for exactly the people who used it most.
    */
    expect(ROUTE).toMatch(/already: true, standing \}, \{ status: 409 \}/);
  });

  it('does not refuse a signup over an unknown referral code', () => {
    // A mistyped link must still put the person on the list; the typo costs the attribution.
    expect(STORE).toContain('Unknown codes are ignored, not refused');
  });
});

describe('the count is a measurement or it is absent', () => {
  it('answers null rather than zero when the list cannot be read', () => {
    /*
      Zero is a real answer that a genuinely empty list is entitled to give. An unreachable database
      borrowing it would make the page state a number it never took — the same rule the footer's
      package digest follows.
    */
    expect(STORE).toMatch(/export async function waitlistTotal\(\): Promise<number \| null>/);
    expect(STORE).toMatch(/catch \{\s*return null;/);
  });

  it('renders nothing at all when the count is absent', () => {
    expect(SCREEN).toMatch(/total !== null && total > 0/);
  });

  it('says "person" for one and "people" for the rest', () => {
    // "1 people on the list" is the tell of a number nobody looked at.
    expect(SCREEN).toContain("' person on the list'");
    expect(SCREEN).toContain("' people on the list'");
  });
});

describe('the page does not contradict itself', () => {
  it('no longer claims there is no referral or position', () => {
    const copy = SCREEN_CODE.slice(SCREEN_CODE.indexOf('How the list works'));
    expect(copy).not.toContain('no referral multiplier');
    expect(copy).not.toContain('how many people are ahead of you');
  });

  it('still refuses the part that was always the point', () => {
    // Counting is not ranking. Nothing here may be bought by bringing people.
    expect(SCREEN).toContain('No points, no tiers, no queue-jumping');
  });

  it('states the position as arrival order rather than as a queue', () => {
    expect(SCREEN).toContain('Arrival order, not a queue');
  });

  it('keeps this referral apart from the one that pays', () => {
    /*
      `creator.move` splits a settlement and pays an address. This counts emails. A page that let the
      two blur would be claiming a contract exists for something a table does.
    */
    expect(SCREEN).toMatch(/pays nothing/);
    expect(SCREEN).toMatch(/settles to an address, not to an email/);
  });
});

describe('the countdown cannot be half-configured', () => {
  it('keeps a date and its label together, in the schema', () => {
    /*
      A date with no label renders an unexplained clock, which a reader will read as "launch" — the
      one meaning it must not carry for a product that is already live. A label with no date renders
      a promise with no time attached.
    */
    expect(MIGRATION).toMatch(
      /CHECK \(\(launch_target_ms IS NULL\) = \(launch_target_label IS NULL\)\)/,
    );
  });

  it('ships with no date set', () => {
    // Nullable, and null is the default. The only honest source for a claim about the future is a
    // person deciding to make it.
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS launch_target_ms bigint;/);
    expect(MIGRATION).not.toMatch(/launch_target_ms bigint NOT NULL/);
  });
});

describe('the clock', () => {
  const CLOCK = readFileSync(join(process.cwd(), 'components/design/Countdown.tsx'), 'utf8');
  const CLOCK_CODE = code(CLOCK);

  it('never counts past zero', () => {
    /*
      `remainingFrom` returns null once the target is behind us, and the component renders a sentence
      instead of figures. "-3 days" is the classic tell of a page nobody looked at after its own
      deadline — and on this site it would be a false statement about the future, in mono, in crest.
    */
    expect(CLOCK_CODE).toMatch(/if \(ms <= 0\) return null;/);
    expect(CLOCK).toContain('That date has arrived');
  });

  it('renders the date in UTC and says so', () => {
    /*
      A target stored as an instant and formatted in the reader's zone shows "30 November" west of
      Greenwich for a date set as 1 December. On a page arguing that its numbers are read rather than
      asserted, an off-by-one date reads as carelessness.
    */
    expect(CLOCK_CODE).toMatch(/timeZone: 'UTC'/);
    expect(CLOCK).toContain('>UTC<');
  });

  it('keeps the label beside the clock', () => {
    // A bare clock is a promise whose content the reader supplies, and they supply "launch".
    expect(CLOCK_CODE).toMatch(/\{label\}/);
  });

  it('says what the door is doing today, next to the countdown', () => {
    // One sentence per state of the gate, so the clock never reads as a launch date on an open site
    // nor as an open door on a closed one.
    expect(CLOCK).toContain('Weir is already open');
    expect(CLOCK).toContain('access is by invitation');
  });

  it('does not announce every tick to a screen reader', () => {
    /*
      A live region changing once a second interrupts continuously and makes the rest of the page
      unreadable. The figures are hidden from assistive tech; the date beside them is not.
    */
    expect(CLOCK_CODE).toMatch(/aria-hidden="true"/);
    expect(CLOCK_CODE).not.toMatch(/aria-live/);
  });

  it('does not compute the first paint from the clock', () => {
    /*
      Server and browser render at different instants, so a countdown computed in both disagrees with
      itself and React throws the markup away. The first paint is the date, which is identical
      everywhere; the figures arrive after mount.
    */
    expect(CLOCK_CODE).toMatch(/useState<Remaining \| null>\(null\)/);
  });

  it('holds the digits still as they change', () => {
    expect(CLOCK_CODE).toMatch(/tabular-nums/);
  });
});

describe('the migration keeps the promises 014 made', () => {
  it('adds no address column', () => {
    // 014 refused to join an email to a Sui address, and a referral code is email-to-email for the
    // same reason: the join would build the identity record this platform exists not to hold.
    expect(MIGRATION).not.toMatch(/ADD COLUMN[^;]*\baddress\b/i);
    expect(MIGRATION).not.toMatch(/ADD COLUMN[^;]*sui_/i);
  });

  it('lets an unsubscribe actually delete the row', () => {
    /*
      A foreign key that blocked the delete would turn "one line unsubscribes you for good" into a
      promise the schema breaks. The people they referred stay; they just stop recording who sent
      them.
    */
    expect(MIGRATION).toMatch(/REFERENCES waitlist_signups \(email\) ON DELETE SET NULL/);
  });
});
