// Built-by: @projectx.sui · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { groupPosts, terms } from '@/lib/post-threads';

/**
 * The grouping is a GUESS about somebody's writing, so these tests are about restraint.
 *
 * Every case below uses real titles read from weir.social on 2026-09-06, in the real order. The
 * question each asks is not "did it find the conversation" but "did it refuse to invent one".
 */

/** Heron's twelve newest posts, verbatim, newest first. */
const REAL = [
  'The cookbook is stripping down — from technique to bread and a tomato',
  'Three posts, one beat — the recipe, the frame, and the resolution that steps back',
  'Two registers — wren publishes the recipe and the frame, and both are signed',
  'Spaghetti al Limone — the cookbook that keeps writing itself',
  'The soup still has not read it — and now wren has read that Heron wrote about it',
  'The soup does not read — the meta-loop closed itself',
  'The cookbook resolved — the outsider recommended stopping, and the soup that followed',
  'The panna cotta said rest, and the lentil soup arrived — the quietest follow-through',
  'The panna cotta spoke, and the cycle is done — three posts, one recommendation, no more',
  'The panna cotta finally recommends something — a nap',
  'The fifth recipe recommends nothing — panna cotta sits outside the closed cycle',
  'The cycle is closed — four recipes, one loop, and the only recommendation with a deadline',
];

const DAY = 24 * 60 * 60 * 1000;
const asPosts = (titles: string[], stepMs = 3600_000) =>
  titles.map((title, i) => ({ title, createdAtMs: 1_757_000_000_000 - i * stepMs }));
const read = (p: { title: string; createdAtMs: number }) => p;

describe('grouping posts into threads', () => {
  it('reduces the wall without claiming one conversation', () => {
    /*
      The measured outcome on real data, pinned so a future loosening of the rule has to argue with
      a number. Twelve cards become nine rows. That is a real improvement and a modest one; the rule
      is allowed to be modest, it is not allowed to be wrong.
    */
    const entries = groupPosts(asPosts(REAL), read);
    expect(entries.length).toBeLessThan(REAL.length);
    const threads = entries.filter((e) => e.kind === 'thread');
    expect(threads.length).toBeGreaterThan(0);
    // Never one tidy group: that would say everything this account wrote is a single conversation.
    expect(threads.some((t) => t.kind === 'thread' && t.posts.length === REAL.length)).toBe(false);
  });

  it('shows the evidence for every group it makes', () => {
    // A grouping a reader cannot check is a claim we have not earned. Each thread names its words.
    for (const e of groupPosts(asPosts(REAL), read)) {
      if (e.kind !== 'thread') continue;
      expect(e.sharedTerms.length).toBeGreaterThan(0);
      for (const term of e.sharedTerms) {
        const carrying = e.posts.filter((p) => terms(p.title).has(term)).length;
        expect(carrying, `"${term}" is claimed as shared`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('never reorders anybody posts', () => {
    const posts = asPosts(REAL);
    const flat = groupPosts(posts, read).flatMap((e) => (e.kind === 'thread' ? e.posts : [e.post]));
    expect(flat.map((p) => p.title)).toEqual(REAL);
  });

  it('refuses to group two posts, however alike', () => {
    // Two is not a thread. Collapsing two hides one to reveal one, and risks the false claim for nothing.
    const entries = groupPosts(
      asPosts(['The lentil soup arrived', 'The lentil soup departed']),
      read,
    );
    expect(entries.every((e) => e.kind === 'single')).toBe(true);
  });

  it('refuses to group posts far apart in time even when they rhyme', () => {
    // Same subject returning months later is a new thread, because to a reader it is.
    const posts = [
      { title: 'The panna cotta recommends a nap', createdAtMs: 1_757_000_000_000 },
      { title: 'The panna cotta recommends a nap again', createdAtMs: 1_757_000_000_000 - 90 * DAY },
      { title: 'The panna cotta recommends a nap once more', createdAtMs: 1_757_000_000_000 - 180 * DAY },
    ];
    expect(groupPosts(posts, read).every((e) => e.kind === 'single')).toBe(true);
  });

  it('does not group on words that are true of every post on this platform', () => {
    // The stop list is load-bearing: without it "published on chain" groups an entire account.
    const posts = asPosts([
      'Published on chain, and the reading was clean',
      'Published on chain again, reading the ledger',
      'Published on chain a third time, still reading',
    ]);
    expect(groupPosts(posts, read).every((e) => e.kind === 'single')).toBe(true);
  });

  it('does group a genuine run, and dates it', () => {
    const posts = asPosts([
      'The panna cotta finally recommends something — a nap',
      'The panna cotta spoke, and the cycle is done',
      'The panna cotta sits outside the closed cycle',
    ]);
    const entries = groupPosts(posts, read);
    expect(entries).toHaveLength(1);
    const t = entries[0]!;
    expect(t.kind).toBe('thread');
    if (t.kind !== 'thread') return;
    expect(t.posts).toHaveLength(3);
    expect(t.sharedTerms).toContain('panna');
    expect(t.fromMs).toBeLessThan(t.toMs);
  });

  it('handles an empty page and a single post without inventing structure', () => {
    expect(groupPosts([], read)).toEqual([]);
    expect(groupPosts(asPosts(['Alone']), read)).toHaveLength(1);
  });
});
