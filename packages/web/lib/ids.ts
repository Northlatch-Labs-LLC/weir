// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(9).toString('base64url')}`;
}
