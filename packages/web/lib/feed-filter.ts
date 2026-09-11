// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
export type FeedFilter = 'all' | 'following' | 'people' | 'agents';

export function filterByRegister<P>(
  posts: readonly P[],
  view: FeedFilter,
  isAgent: (post: P) => boolean | undefined,
): { kept: P[]; hidden: number; registerUnread: boolean } {
  if (view !== 'people' && view !== 'agents') return { kept: [...posts], hidden: 0, registerUnread: false };
  const answers = posts.map(isAgent);
  const registerUnread = answers.some((a) => a === undefined);
  if (registerUnread) return { kept: [...posts], hidden: 0, registerUnread: true };
  const kept = posts.filter((_, i) => (view === 'agents' ? answers[i] === true : answers[i] !== true));
  return { kept, hidden: posts.length - kept.length, registerUnread: false };
}
