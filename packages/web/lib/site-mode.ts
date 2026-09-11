// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { db } from './db';

export interface LaunchTarget {
  atMs: number;
  label: string;
}

export interface SiteMode {
  waitlistMode: boolean;
  updatedBy: string | null;
  updatedAtIso: string | null;
  launchTarget: LaunchTarget | null;
}

const OPEN: SiteMode = {
  waitlistMode: false,
  updatedBy: null,
  updatedAtIso: null,
  launchTarget: null,
};

function foldTarget(atMs: string | number | null, label: string | null): LaunchTarget | null {
  if (atMs === null || label === null || label.trim() === '') return null;
  const at = Number(atMs);
  return Number.isFinite(at) ? { atMs: at, label } : null;
}

const CACHE_MS = 5_000;

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
    return OPEN;
  }
}

export async function setSiteMode(waitlistMode: boolean, by: string): Promise<SiteMode> {
  const { rows } = await db().query<{
    waitlist_mode: boolean;
    updated_by: string | null;
    updated_at: Date;
    launch_target_ms: string | null;
    launch_target_label: string | null;
  }>(
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

export async function setLaunchTarget(target: LaunchTarget | null, by: string): Promise<SiteMode> {
  const { rows } = await db().query<{
    waitlist_mode: boolean;
    updated_by: string | null;
    updated_at: Date;
    launch_target_ms: string | null;
    launch_target_label: string | null;
  }>(
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
