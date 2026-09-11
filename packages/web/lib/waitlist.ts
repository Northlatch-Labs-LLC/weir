// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { MIN_HANDLE_LEN, MAX_HANDLE_LEN } from '@projectx-social/sdk';

export type WaitlistStanding = {
  position: number;
  total: number;
  refCode: string;
  referred: number;
};

export type WaitlistOutcome =
  | {
      ok: true;
      already: boolean;
      standing?: WaitlistStanding;
    }
  | {
      ok: false;
      kind: 'invalid-email' | 'handle-on-list' | 'unconfigured' | 'transport' | 'server';
      detail: string;
    };

function parseStanding(value: unknown): WaitlistStanding | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const { position, total, refCode, referred } = v;
  if (typeof position !== 'number' || !Number.isFinite(position)) return undefined;
  if (typeof total !== 'number' || !Number.isFinite(total)) return undefined;
  if (typeof refCode !== 'string' || refCode === '') return undefined;
  if (typeof referred !== 'number' || !Number.isFinite(referred)) return undefined;
  return { position, total, refCode, referred };
}

export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;

  const parts = trimmed.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (local === undefined || local === '' || domain === undefined) return false;
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;

  if (domain.includes('..')) return false;

  return true;
}

export function canonicalEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const WAITLIST_SOURCES = ['waitlist', 'hero', 'closing', 'footer'] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

export function isWaitlistSource(value: unknown): value is WaitlistSource {
  return typeof value === 'string' && (WAITLIST_SOURCES as readonly string[]).includes(value);
}

export const WAITLIST_ROLES = ['creator', 'supporter', 'both'] as const;
export type WaitlistRole = (typeof WAITLIST_ROLES)[number];

export function isWaitlistRole(value: unknown): value is WaitlistRole {
  return typeof value === 'string' && (WAITLIST_ROLES as readonly string[]).includes(value);
}

export function handleShapeProblem(handle: string): string | null {
  const h = handle.trim().replace(/^@/, '').toLowerCase();
  if (h === '') return null;
  if (h.length < MIN_HANDLE_LEN) return `A handle is at least ${MIN_HANDLE_LEN} characters.`;
  if (h.length > MAX_HANDLE_LEN) return `A handle is at most ${MAX_HANDLE_LEN} characters.`;
  if (!/^[a-z0-9_]+$/.test(h)) return 'Handles use lowercase letters, numbers and underscores only.';
  return null;
}

export function canonicalHandle(handle: string): string | null {
  const h = handle.trim().replace(/^@/, '').toLowerCase();
  return h === '' ? null : h;
}

export async function submitWaitlist(
  email: string,
  source: WaitlistSource,
  role: WaitlistRole,
  handle = '',
  trap = '',
  ref = '',
): Promise<WaitlistOutcome> {
  if (!isPlausibleEmail(email)) {
    return {
      ok: false,
      kind: 'invalid-email',
      detail: 'That does not look like a complete email address.',
    };
  }

  let response: Response;
  try {
    response = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: canonicalEmail(email),
        source,
        role,
        handle: canonicalHandle(handle),
        company: trap,
        ref,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      kind: 'transport',
      detail: error instanceof Error ? error.message : 'The network request failed.',
    };
  }

  if (response.status === 201 || response.status === 409) {
    const already = response.status === 409;
    try {
      const body = (await response.json()) as { standing?: unknown };
      const standing = parseStanding(body.standing);
      return standing === undefined ? { ok: true, already } : { ok: true, already, standing };
    } catch {
      return { ok: true, already };
    }
  }

  if (response.status === 422) {
    return {
      ok: false,
      kind: 'handle-on-list',
      detail: 'Someone on the list already asked for that handle.',
    };
  }

  if (response.status === 503) {
    return {
      ok: false,
      kind: 'unconfigured',
      detail: 'The list is not reachable on this deployment.',
    };
  }

  let detail = `Unexpected response (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error !== '') detail = body.error;
  } catch {
    /* A non-JSON error body is normal from a proxy; the status code is still the honest detail. */
  }
  return { ok: false, kind: 'server', detail };
}
