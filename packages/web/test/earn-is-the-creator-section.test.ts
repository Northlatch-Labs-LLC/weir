// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { creatorDestinations, CREATOR, MINE } from '@/lib/site-map';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/*
  A creator who holds a handle and no vault is the state every creator passes through, and it used
  to be the state with no way out: the vault is opened from /creator, and /creator was offered only
  to accounts that already had one.
*/
describe('the way to a vault is open to somebody who has none', () => {
  it('offers the vault screen at no-vault, and only that one', () => {
    expect(creatorDestinations('no-vault').map((d) => d.href)).toEqual(['/creator']);
  });

  it('offers studio and earnings only once a vault exists', () => {
    expect(creatorDestinations('ready')).toEqual(CREATOR);
    expect(creatorDestinations('ready').map((d) => d.href)).toContain('/studio');
    expect(creatorDestinations('ready').map((d) => d.href)).toContain('/earnings');
  });

  it('offers no creator destination to somebody with no account, or before the read lands', () => {
    expect(creatorDestinations('no-account')).toEqual([]);
    expect(creatorDestinations(undefined)).toEqual([]);
  });

  it('never drops what is theirs regardless of stage', () => {
    for (const stage of ['no-account', 'no-vault', 'ready', undefined] as const) {
      const hrefs = [...MINE, ...creatorDestinations(stage)].map((d) => d.href);
      expect(hrefs).toEqual(expect.arrayContaining(MINE.map((d) => d.href)));
    }
  });
});

describe('Earn is the creator section once there is an account', () => {
  const page = read('app/creators/page.tsx');

  it('sends a reader who holds a handle to their creator section', () => {
    expect(page).toContain("redirect('/creator')");
    expect(page).toMatch(/if\s*\(handle !== null\)\s*redirect\('\/creator'\)/);
  });

  it('decides that from the handle it read, not from a guess', () => {
    const before = page.indexOf('accountHandle');
    const at = page.indexOf("redirect('/creator')");
    expect(before).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(before);
  });
});

describe('the page that sells earning stops promising what it cannot sign', () => {
  const screen = read('components/app/CreatorsScreen.tsx');

  it('no longer sends anyone to the join stepper to open a vault', () => {
    expect(screen).not.toContain('Review and sign');
    expect(screen).not.toContain('Creates a tier object and a vault owned by your address');
  });

  it('says the handle, the vault and the tier are signed separately', () => {
    expect(screen).toContain('The handle is claimed first, on its own');
    expect(screen).toContain('handle, then vault, then tier');
  });

  /*
    The vault's denomination is its type parameter, chosen when it is opened and fixed to it. A
    price quoted in a coin nobody has chosen yet is a number with the wrong unit on it.
  */
  it('names no coin for a vault that does not exist yet', () => {
    expect(screen).not.toContain('USDC');
    expect(screen).toContain('chosen when you open it');
  });

  it('carries a typed handle into the stepper instead of discarding it', () => {
    expect(screen).toContain('/join?handle=');
  });
});
