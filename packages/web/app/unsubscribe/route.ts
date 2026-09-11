// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import {
  UNSUBSCRIBE_PATH,
  UNSUBSCRIBE_SECRET_VAR,
  mintUnsubscribeToken,
  readUnsubscribeToken,
} from '@/lib/email-token';
import { forgetAddress, waitlistIsConfigured } from '@/lib/waitlist-unsubscribe';

export const dynamic = 'force-dynamic';

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, lines: readonly string[], extra = ''): string {
  const body = lines.map((line) => `    <p>${line}</p>`).join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
        background: #0b0f14;
        color: #e7edf3;
      }
      main { max-width: 34rem; padding: 2rem 1.5rem; }
      h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 1rem; letter-spacing: -0.01em; }
      p { margin: 0 0 0.85rem; }
      a { color: inherit; }
      form { margin: 1.4rem 0 0; }
      button {
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        border: 0;
        border-radius: 0.55rem;
        padding: 0.7rem 1.15rem;
        background: #e7edf3;
        color: #0b0f14;
      }
      @media (prefers-color-scheme: light) {
        body { background: #ffffff; color: #10171f; }
        button { background: #10171f; color: #ffffff; }
      }
    </style>
  </head>
  <body>
    <main>
    <h1>${title}</h1>
${body}${extra}
    </main>
  </body>
</html>
`;
}

function answer(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

const REMOVED = page('You are off the list.', [
  'This address will not receive another message from Weir. Nothing else was changed.',
  'If that was a mistake, you can join again at <a href="/waitlist">weir.social/waitlist</a>.',
]);

const NOT_A_LINK = page('This link is not valid.', [
  'Nothing was changed. A mail client sometimes breaks a long link across two lines, so the whole ' +
    'of it may not have arrived — opening it again from the message usually works.',
  'If it keeps failing, reply to the message it came in and the address will be taken off by hand.',
]);

const CANNOT_ANSWER = page('We could not take you off the list.', [
  'Nothing was changed, and this is our fault rather than yours. The link is still good: opening ' +
    'it again in a few minutes will finish it.',
  'If it keeps failing, reply to the message it came in and the address will be taken off by hand.',
]);

function confirmPage(token: string): string {
  const action = `${UNSUBSCRIBE_PATH}?token=${escapeAttribute(encodeURIComponent(token))}`;
  return page(
    'Take this address off the list?',
    [
      'Nothing has been changed yet. Press the button and this address stops receiving messages ' +
        'from Weir; close this page and it stays as it is.',
    ],
    `\n    <form method="post" action="${action}">
      <button type="submit">Take me off the list</button>
    </form>`,
  );
}

type Verified =
  | { readonly ok: true; readonly email: string; readonly secret: string | undefined }
  | { readonly ok: false; readonly response: Response };

function verify(request: Request): Verified {
  const token = new URL(request.url).searchParams.get('token');
  if (token === null || token === '') return { ok: false, response: answer(NOT_A_LINK, 400) };

  const secret = process.env[UNSUBSCRIBE_SECRET_VAR];

  let email: string | null;
  try {
    email = readUnsubscribeToken(token, secret);
  } catch {
    console.error(JSON.stringify({ unsubscribeUnconfigured: UNSUBSCRIBE_SECRET_VAR }));
    return { ok: false, response: answer(CANNOT_ANSWER, 503) };
  }

  if (email === null) return { ok: false, response: answer(NOT_A_LINK, 400) };

  if (!waitlistIsConfigured()) {
    console.error(JSON.stringify({ unsubscribeUnconfigured: 'PROJECTX_DATABASE_URL' }));
    return { ok: false, response: answer(CANNOT_ANSWER, 503) };
  }

  return { ok: true, email, secret };
}

export async function GET(request: Request): Promise<Response> {
  const checked = verify(request);
  if (!checked.ok) return checked.response;
  return answer(confirmPage(mintUnsubscribeToken(checked.email, checked.secret)), 200);
}

export async function POST(request: Request): Promise<Response> {
  const checked = verify(request);
  if (!checked.ok) return checked.response;

  try {
    await forgetAddress(checked.email);
  } catch (error) {
    console.error(
      JSON.stringify({ unsubscribeFailed: error instanceof Error ? error.name : 'unknown' }),
    );
    return answer(CANNOT_ANSWER, 500);
  }

  return answer(REMOVED, 200);
}
