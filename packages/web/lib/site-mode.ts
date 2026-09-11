// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * Whether the front door is open, and who closed it.
 *
 * # The design already drew this
 *
 * # Cached, because the gate runs on every request
 *
 * `proxy.ts` asks this question for every navigation. A Postgres round trip per request would make
 * a marketing switch into a latency floor on the whole site, so the answer is held for a few
 * seconds in the process.
 *
 * The staleness is bounded and the direction is deliberate: closing the site takes effect within
 * the window rather than instantly. That is the right way round — nothing behind this gate is
 * secret. It is a front door, not an authorisation boundary; every page beyond it still resolves
 * its own entitlement from chain objects exactly as before, and a paid body is no more readable
 * with the site open than closed.
 *
 * # A failed read leaves the site open
 *
 * This is the one place in this codebase that deliberately fails *open*, and it is worth saying
 * why. Everywhere else a failed read locks, because the thing being protected is somebody's paid
 * content and the cost of a wrong "yes" is a leak. Here the thing being protected is a marketing
 * preference, and the cost of a wrong "no" is that a database blip takes the entire live product
 * offline for everybody. Locking on failure would mean an outage in Postgres becomes an outage in
 * Weir, for a switch that guards nothing.
 */

import { db } from './db';

/**
 * Both or neither, which is also a CHECK in `db/016_waitlist_growth.sql`. A date with no label
 * renders a clock the reader has to guess the meaning of, and they will guess "launch" — the one
 * meaning it must not carry for a product that is already live. A label with no date is a promise
 * with no time attached.
 */
export interface LaunchTarget {
  /** Unix milliseconds. */
  atMs: number;
  label: string;
}

export interface SiteMode {
  /** True when the site is behind the waiting list. */
  waitlistMode: boolean;
  /** The address that last changed it, or null if it has never been changed. */
  updatedBy: string | null;
  updatedAtIso: string | null;
  /**
   * `null` until somebody sets one, and null is the shipping default.
   *
   * This is the only value in the application that cannot be derived from anything — the chain does
   * not know it, the database cannot compute it, and the correct behaviour with none set is to
   * render no countdown rather than to invent a date.
   */
  launchTarget: LaunchTarget | null;
}

const OPEN: SiteMode = {
  waitlistMode: false,
  updatedBy: null,
  updatedAtIso: null,
  launchTarget: null,
};

/**
 * The two columns folded into one value, or `null`.
 *
 * The CHECK constraint makes a half-set pair impossible through the schema, and this refuses it
 * again anyway: a constraint added in a migration is a fact about the database somebody restored
 * from, and a reader that trusts it has no way to notice when it is missing. Cheaper to fold here
 * than to discover a bare clock on a live page.
 */
function foldTarget(atMs: string | number | null, label: string | null): LaunchTarget | null {
  if (atMs === null || label === null || label.trim() === '') return null;
  const at = Number(atMs);
  return Number.isFinite(at) ? { atMs: at, label } : null;
}

/** How long an answer is reused. Short enough that closing the site feels immediate. */
const CACHE_MS = 5_000;

/*
  Stashed on `globalThis` for the same reason the connection pool is: Next reloads modules in
  development, and a module-scoped cache would be recreated on every edit — which is harmless here
  but means the cache silently does nothing, and a "why is this slow" investigation later starts
  from a false premise.
*/
const KEY = Symbol.for('projectx.social.site-mode');
interface Holder {
  [KEY]?: { at: number; value: SiteMode };
}

export async function readSiteMode(): Promise<SiteMode> {
  const holder = globalThis as unknown as Holder;
  const held = holder[KEY];
  if (held !== undefined && Date.now() - held.at < CACHE_MS) return held.value;

  try {
    const { rows } = await db().query<{
      waitlist_mode: boolean;
      updated_by: string | null;
      updated_at: Date | null;
      launch_target_ms: string | null;
      launch_target_label: string | null;
    }>(
      `SELECT waitlist_mode, updated_by, updated_at, launch_target_ms, launch_target_label
       FROM site_mode WHERE id = 1`,
    );

    const row = rows[0];
    const value: SiteMode =
      row === undefined
        ? OPEN
        : {
            waitlistMode: row.waitlist_mode,
            updatedBy: row.updated_by,
            updatedAtIso: row.updated_at === null ? null : row.updated_at.toISOString(),
            launchTarget: foldTarget(row.launch_target_ms, row.launch_target_label),
          };

    holder[KEY] = { at: Date.now(), value };
    return value;
  } catch {
    // See the header: this is the one deliberate fail-open in the codebase.
    return OPEN;
  }
}

/**
 * Open or close the front door.
 *
 * Authority is **not** checked here. The caller checks it, against the chain, before calling —
 * see `app/api/site-mode/route.ts`. Keeping the check out of this function means it cannot be
 * accidentally satisfied by whatever the caller happens to have in scope.
 */
export async function setSiteMode(waitlistMode: boolean, by: string): Promise<SiteMode> {
  const { rows } = await db().query<{
    waitlist_mode: boolean;
    updated_by: string | null;
    updated_at: Date;
    launch_target_ms: string | null;
    launch_target_label: string | null;
  }>(
    /*
      The launch columns are read back but never written here.

      They have to be in the RETURNING clause even though this function does not set them, because
      the result is written straight into the cache below. Returning without them would fold the
      countdown to `null` in memory while the row still held it — so closing the site would appear
      to delete the countdown, and it would come back on its own a few seconds later when the cache
      expired. A bug that repairs itself is a bug nobody can reproduce.
    */
    `INSERT INTO site_mode (id, waitlist_mode, updated_by, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE
       SET waitlist_mode = EXCLUDED.waitlist_mode,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at
     RETURNING waitlist_mode, updated_by, updated_at, launch_target_ms, launch_target_label`,
    [waitlistMode, by.toLowerCase()],
  );

  const row = rows[0];
  const value: SiteMode =
    row === undefined
      ? OPEN
      : {
          waitlistMode: row.waitlist_mode,
          updatedBy: row.updated_by,
          updatedAtIso: row.updated_at.toISOString(),
          launchTarget: foldTarget(row.launch_target_ms, row.launch_target_label),
        };

  (globalThis as unknown as Holder)[KEY] = { at: Date.now(), value };
  return value;
}

/**
 * Set, or clear, the date the countdown counts to.
 *
 * `null` clears both columns together — the only way to remove a countdown, and it removes the
 * label with it. Passing a date without a label is not expressible: the parameter is one value or
 * nothing, so the CHECK in the schema and the type here say the same thing.
 *
 * Authority is **not** checked here, exactly as in `setSiteMode`. The caller checks it against the
 * chain before calling; keeping the check out of this function means it cannot be accidentally
 * satisfied by whatever the caller happens to have in scope.
 */
export async function setLaunchTarget(target: LaunchTarget | null, by: string): Promise<SiteMode> {
  const { rows } = await db().query<{
    waitlist_mode: boolean;
    updated_by: string | null;
    updated_at: Date;
    launch_target_ms: string | null;
    launch_target_label: string | null;
  }>(
    /*
      `waitlist_mode` is read back and not written, the mirror of the clause above: setting a date
      must not reopen a closed site. The INSERT branch supplies the column's default for a row that
      does not exist yet, which is `false` — an unconfigured deployment is open, per 015.
    */
    `INSERT INTO site_mode (id, launch_target_ms, launch_target_label, updated_by, updated_at)
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE
       SET launch_target_ms = EXCLUDED.launch_target_ms,
           launch_target_label = EXCLUDED.launch_target_label,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at
     RETURNING waitlist_mode, updated_by, updated_at, launch_target_ms, launch_target_label`,
    [target === null ? null : target.atMs, target === null ? null : target.label, by.toLowerCase()],
  );

  const row = rows[0];
  const value: SiteMode =
    row === undefined
      ? OPEN
      : {
          waitlistMode: row.waitlist_mode,
          updatedBy: row.updated_by,
          updatedAtIso: row.updated_at.toISOString(),
          launchTarget: foldTarget(row.launch_target_ms, row.launch_target_label),
        };

  (globalThis as unknown as Holder)[KEY] = { at: Date.now(), value };
  return value;
}
