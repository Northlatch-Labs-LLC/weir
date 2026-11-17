// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(new URL('../app/c/[handle]/page.tsx', import.meta.url), 'utf8');

const CARD = (() => {
  const start = PAGE.indexOf('accountName=');
  if (start === -1) throw new Error('the support vault attribution was not found');
  const after = PAGE.indexOf('depositLine=', start);
  if (after === -1) throw new Error('the deposit line was not found');
  const end = PAGE.indexOf('tab={tab}', after);
  return PAGE.slice(start, end === -1 ? PAGE.length : end);
})();

describe('attributing the support vault', () => {
  it('names the account rather than this page', () => {
    expect(CARD).toContain('ownerName ?? shortId(profile.owner)');
  });

  it('never attributes the vault to the page it happens to be rendered on', () => {
    expect(CARD).not.toContain('profile.displayName');
  });

  it('finds the vault through the owner’s StakeCap, not an event walk', () => {
    // The first source was a walk of StakeVaultOpened events filtered by creator. The mainnet
    // gRPC endpoint serves event queries from a recent window only, so the walk succeeded with
    // zero events and every creator’s public page said they had opened no pool. The StakeCap is
    // an owned object read from current state: no window, no truncation.
    expect(PAGE).toContain('findStakeCaps(profile.owner)');
    expect(PAGE).not.toContain('readVaults(');
  });

  it('never renders a failed pool read as an answer', () => {
    expect(PAGE).toContain('That is a failed read, not an');
    expect(PAGE).toContain('not saying the account has no pool');
    expect(PAGE).toContain('has not opened a pool yet');
  });
});
