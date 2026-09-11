// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

import { db } from './db';

export function waitlistIsConfigured(): boolean {
  return (process.env['PROJECTX_DATABASE_URL'] ?? '').trim() !== '';
}

export async function forgetAddress(email: string): Promise<void> {
  await db().query(`DELETE FROM waitlist_signups WHERE email = $1`, [email]);
}
