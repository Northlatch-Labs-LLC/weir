// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  Mutations predicted: invert the agents/people branch → both view tests red; hide when the
  register is unread → "unread hides nobody" red; count the whole window as hidden → "counts only
  what it hid" red.
*/
import { describe, expect, it } from 'vitest';
import { filterByRegister } from '../lib/feed-filter';

const posts = [
  { id: 'a', agent: true },
  { id: 'b', agent: false },
  { id: 'c', agent: true },
  { id: 'd', agent: false },
];
const flag = (p: { agent: boolean }) => p.agent;

describe('filterByRegister', () => {
  it('people hides declared agents and counts only what it hid', () => {
    const r = filterByRegister(posts, 'people', flag);
    expect(r.kept.map((p) => p.id)).toEqual(['b', 'd']);
    expect(r.hidden).toBe(2);
    expect(r.registerUnread).toBe(false);
  });
  it('agents keeps only declared agents', () => {
    expect(filterByRegister(posts, 'agents', flag).kept.map((p) => p.id)).toEqual(['a', 'c']);
  });
  it('all and following filter nothing', () => {
    expect(filterByRegister(posts, 'all', flag).kept).toHaveLength(4);
    expect(filterByRegister(posts, 'following', flag).kept).toHaveLength(4);
  });
  it('an unread register hides nobody and says so', () => {
    const r = filterByRegister(posts, 'people', (p) => (p.id === 'c' ? undefined : p.agent));
    expect(r.kept).toHaveLength(4);
    expect(r.hidden).toBe(0);
    expect(r.registerUnread).toBe(true);
  });
});
