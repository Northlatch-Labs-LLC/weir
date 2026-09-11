// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHmac, timingSafeEqual } from 'node:crypto';

export const UNSUBSCRIBE_PURPOSE = 'weir.waitlist.unsubscribe.v1';

export const UNSUBSCRIBE_PATH = '/unsubscribe';

export const UNSUBSCRIBE_SECRET_VAR = 'WEIR_EMAIL_TOKEN_SECRET';

export const MIN_SECRET_LENGTH = 32;

export function requireSecret(value: string | undefined): string {
  const secret = (value ?? '').trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${UNSUBSCRIBE_SECRET_VAR} must be set to at least ${MIN_SECRET_LENGTH} characters. ` +
        'It signs the unsubscribe links in every message sent to the waiting list, so a missing ' +
        'or short value means those links can be forged or cannot be honoured.',
    );
  }
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${UNSUBSCRIBE_PURPOSE}:${payload}`, 'utf8')
    .digest('base64url');
}

export function mintUnsubscribeToken(email: string, secret: string | undefined): string {
  const key = requireSecret(secret);
  if (email === '') throw new Error('an unsubscribe token needs an address to be about');
  const payload = Buffer.from(email, 'utf8').toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

export function readUnsubscribeToken(token: string, secret: string | undefined): string | null {
  const key = requireSecret(secret);

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (payload === undefined || signature === undefined) return null;
  if (payload === '' || signature === '') return null;

  const expected = Buffer.from(sign(payload, key), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  const email = Buffer.from(payload, 'base64url').toString('utf8');
  return email === '' ? null : email;
}

export function unsubscribeUrl(origin: string, email: string, secret: string | undefined): string {
  const base = origin.replace(/\/+$/, '');
  if (base === '') throw new Error('an unsubscribe link needs the origin it will be opened at');
  const token = mintUnsubscribeToken(email, secret);
  return `${base}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}

export function listUnsubscribeHeaders(url: string): {
  'List-Unsubscribe': string;
  'List-Unsubscribe-Post': string;
} {
  if (url === '' || /[\s<>,]/.test(url)) {
    throw new Error('an unsubscribe URL for a header may not contain whitespace, <, > or a comma');
  }
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
