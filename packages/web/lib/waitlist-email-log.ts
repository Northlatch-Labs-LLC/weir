// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export type QueryResult<Row> = { rows: Row[] };

export type Query = <Row>(text: string, params: readonly unknown[]) => Promise<QueryResult<Row>>;

export const SEND_LOG_TABLE = 'waitlist_email_sends';

export async function waitlistRecipients(query: Query): Promise<string[]> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM waitlist_signups ORDER BY created_at_ms ASC, email ASC`,
    [],
  );
  return rows.map((row) => row.email);
}

export type ClaimOutcome = 'claimed' | 'already-sent';

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

export async function unresolvedClaims(query: Query, templateId: string): Promise<string[]> {
  const { rows } = await query<{ email: string }>(
    `SELECT email FROM ${SEND_LOG_TABLE}
      WHERE template_id = $1 AND provider_message_id IS NULL
      ORDER BY claimed_at_ms ASC`,
    [templateId],
  );
  return rows.map((row) => row.email);
}
