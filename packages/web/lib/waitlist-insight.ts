// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * # No email reaches this module
 *
 * That is enforced one layer down, in `waitlist-admin.ts`, where no query names the column. The
 * types here are the second half of it: there is nowhere in `WaitlistInsight` for an address to sit,
 * so a future query that selects one has nothing to assign it to.
 *
 * # Why a code may be shown when an email may not
 *
 * # Split from the store for the reason the store was split from the form
 *
 * These are pure functions over rows. `waitlist-admin.ts` imports the Postgres pool and is
 * `server-only`; this file imports nothing, so the bucketing and ordering below can be tested
 * without a database — which is the only way the "a quiet day is a zero, not a gap" rule below ever
 * gets checked.
 */

/** One bucket of a breakdown: how many rows carried this value. */
export interface Tally {
  key: string;
  count: number;
}

/** Arrivals on one UTC day. */
export interface DayCount {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  count: number;
}

/**
 * How a row is named on screen when it may not be named by its address.
 *
 * Both fields are optional in the table and both are the person's own: a handle is what they asked
 * to be called, a code is what they hand out in a link. `null`/`null` is a real row — somebody who
 * joined before `016` and gave no handle — and it renders as unnamed rather than as an invented id.
 */
export interface Identity {
  handle: string | null;
  code: string | null;
}

/** Somebody whose link brought other people to the list. */
export interface Referrer extends Identity {
  referred: number;
}

/** One arrival, as much of it as may be shown. */
export interface Arrival extends Identity {
  role: string;
  source: string;
  joinedAtMs: number;
  /** Whether they came through somebody's link. Never *whose* — that is the referrer's row to tell. */
  referred: boolean;
}

/**
 * Everything the panel renders.
 *
 * Deliberately has no field an email address could occupy.
 */
export interface WaitlistInsight {
  total: number;
  /** How many asked for a handle. The rest are an address and nothing else. */
  withHandle: number;
  /** How many arrived through somebody's link. */
  viaReferral: number;
  byRole: readonly Tally[];
  bySource: readonly Tally[];
  /** A contiguous run of days ending today — see `fillDays`. */
  daily: readonly DayCount[];
  topReferrers: readonly Referrer[];
  recent: readonly Arrival[];
}

/** `YYYY-MM-DD` in UTC. The machine's timezone is not consulted, here or anywhere. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const DAY_MS = 86_400_000;

/**
 * A breakdown that shows the values we know about even when nothing carried them.
 *
 * Two rules, and both are about not lying by omission:
 *
 * Ordered by count, descending; ties keep the order of `known`, so a breakdown of all-zeros still
 * reads in the order the form offers them.
 */
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

/**
 * A contiguous run of days, ending on the day of `endMs`.
 *
 * # A quiet day is a zero, not a gap
 *
 * `GROUP BY day` returns only days that had an arrival. Rendering that directly draws a chart where
 * three signups spread over three weeks sit side by side and look like three consecutive days — the
 * shape of a launch, from data that says the opposite. Every day in the window is emitted, so a
 * quiet week is visibly a quiet week.
 *
 * Days outside the window are ignored rather than clamped into the first bucket, which would put a
 * year of history onto one column and call it today.
 */
export function fillDays(rows: readonly DayCount[], endMs: number, span: number): DayCount[] {
  const counted = new Map(rows.map((row) => [row.day, row.count]));
  const out: DayCount[] = [];
  for (let back = span - 1; back >= 0; back -= 1) {
    const day = dayKey(endMs - back * DAY_MS);
    out.push({ day, count: counted.get(day) ?? 0 });
  }
  return out;
}

/**
 * What to call somebody who may have given us no name.
 *
 * A handle if they asked for one, otherwise the code they share, otherwise nothing. `null` is
 * returned rather than a placeholder so the caller decides how an unnamed row reads — a string like
 * "anonymous" invented here would end up compared, sorted and eventually looked up as though it
 * were a name.
 */
export function identify(who: Identity): { label: string; kind: 'handle' | 'code' } | null {
  if (who.handle !== null && who.handle !== '') return { label: `@${who.handle}`, kind: 'handle' };
  if (who.code !== null && who.code !== '') return { label: who.code, kind: 'code' };
  return null;
}
