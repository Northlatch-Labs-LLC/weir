// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

/**
 * Taking one address off the waiting list.
 *
 * # The row is deleted, not flagged
 *
 * `db/016_waitlist_growth.sql` already decided this, in the note on `referred_by`: "unsubscribing
 * must actually remove the row, and a foreign key that blocks the delete would turn 'one line
 * unsubscribes you for good' into a promise the schema breaks". The foreign key is
 * `ON DELETE SET NULL` for exactly this call. A `subscribed` column would leave the address sitting
 * in a table whose own header calls it a phishing list, on the strength of a boolean that any future
 * query could forget to check.
 *
 * # It returns nothing, and that is the point
 *
 * Not a count, not a boolean. The caller renders the same page either way, because the alternative
 * is an endpoint that answers "that address was on the list" to whoever holds a link — and the link
 * is in a message that may be forwarded, quoted or left open on a shared screen. The person who
 * clicked wanted to be off the list; they are, and there was nothing else to tell them.
 *
 * # Deleting an address that is not there is a success
 *
 * A second click, a mail client's prefetch, a forwarded link: all of them arrive at a row that is
 * already gone, and all of them mean the same thing. `DELETE` over zero rows is not an error in
 * Postgres and is not treated as one here.
 */

import { db } from './db';

/** Whether this deployment has a list at all. */
export function waitlistIsConfigured(): boolean {
  return (process.env['PROJECTX_DATABASE_URL'] ?? '').trim() !== '';
}

/**
 * Remove the address, or leave the table exactly as it was because it was never there.
 *
 * The address is used as given. It came out of a token this deployment signed, and the token was
 * minted from the value in the column, which carries `CHECK (email = lower(email))` — so an exact
 * match is the right match, and lower-casing here would be a second opinion able to drift from the
 * column's.
 *
 * Errors are not caught. A pool that cannot reach Postgres is a real failure and the route turns it
 * into a page that says the removal did not happen; swallowing it would tell somebody they were off
 * a list that still holds them, which is the one outcome this module exists to avoid.
 */
export async function forgetAddress(email: string): Promise<void> {
  await db().query(`DELETE FROM waitlist_signups WHERE email = $1`, [email]);
}
