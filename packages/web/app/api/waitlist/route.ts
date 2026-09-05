// Built-by: @projectx.sui · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import {
  canonicalHandle,
  handleShapeProblem,
  isPlausibleEmail,
  isWaitlistRole,
  isWaitlistSource,
} from '@/lib/waitlist';
import { recordSignup } from '@/lib/waitlist-store';

/**
 * `POST /api/waitlist` — the only write on this platform that does not need a signature.
 *
 * # Why it may be unauthenticated when nothing else is
 *
 * Everything else here writes something that belongs to somebody: a follow, a post, a purchase, a
 * session. Each is gated by `verifyAction`, because the request has to prove control of the address
 * it claims. This route stores an email address and grants nothing — there is no account to take
 * over, no object to move and no entitlement to gain. Requiring a signature would also defeat the
 * entire point, which is to give a visitor *without* a wallet something to do.
 *
 * That makes volume the only real risk, and it is answered in three places:
 *
 *   - `rateLimit` on the shared `write` budget, keyed on the visitor's address at the edge.
 *   - A honeypot field, which costs a human nothing and catches form-filling bots.
 *   - The primary key, which makes a replayed submission a no-op rather than a row.
 *
 * # The status codes are the contract
 *
 * `lib/waitlist.ts` maps each one onto a distinct outcome the form renders differently, so none of
 * them may be widened later without changing both. In particular 409 is a *success* to the reader —
 * they wanted to be on the list and they are.
 */
export async function POST(request: Request): Promise<NextResponse | Response> {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  /*
    Refuse rather than guess.

    `db()` throws when the connection string is unset, and that throw is indistinguishable at the
    catch site from a database that is simply down. Checking here separates "this deployment has no
    list" — a calm, permanent 503 the form explains — from "the write failed", which is a 424 and
    worth retrying. (424 rather than 502: the edge replaces 502 bodies with its own HTML page, so
    the honest message would never reach the browser.) Collapsing them would tell a visitor to try
    again forever on a deployment that was never configured.
  */
  const configured = (process.env['PROJECTX_DATABASE_URL'] ?? '').trim() !== '';
  if (!configured) {
    return NextResponse.json({ error: 'waitlist-unconfigured' }, { status: 503 });
  }

  let email: unknown;
  let source: unknown;
  let role: unknown;
  let handle: unknown;
  let trap: unknown;
  let ref: unknown;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    email = body['email'];
    source = body['source'];
    role = body['role'];
    handle = body['handle'];
    // The honeypot. A human never sees this field, so anything in it was filled by a script.
    trap = body['company'];
    /*
      The code from a shared link, if they followed one.

      Deliberately not validated beyond being a string. A code matching nobody resolves to "no
      referrer" in the store rather than being rejected here: somebody who mistyped a link they were
      sent must still reach the list, and the typo should cost the attribution, not the signup.
    */
    ref = body['ref'];
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  /*
    A trapped submission is answered 201 and stored nowhere.

    Reporting the truth here would teach the next bot which field to leave alone, and the whole value
    of a honeypot is that the caller cannot tell it tripped one. Nothing reaches the database, so the
    lie costs a real person nothing — no human can reach this branch without something filling a
    field that is `aria-hidden` and `tabindex="-1"`.
  */
  if (typeof trap === 'string' && trap !== '') {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  if (typeof email !== 'string' || !isPlausibleEmail(email)) {
    return NextResponse.json({ error: 'invalid-email' }, { status: 400 });
  }

  // A closed set, checked here rather than trusted: `source` is written to our table straight from
  // the request body, and an open string field is somewhere a caller can store what they like.
  if (!isWaitlistSource(source)) {
    return NextResponse.json({ error: 'invalid-source' }, { status: 400 });
  }

  if (!isWaitlistRole(role)) {
    return NextResponse.json({ error: 'invalid-role' }, { status: 400 });
  }

  /*
    The handle is optional, and its shape is re-checked here.

    The browser checks it too, for the person's benefit as they type. That check is a convenience; a
    request does not have to come from our form, and a value written into our table has to be
    validated by whatever actually writes it. `null` and `''` both mean "none given".
  */
  if (handle !== null && handle !== undefined && typeof handle !== 'string') {
    return NextResponse.json({ error: 'invalid-handle' }, { status: 400 });
  }
  const wanted = typeof handle === 'string' ? canonicalHandle(handle) : null;
  if (wanted !== null) {
    const problem = handleShapeProblem(wanted);
    if (problem !== null) return NextResponse.json({ error: problem }, { status: 400 });
  }

  try {
    const { result, standing } = await recordSignup({
      email,
      source,
      role,
      handle: wanted,
      refCode: typeof ref === 'string' ? ref : null,
    });

    /*
      Standing rides back on both branches, and on 409 in particular.

      `lib/waitlist-store.ts` explains why there is no endpoint that takes an email and answers a
      question about it: that would be a membership oracle for what the schema itself calls a
      phishing list. The consequence is that this response is the *only* place somebody is ever told
      their referral code, so an address already on the list has to be told it here too — otherwise
      the sole way to recover a lost link would be to unsubscribe and rejoin.

      Written as two branches rather than one ternary over the status. `test/waitlist.test.ts` asserts
      this file's invariant by reading it — every status has to be greppable and distinct — and a
      ternary hides both codes from that check while making the route no shorter to read.
    */
    if (result === 'created') {
      return NextResponse.json({ ok: true, already: false, standing }, { status: 201 });
    }
    return NextResponse.json({ ok: true, already: true, standing }, { status: 409 });
  } catch (error) {
    /*
      One expected conflict, told apart from a genuine failure.

      A partial unique index guards `handle`, so two people wanting the same one collide here. That
      is not a broken database — it is an answer, and it deserves its own status rather than being
      reported as "something failed on our side". The browser checks availability as somebody types,
      so reaching this means two people typed the same handle within the same moment.

      SQLSTATE 23505 is a unique violation; the constraint name is checked as well, so a conflict on
      some future index cannot quietly render as "that handle is spoken for".
    */
    const pg = error as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === 'waitlist_signups_handle_idx') {
      return NextResponse.json({ error: 'handle-on-list' }, { status: 422 });
    }

    /*
      The write failed and the visitor is told so.

      The message is logged, not returned: a Postgres error can name a table, a column or a
      constraint, and that is a description of our schema handed to an unauthenticated caller. What
      goes back is that it failed and that nothing was stored — which is what the person actually
      needs in order to decide to try again.
    */
    console.error(
      JSON.stringify({
        waitlistInsertFailed: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json({ error: 'waitlist-store-failed' }, { status: 424 });
  }
}
