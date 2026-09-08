import type { Post } from '@/lib/api/types';

const STOP = new Set([
  'a','an','the','and','or','but','of','in','on','at','to','for','with','without','from','by','is','are','was','were','be','been','being','it','its','this','that','these','those','i','you','we','they','he','she','my','your','our','their','me','us','them','as','so','if','than','then','into','over','under','not','no','yes','do','does','did','done','have','has','had','can','could','should','would','will','shall','may','might','one','two','three','four','five','six','seven','eight','nine','ten','day','days','part','notes','notes:','again','yet','now','after','before','how','what','why','when','where','who','which','some','any','every','all','most','more','less','least','best','worst','way','very','much','many','few','other','same','own','out','up','down','off','only','also','even','still','because','while','about','on','vs','via','per','per-','de','la','el','del','los','las','of','the','and'
]);

// A meaningful token: alphabetic, length ≥ 4, not a stopword
const tokenise = (title: string): string[] => {
  const raw = title.toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-zà-ÿ0-9\s-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of raw) {
    if (STOP.has(w)) continue;
    if (w.length < 4) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
};

const HOURS_WINDOW = 48;

// Consecutive posts group only when no more than 48 hours apart.
const withinWindow = (a: number, b: number): boolean => {
  const diffMs = Math.abs(a - b);
  return diffMs <= HOURS_WINDOW * 3600000;
};

export type FeedEntry =
  | { kind: 'single'; post: Post }
  | { kind: 'group'; author: string; posts: Post[]; sharedTokens: string[] };

// Group consecutive posts by same author sharing ≥2 meaningful tokens across ALL
// titles in the run. A group needs at least three posts, each within 48 hours of
// the previous one, so a two-post overlap or a years-apart pair is never claimed
// as a conversation.
export const groupFeed = (list: Post[]): FeedEntry[] => {
  const entries: FeedEntry[] = [];
  let i = 0;
  while (i < list.length) {
    const head = list[i];
    const headTokens = tokenise(head.title);
    let j = i + 1;
    let sharedAcross = new Set(headTokens);
    while (
      j < list.length &&
      list[j].authorHandle === head.authorHandle &&
      withinWindow(list[j - 1].createdAtMs, list[j].createdAtMs)
    ) {
      const next = new Set(tokenise(list[j].title));
      const inter = new Set([...sharedAcross].filter(t => next.has(t)));
      if (inter.size < 2) break;
      sharedAcross = inter;
      j++;
    }
    if (j - i >= 3) {
      entries.push({
        kind: 'group',
        author: head.authorHandle,
        posts: list.slice(i, j),
        sharedTokens: [...sharedAcross].slice(0, 5),
      });
      i = j;
    } else {
      entries.push({ kind: 'single', post: head });
      i++;
    }
  }
  return entries;
};

// The thread a post belongs to, if any — the same grouping the feed printed,
// so a post deep in a run keeps its position and siblings when opened alone.
export const findThread = (list: Post[], postId: string): { posts: Post[]; sharedTokens: string[] } | null => {
  for (const e of groupFeed(list)) {
    if (e.kind === 'group' && e.posts.some(p => p.id === postId)) {
      return { posts: e.posts, sharedTokens: e.sharedTokens };
    }
  }
  return null;
};

export const relativeTime = (iso: string, now = new Date()): string => {
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
};

export const relativeTimeMs = (ms: number, now = new Date()): string => {
  const s = Math.max(0, Math.floor((now.getTime() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
};