// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

const MIN_SHARED_TERMS = 2;

const MIN_THREAD = 3;

const WINDOW_MS = 48 * 60 * 60 * 1000;

const MIN_TERM_LENGTH = 4;

const STOP = new Set([
  'that', 'this', 'with', 'from', 'they', 'them', 'then', 'than', 'have', 'has', 'had', 'been',
  'were', 'what', 'when', 'which', 'while', 'would', 'could', 'should', 'about', 'after', 'before',
  'into', 'over', 'under', 'only', 'more', 'most', 'much', 'some', 'such', 'also', 'just', 'even',
  'still', 'here', 'there', 'their', 'these', 'those', 'other', 'another', 'every', 'each', 'both',
  'does', 'doing', 'done', 'itself', 'thing', 'things', 'something', 'nothing', 'anything',
  'post', 'posts', 'posted', 'publish', 'published', 'publishes', 'weir', 'chain', 'onchain',
  'wrote', 'writes', 'writing', 'written', 'read', 'reads', 'reading', 'beat', 'beats',
  'said', 'says', 'same', 'make', 'made', 'through', 'because', 'again', 'being', 'where',
  'know', 'knows', 'like', 'well', 'first', 'last', 'next', 'back', 'down',
]);

export interface PostThread<T> {
  kind: 'thread';
  posts: T[];
  sharedTerms: string[];
  fromMs: number;
  toMs: number;
}

export interface PostSingle<T> {
  kind: 'single';
  post: T;
}

export type PostEntry<T> = PostThread<T> | PostSingle<T>;

export function terms(title: string): Set<string> {
  const out = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < MIN_TERM_LENGTH) continue;
    if (STOP.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function shared(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const t of a) if (b.has(t)) out.push(t);
  return out;
}

export function groupPosts<T>(
  items: readonly T[],
  read: (item: T) => { title: string; createdAtMs: number },
): PostEntry<T>[] {
  if (items.length === 0) return [];

  const meta = items.map((item) => {
    const { title, createdAtMs } = read(item);
    return { terms: terms(title), createdAtMs };
  });

  const entries: PostEntry<T>[] = [];
  let run: number[] = [0];

  const flush = (): void => {
    if (run.length >= MIN_THREAD) {
      const counts = new Map<string, number>();
      for (const i of run) {
        for (const t of meta[i]!.terms) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const sharedTerms = [...counts.entries()]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([t]) => t);
      const times = run.map((i) => meta[i]!.createdAtMs);
      entries.push({
        kind: 'thread',
        posts: run.map((i) => items[i]!),
        sharedTerms,
        fromMs: Math.min(...times),
        toMs: Math.max(...times),
      });
    } else {
      for (const i of run) entries.push({ kind: 'single', post: items[i]! });
    }
    run = [];
  };

  for (let i = 1; i < items.length; i += 1) {
    const prev = meta[i - 1]!;
    const cur = meta[i]!;
    const near = Math.abs(cur.createdAtMs - prev.createdAtMs) <= WINDOW_MS;
    const overlap = shared(cur.terms, prev.terms).length >= MIN_SHARED_TERMS;
    if (near && overlap) {
      run.push(i);
    } else {
      flush();
      run = [i];
    }
  }
  flush();
  return entries;
}
