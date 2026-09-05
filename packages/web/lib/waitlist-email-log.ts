// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The record of what has been sent to the waiting list, and the guard that reads it.
 *
 * `db/042_waitlist_email_sends.sql` holds the reasoning for the table. This is the only code that
 * writes it, and the only code that reads the list of addresses a message may go to.
 *
 * # The query function is passed in
 *
 * Every function here takes a `query` rather than importing the pool. Two reasons, and the second
 * is the one that decided it:
 *
 *  - The only caller is `scripts/send-waitlist-email.mjs`, a plain Node process that opens its own
 *    connection. Importing `./db` would pull in `server-only`, which throws outside a React Server
 *    Component and would make this module unusable from the one place that needs it.
 *  - It makes the guard testable without a database. The decisions below are decisions about what
 *    Postgres returned, and they are worth pinning whether or not Postgres is running on the
 *    machine the tests are on.
 *
 * The SQL itself is not testable that way, and this file does not pretend otherwise: what a fake
 * proves is that one returned row means claimed and zero means already sent, and that the statement
 * issued is the one that makes those the only two possibilities.
 */

/** One row of whatever the caller's driver returns. */
export type QueryResult<Row> = { rows: Row[] };

/** The shape of `pool.query` this module needs, and nothing more of it. */
export type Query = <Row>(text: string, params: readonly unknown[]) => Promise<QueryResult<Row>>;

/** The table, named once. */
export const SEND_LOG_TABLE = 'waitlist_email_sends';

/**
 * Every address on the waiting list, oldest first.
 *
 * Oldest first because that is the order they arrived in and the only order the list has ever been
 * read in. It is not a queue and confers nothing — `db/016_waitlist_growth.sql` says so at length —
 * but if a send is interrupted halfway, the half that went is the half that joined first, which is
 * at least an order a person can be told.
 *
 * The column carries `CHECK (email = lower(email))`, so these addresses are already canonical and
 * nothing here re-canonicalises them.
 */
export async function waitlistRecipients(query: Query): Promise<string[]> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM waitlist_signups ORDER BY created_at_ms ASC, email ASC`,
    [],
  );
  return rows.map((row) => row.email);
}

/** What claiming an address for a template did. */
export type ClaimOutcome = 'claimed' | 'already-sent';

/**
 * Take the right to send this template to this address, or discover somebody already has.
 *
 * `ON CONFLICT DO NOTHING RETURNING email` rather than a SELECT and then an INSERT: the two-step
 * version has a window between the read and the write, and two processes — or one process run
 * twice by an operator who was not sure the first had started — both pass the read. The primary key
 * has no window.
 *
 * Zero returned rows means the key was already held and cannot mean anything else. That is the
 * whole guard: a caller that treats `already-sent` as "do not call the provider" cannot send a
 * second copy, whatever happened to the first.
 */
export async function claimSend(
  query: Query,
  input: { email: string; templateId: string; claimedAtMs: number },
): Promise<ClaimOutcome> {
  const { rows } = await query<{ email: string }>(
    `INSERT INTO ${SEND_LOG_TABLE} (email, template_id, claimed_at_ms)
     VALUES ($1, $2, $3)
     ON CONFLICT (email, template_id) DO NOTHING
     RETURNING email`,
    [input.email, input.templateId, input.claimedAtMs],
  );
  return rows.length === 1 ? 'claimed' : 'already-sent';
}

/**
 * Write down what the provider called the message.
 *
 * Separate from the claim, and after the send, because the id does not exist until the provider has
 * answered. A claimed row that never gets one is the honest record of an attempt whose outcome is
 * unknown, and `db/042` says what an operator does about it.
 *
 * `WHERE provider_message_id IS NULL` so a second answer cannot overwrite the first: if this is ever
 * reached twice for one row, the id already recorded is the one that names the message that went.
 */
export async function confirmSend(
  query: Query,
  input: { email: string; templateId: string; providerMessageId: string; sentAtMs: number },
): Promise<void> {
  await query(
    `UPDATE ${SEND_LOG_TABLE}
        SET provider_message_id = $3, sent_at_ms = $4
      WHERE email = $1 AND template_id = $2 AND provider_message_id IS NULL`,
    [input.email, input.templateId, input.providerMessageId, input.sentAtMs],
  );
}

/**
 * Claims for this template that never came back with a provider id.
 *
 * Read by the script before it does anything, so the operator is told about an unresolved attempt
 * at the start rather than discovering it as a refusal partway through a run.
 */
export async function unresolvedClaims(query: Query, templateId: string): Promise<string[]> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM ${SEND_LOG_TABLE}
      WHERE template_id = $1 AND provider_message_id IS NULL
      ORDER BY claimed_at_ms ASC`,
    [templateId],
  );
  return rows.map((row) => row.email);
}
