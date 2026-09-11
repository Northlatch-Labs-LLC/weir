// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export interface Tally {
  key: string;
  count: number;
}

export interface DayCount {
  day: string;
  count: number;
}

export interface Identity {
  handle: string | null;
  code: string | null;
}

export interface Referrer extends Identity {
  referred: number;
}

export interface Arrival extends Identity {
  role: string;
  source: string;
  joinedAtMs: number;
  referred: boolean;
}

export interface WaitlistInsight {
  total: number;
  withHandle: number;
  viaReferral: number;
  byRole: readonly Tally[];
  bySource: readonly Tally[];
  daily: readonly DayCount[];
  topReferrers: readonly Referrer[];
  recent: readonly Arrival[];
}

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const DAY_MS = 86_400_000;

export function tally(rows: readonly { key: string; count: number }[], known: readonly string[]): Tally[] {
  const counted = new Map<string, number>();
  for (const key of known) counted.set(key, 0);
  for (const row of rows) counted.set(row.key, (counted.get(row.key) ?? 0) + row.count);

  const order = new Map(known.map((key, index) => [key, index]));
  return [...counted.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER);
    });
}

export function fillDays(rows: readonly DayCount[], endMs: number, span: number): DayCount[] {
  const counted = new Map(rows.map((row) => [row.day, row.count]));
  const out: DayCount[] = [];
  for (let back = span - 1; back >= 0; back -= 1) {
    const day = dayKey(endMs - back * DAY_MS);
    out.push({ day, count: counted.get(day) ?? 0 });
  }
  return out;
}

export function identify(who: Identity): { label: string; kind: 'handle' | 'code' } | null {
  if (who.handle !== null && who.handle !== '') return { label: `@${who.handle}`, kind: 'handle' };
  if (who.code !== null && who.code !== '') return { label: who.code, kind: 'code' };
  return null;
}
