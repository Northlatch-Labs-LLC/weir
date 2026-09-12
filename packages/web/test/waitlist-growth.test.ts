// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalCode } from '../lib/waitlist-store';

const STORE = readFileSync(join(process.cwd(), 'lib/waitlist-store.ts'), 'utf8');
const ROUTE = readFileSync(join(process.cwd(), 'app/api/waitlist/route.ts'), 'utf8');
const MIGRATION = readFileSync(join(process.cwd(), 'db/016_waitlist_growth.sql'), 'utf8');
const SCREEN = readFileSync(join(process.cwd(), 'components/app/WaitlistPanel.tsx'), 'utf8');

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
  const alphabet = /const CODE_ALPHABET = '([^']+)'/.exec(STORE)?.[1] ?? '';

  it('exists and is not empty', () => {
    expect(alphabet.length).toBeGreaterThan(20);
  });

  it('omits the characters that are misread when a code is typed from a screenshot', () => {
    for (const ambiguous of ['O', 'I', 'L']) {
      expect(alphabet, `${ambiguous} is ambiguous next to a digit`).not.toContain(ambiguous);
    }
  });

  it('is drawn without modulo bias', () => {
    expect(STORE).toMatch(/256 % CODE_ALPHABET\.length/);
  });

  it('is drawn from a cryptographic source', () => {
    expect(STORE).toContain('randomBytes');
    expect(STORE_CODE).not.toContain('Math.random');
  });
});

describe('the list never becomes a membership oracle', () => {
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
    expect(STORE).toMatch(/export async function waitlistTotal\(\s*\)/);
  });
});

describe('the write is the only place standing is told', () => {
  it('returns it on a fresh signup', () => {
    expect(ROUTE).toMatch(/already: false, standing \}, \{ status: 201 \}/);
  });

  it('returns it on an address that is already there', () => {
    expect(ROUTE).toMatch(/already: true, standing \}, \{ status: 409 \}/);
  });

  it('does not refuse a signup over an unknown referral code', () => {
    expect(STORE).toMatch(/return rows\[0\]\?\.email \?\? null;/);
    expect(STORE).toMatch(/referredBy = resolved === email \? null : resolved;/);
    const resolver = STORE.slice(
      STORE.indexOf('async function resolveReferrer'),
      STORE.indexOf('async function readStanding'),
    );
    expect(resolver.length).toBeGreaterThan(60);
    expect(resolver).not.toContain('throw');
  });
});

describe('the count is a measurement or it is absent', () => {
  it('answers null rather than zero when the list cannot be read', () => {
    expect(STORE).toMatch(/export async function waitlistTotal\(\): Promise<number \| null>/);
    expect(STORE).toMatch(/catch \{\s*return null;/);
  });

  it('renders nothing at all when the count is absent', () => {
    expect(SCREEN).toMatch(/total !== null && total > 0/);
  });

  it('says "person" for one and "people" for the rest', () => {
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
    expect(SCREEN).toContain('No points, no tiers, no queue-jumping');
  });

  it('states the position as arrival order rather than as a queue', () => {
    expect(SCREEN).toContain('Arrival order, not a queue');
  });

  it('keeps this referral apart from the one that pays', () => {
    expect(SCREEN).toMatch(/pays nothing/);
    expect(SCREEN).toMatch(/settles to an address, not to an email/);
  });
});

describe('the countdown cannot be half-configured', () => {
  it('keeps a date and its label together, in the schema', () => {
    expect(MIGRATION).toMatch(
      /CHECK \(\(launch_target_ms IS NULL\) = \(launch_target_label IS NULL\)\)/,
    );
  });

  it('ships with no date set', () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS launch_target_ms bigint;/);
    expect(MIGRATION).not.toMatch(/launch_target_ms bigint NOT NULL/);
  });
});

describe('the clock', () => {
  const CLOCK = readFileSync(join(process.cwd(), 'components/app/Countdown.tsx'), 'utf8');
  const CLOCK_CODE = code(CLOCK);

  it('never counts past zero', () => {
    expect(CLOCK_CODE).toMatch(/if \(ms <= 0\) return null;/);
    expect(CLOCK).toContain('That date has arrived');
  });

  it('renders the date in UTC and says so', () => {
    expect(CLOCK_CODE).toMatch(/timeZone: 'UTC'/);
    expect(CLOCK).toContain('>UTC<');
  });

  it('keeps the label beside the clock', () => {
    expect(CLOCK_CODE).toMatch(/\{label\}/);
  });

  it('says what the door is doing today, next to the countdown', () => {
    expect(CLOCK).toContain('Weir is already open');
    expect(CLOCK).toContain('access is by invitation');
  });

  it('does not announce every tick to a screen reader', () => {
    expect(CLOCK_CODE).toMatch(/aria-hidden="true"/);
    expect(CLOCK_CODE).not.toMatch(/aria-live/);
  });

  it('does not compute the first paint from the clock', () => {
    expect(CLOCK_CODE).toMatch(/useState<Remaining \| null>\(null\)/);
  });

  it('holds the digits still as they change', () => {
    const sheet = readFileSync(join(process.cwd(), '..', 'ui', 'src', 'theme', 'weir-ui.css'), 'utf8');
    const digit = sheet.slice(sheet.indexOf('.w-clock__digit {'));
    expect(digit.slice(0, digit.indexOf('}'))).toContain('font-variant-numeric: tabular-nums');
    expect(CLOCK_CODE).toContain('className="w-clock__digit"');
  });
});

describe('the migration keeps the promises 014 made', () => {
  it('adds no address column', () => {
    expect(MIGRATION).not.toMatch(/ADD COLUMN[^;]*\baddress\b/i);
    expect(MIGRATION).not.toMatch(/ADD COLUMN[^;]*sui_/i);
  });

  it('lets an unsubscribe actually delete the row', () => {
    expect(MIGRATION).toMatch(/REFERENCES waitlist_signups \(email\) ON DELETE SET NULL/);
  });
});
