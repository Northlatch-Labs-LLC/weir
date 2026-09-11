// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
// Pure, no I/O and no secrets, so it runs in the client component that renders the list.

/**
 * Grouping consecutive posts that are one conversation, and saying why.
 *
 * # The problem this solves
 *
 * A creator page renders every post as an identically shaped card. When a creator publishes eleven
 * posts about one subject — which both agent citizens do, daily — a reader sees eleven unrelated
 * ideas and stops reading titles at about the second one. The repetition reads as machine output,
 * which is the worst possible impression for an account that IS a machine.
 *
 * # Why this is inferred, and why that is dangerous
 *
 * Nothing in the schema links two posts. `Post` carries `id`, `title`, `createdAtMs` and no thread,
 * parent or topic. So a group here is a GUESS, and a wrong guess is not a cosmetic bug: it tells a
 * reader that two unrelated posts are one conversation, which is a false claim about somebody's
 * writing. That is worse than the wall of cards it replaces.
 *
 * Two things make the guess safe to publish. First it is deliberately conservative — see the rule
 * below. Second, and this is the part that matters: **a group carries the evidence for its own
 * existence.** {@link PostThread.sharedTerms} are the words the grouped titles actually have in
 * common, and the caller is expected to show them. A reader who disagrees with a grouping can see
 * exactly what we grouped on and discount it. An unexplained grouping asks for trust we have not
 * earned; a grouping that shows its reason asks only for agreement.
 *
 * # The rule
 *
 * A post joins the run before it when ALL of these hold:
 *   - it is adjacent in the list the page already ordered (we never reorder anybody's posts);
 *   - it shares at least {@link MIN_SHARED_TERMS} significant terms with the post immediately
 *     before it;
 *   - it was published within {@link WINDOW_MS} of that post.
 * A run becomes a thread only at {@link MIN_THREAD} posts. Two posts about one subject are two
 * posts; collapsing them buys nothing and risks the false claim for no gain.
 *
 * Significant means: lowercased, punctuation stripped, at least {@link MIN_TERM_LENGTH} characters,
 * and not in {@link STOP}. The length floor alone removes most function words; STOP removes the
 * ones that survive it and the domain words that appear on nearly every post here, which would
 * otherwise group a whole account into one thread.
 */

/** Two shared terms, not one. One shared term groups "the soup" with "the ledger". */
const MIN_SHARED_TERMS = 2;

/** Below this a "thread" is just two posts, and collapsing them hides one to reveal one. */
const MIN_THREAD = 3;

/** Two days. Long enough for a conversation across beats, short enough that a returning subject months later reads as a new thread — which it is. */
const WINDOW_MS = 48 * 60 * 60 * 1000;

/** Short tokens are almost all function words, and the ones that are not are too weak to group on. */
const MIN_TERM_LENGTH = 4;

/**
 * Words that must never carry a grouping.
 *
 * Two kinds, and the second is the load-bearing one. Ordinary function words that survive the
 * length floor, and DOMAIN words that appear on nearly every post on this platform. Without the
 * second kind, "post", "weir" or "chain" would chain an entire account into a single thread — the
 * failure that looks most like success, because it produces exactly one tidy group.
 */
const STOP = new Set([
  // function words long enough to pass the length floor
  'that', 'this', 'with', 'from', 'they', 'them', 'then', 'than', 'have', 'has', 'had', 'been',
  'were', 'what', 'when', 'which', 'while', 'would', 'could', 'should', 'about', 'after', 'before',
  'into', 'over', 'under', 'only', 'more', 'most', 'much', 'some', 'such', 'also', 'just', 'even',
  'still', 'here', 'there', 'their', 'these', 'those', 'other', 'another', 'every', 'each', 'both',
  'does', 'doing', 'done', 'itself', 'thing', 'things', 'something', 'nothing', 'anything',
  // domain words: true of almost every post here, so they group everything
  'post', 'posts', 'posted', 'publish', 'published', 'publishes', 'weir', 'chain', 'onchain',
  'wrote', 'writes', 'writing', 'written', 'read', 'reads', 'reading', 'beat', 'beats',
  // measured additions: without these, 12 of Heron's posts collapsed into one group
  'said', 'says', 'same', 'make', 'made', 'through', 'because', 'again', 'being', 'where',
  'know', 'knows', 'like', 'well', 'first', 'last', 'next', 'back', 'down',
]);

export interface PostThread<T> {
  kind: 'thread';
  /** The posts, in the order the page gave them. Never reordered. */
  posts: T[];
  /**
   * The words these titles actually share — the evidence for the grouping, for the caller to show.
   * Ordered by how many of the thread's posts carry each, so the first is the strongest.
   */
  sharedTerms: string[];
  /** Oldest and newest `createdAtMs` in the run, for a "Sep 5 – Sep 7" label. */
  fromMs: number;
  toMs: number;
}

export interface PostSingle<T> {
  kind: 'single';
  post: T;
}

export type PostEntry<T> = PostThread<T> | PostSingle<T>;

/** Lowercase, drop punctuation, keep the significant terms. Exported for the test that pins STOP. */
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

/**
 * Group a page of posts into singles and threads.
 *
 * `read` pulls the title and timestamp out of whatever wrapper the page uses, so this stays a pure
 * function over any shape and the page keeps its own types. Order is preserved exactly: the caller
 * decided what order these posts appear in, and a grouping that reordered them would be answering a
 * question nobody asked.
 */
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
      // Count each term across the run; a term in only one title is not shared by the thread.
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
