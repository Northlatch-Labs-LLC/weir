// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The launch list: the one thing a visitor without a wallet can actually do.
 *
 * # No `server-only` here, on purpose
 *
 * This module is imported by a client component and by a route handler, so it holds only what both
 * can have: the outcome type, the address check, and the browser-side submit. The insert lives in
 * `waitlist-store.ts`, which imports `db` and is server-only — importing it from here would drag a
 * Postgres pool into the browser bundle and fail the build.
 *
 * # Every outcome is a different thing
 *
 * There is deliberately no constructor that collapses a failure into a success, and no `unwrapOr`.
 * "You are already on the list", "we are not configured", "your connection dropped" and "our
 * database refused the write" ask the reader for four different next actions, and a form that
 * renders them identically is lying about three of them. The type makes the interface handle each
 * one on purpose — the same argument `Reading<T>` makes everywhere else in this codebase.
 */

/**
 * What we can honestly tell somebody about where they stand.
 *
 * Every field is counted from rows, none is a projection, and none of it is a queue. `position` is
 * how many addresses arrived before this one, plus one — a fact about arrival order that confers
 * nothing. See the header of `db/016_waitlist_growth.sql`: this product is live, there is no order
 * of service, and no surface may render this number as a place in a line waiting to be served.
 *
 * Declared here rather than in `waitlist-store.ts` because the form renders it and the form is a
 * client component. A type-only import would erase, but pointing a browser module at a `server-only`
 * file is the kind of edge that survives until somebody adds a value import to it.
 */
import { MIN_HANDLE_LEN, MAX_HANDLE_LEN } from '@projectx-social/sdk';

export type WaitlistStanding = {
  /** 1-based, by arrival. A fact about when, not a promise about order of service. */
  position: number;
  /** How many addresses are on the list in total. */
  total: number;
  /** This person's share code, minted on first write and stable afterwards. */
  refCode: string;
  /** How many addresses arrived carrying this person's code. */
  referred: number;
};

export type WaitlistOutcome =
  | {
      ok: true;
      already: boolean;
      /**
       * Absent when the server did not send it — an older deployment, or a body that did not parse.
       * Optional rather than defaulted, because a zeroed standing would render "you are number 0 of
       * 0" with exactly the confidence of a real count.
       */
      standing?: WaitlistStanding;
    }
  | {
      ok: false;
      kind: 'invalid-email' | 'handle-on-list' | 'unconfigured' | 'transport' | 'server';
      detail: string;
    };

/**
 * The standing out of a response body, or `undefined` if it is not all there.
 *
 * Every field is checked. A partial object would reach the interface and be rendered — "number 12 of
 * undefined" — and the honest response to a body we do not recognise is to show no numbers at all
 * rather than some of them.
 */
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

/**
 * Is this shaped like an address we could actually send to?
 *
 * Deliberately structural rather than clever. A regex that tries to implement RFC 5322 rejects
 * addresses that genuinely deliver, and the only real proof an address exists is a message arriving
 * at it — which is the confirmation mail's job, not this function's. So: one `@`, something either
 * side of it, a dot inside the domain, no whitespace, and a length a real address can have.
 *
 * The upper bound is 254 because that is the maximum length of a deliverable address, and the lower
 * is 6 because `a@b.co` is the shortest thing that can satisfy the rest.
 */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;

  const parts = trimmed.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (local === undefined || local === '' || domain === undefined) return false;
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;

  // A domain of `a..b` has an empty label, which never resolves.
  if (domain.includes('..')) return false;

  return true;
}

/**
 * The address as it is stored and compared.
 *
 * Lower-cased, because the primary key in `014_waitlist.sql` carries a
 * `CHECK (email = lower(email))` and two capitalisations of one address are one person. The domain
 * half is genuinely case-insensitive; the local half technically is not, and no mail provider
 * anybody uses treats it otherwise — a duplicate row is the worse failure.
 */
export function canonicalEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Where a signup came from.
 *
 * A closed set rather than a free string, because `source` is written to the database from a request
 * body. An open field lets a caller store whatever they like in our table, and the value is only
 * ever used to tell one form apart from another — which needs exactly these.
 */
export const WAITLIST_SOURCES = ['waitlist', 'hero', 'closing', 'footer'] as const;
export type WaitlistSource = (typeof WAITLIST_SOURCES)[number];

export function isWaitlistSource(value: unknown): value is WaitlistSource {
  return typeof value === 'string' && (WAITLIST_SOURCES as readonly string[]).includes(value);
}

/**
 * Why they are here.
 *
 * Three answers rather than a free-text field, because the only thing this drives is which of two
 * emails somebody gets, and an open box would collect prose nobody can act on.
 */
export const WAITLIST_ROLES = ['creator', 'supporter', 'both'] as const;
export type WaitlistRole = (typeof WAITLIST_ROLES)[number];

export function isWaitlistRole(value: unknown): value is WaitlistRole {
  return typeof value === 'string' && (WAITLIST_ROLES as readonly string[]).includes(value);
}

/**
 * The handle rules, mirrored from `account.move` and enforced again on the server.
 *
 * Checked here so a malformed handle never becomes a chain read, which is the same ordering
 * `checkHandle` uses. This is shape only — whether it is *free* is a question for the chain, and
 * the answer expires the moment it is given.
 *
 * # The bounds come from the SDK, and that is the whole point
 *
 * These were written out longhand as 3 and 32. The contract's ceiling is 30
 * (`account.move:43`, `MAX_HANDLE_LEN`), so every 31- and 32-character handle this form accepted
 * was one `account::open` will abort on with `EHandleLength`. Nobody was told. The waiting list
 * recorded the intention, the page thanked them for it, and the name could never be minted —
 * a promise the chain was always going to refuse.
 *
 * It is not a typo worth correcting in place, because a second literal would drift again the
 * next time the contract moves. `MIN_HANDLE_LEN` and `MAX_HANDLE_LEN` are exported by the SDK
 * and asserted against `account.move` itself by `packages/sdk/test/drift.test.ts`, so importing
 * them makes the contract the single source and puts this rule under a test that already exists.
 * The numbers now appear in the messages by interpolation, so the copy cannot disagree with the
 * check either.
 */
export function handleShapeProblem(handle: string): string | null {
  const h = handle.trim().replace(/^@/, '').toLowerCase();
  if (h === '') return null; // absent is allowed; the field is optional
  if (h.length < MIN_HANDLE_LEN) return `A handle is at least ${MIN_HANDLE_LEN} characters.`;
  if (h.length > MAX_HANDLE_LEN) return `A handle is at most ${MAX_HANDLE_LEN} characters.`;
  if (!/^[a-z0-9_]+$/.test(h)) return 'Handles use lowercase letters, numbers and underscores only.';
  return null;
}

/** The handle as stored: no leading @, lower-cased, or `null` when none was given. */
export function canonicalHandle(handle: string): string | null {
  const h = handle.trim().replace(/^@/, '').toLowerCase();
  return h === '' ? null : h;
}

/**
 * Send one address to the list, from the browser.
 *
 * Maps the route's status codes onto the outcome type. Every branch is reachable and every one is
 * rendered by `WaitlistForm`; a status this does not recognise becomes `server` with the code in the
 * detail, rather than being quietly treated as success.
 */
export async function submitWaitlist(
  email: string,
  source: WaitlistSource,
  role: WaitlistRole,
  /** Optional, and an intention rather than a reservation — see `db/014_waitlist.sql`. */
  handle = '',
  /*
    The honeypot's contents, forwarded rather than judged.

    The decision is the server's on purpose. Refusing here would put the trap's name and the rule
    that catches it into a bundle anybody can read, and a honeypot whose logic is published is a
    field bots learn to leave alone. Empty for every human, because no human can reach the input.
  */
  trap = '',
  /*
    The code out of a shared link, forwarded verbatim.

    Not checked here for the same reason the trap is not: whether a code matches anybody is a
    question only the database can answer, and a browser-side guess would either reject a valid code
    the server would have accepted or publish the shape of the codes we mint. Empty when the visitor
    did not arrive on somebody's link, which is most of them.
  */
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
    // The request never reached us. Nothing was stored and a retry is genuinely worth trying.
    return {
      ok: false,
      kind: 'transport',
      detail: error instanceof Error ? error.message : 'The network request failed.',
    };
  }

  /*
    201 and 409 are the two successes, and both now carry standing.

    409 is a success from the reader's side — they wanted to be on the list and they are — and it is
    also the only way anybody ever recovers their referral link, because there is no endpoint that
    will answer a question about an email address. See the header of `lib/waitlist-store.ts`.

    A body that will not parse costs the numbers and nothing else: the signup itself is settled by
    the status code, so `standing` stays absent and the form renders the outcome without them.
  */
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

  /*
    Somebody else asked for this handle first.

    Its own status, because it is an answer rather than a fault: nothing is broken, nothing was
    stored, and the person can fix it by choosing another name. Folding it into `server` would tell
    them to try again, which would fail identically forever.
  */
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
