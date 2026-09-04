// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import {
  UNSUBSCRIBE_PATH,
  UNSUBSCRIBE_SECRET_VAR,
  mintUnsubscribeToken,
  readUnsubscribeToken,
} from '@/lib/email-token';
import { forgetAddress, waitlistIsConfigured } from '@/lib/waitlist-unsubscribe';

/**
 * `GET /unsubscribe?token=…` and `POST` at the same address — the way off the waiting list.
 *
 * `weir.social/waitlist` has promised since it was written that "one click unsubscribes". Nothing
 * in the codebase honoured it: there was no route, and the word appeared once, in a comment. This
 * is the route, and no message may be sent to that list until it is deployed.
 *
 * # A route handler, not a page
 *
 * Every other reader-facing surface here is a React page. This one is HTML written out by hand,
 * because it has to answer two things a page cannot: a `POST` from a mail provider doing RFC 8058
 * one-click unsubscribe, and a request that must complete its side effect before it answers.
 *
 * # `GET` shows the button, `POST` does the work
 *
 * `GET` verifies the token and renders one page with one button, which is a form that `POST`s the
 * same token back to this same path. `POST` is the only verb that removes anything.
 *
 * The split is not politeness about HTTP verbs; it is the only shape that survives contact with
 * mail. RFC 8058 Section 1 records that "anti-spam software often fetches all resources in mail
 * header fields automatically, without any action by the user", and that "there is no mechanical
 * way for a sender to tell whether a request was made automatically by anti-spam software or
 * manually requested by a user". A destructive `GET` therefore means a recipient's own security
 * gateway takes them off the list before they have opened the message, silently, with no record
 * that distinguishes that removal from a real one — because the row is gone and this route
 * deliberately tells the caller nothing.
 *
 * The one-click promise loses nothing. `List-Unsubscribe-Post: List-Unsubscribe=One-Click` tells a
 * conforming provider to `POST`, so a provider's own unsubscribe button still removes the address
 * in one act with no page in between; the button below is what a person who clicked the link in
 * the body sees, and it costs them one click. It is a plain form with no script, so it works in
 * any client that can render HTML.
 *
 * # Nothing here says whether an address was on the list
 *
 * A valid token answers the same page with the same status whether a row was deleted or there was
 * never one to delete. The link travels in a message that can be forwarded, quoted or left open,
 * and an endpoint that reported "yes, that address is on our list" would be a membership oracle for
 * what `db/014_waitlist.sql` calls a phishing list. The success page is a module constant, so the
 * two cases are byte-identical by construction rather than by care.
 *
 * # No rate limit, deliberately
 *
 * Every other unauthenticated route here spends a budget. This one does not, and the reason is that
 * it cannot be made to do work: an unsigned token is refused by an HMAC comparison before anything
 * touches Postgres, so there is no amplification to protect. What a limit WOULD do is refuse a
 * lawful unsubscribe to the second person behind a shared address — which is breaking the promise
 * in order to defend against a request that costs one hash.
 */

export const dynamic = 'force-dynamic';

/** The four characters that can end an attribute or open a tag. Nothing else is special here. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The document, in the one register this page has: plain, sans, and short. */
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

/** One answer: a document, a status, and headers that keep it out of caches and indexes. */
function answer(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      /*
        A crawler that reaches this URL has a token in it, and an indexed unsubscribe link is a
        link somebody else can click. `app/sitemap.ts` keeps the path out of the sitemap; this is
        the header that says so to a crawler that arrived some other way.
      */
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

/**
 * The page `GET` answers: one sentence and one button, and nothing has happened yet.
 *
 * The token in the form's action is minted here from the address the signature already proved,
 * rather than echoed back out of the query string. The two are the same bytes — the signature is
 * deterministic over the address — and taking the generated one means no caller-supplied string
 * ever reaches the document. It is escaped as well, because that argument is one refactor from
 * being untrue.
 */
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

/**
 * Everything both verbs check, and nothing either of them changes.
 *
 * The order matters. The signature is checked before the environment is, and both before Postgres
 * is touched, so an unsigned request never reaches the database and a misconfigured deployment
 * never shows a button it could not honour.
 */
function verify(request: Request): Verified {
  const token = new URL(request.url).searchParams.get('token');
  if (token === null || token === '') return { ok: false, response: answer(NOT_A_LINK, 400) };

  const secret = process.env[UNSUBSCRIBE_SECRET_VAR];

  let email: string | null;
  try {
    email = readUnsubscribeToken(token, secret);
  } catch {
    /*
      The secret is missing or too short, which is a deployment fault and not the reader's. Their
      link is fine and will work once the variable is set, so they are told to come back rather than
      told their link is bad.
    */
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

/**
 * Show the button. This verb reads, and does not write.
 *
 * A mail security gateway or a link scanner that fetches every URL in the message arrives here,
 * gets a page, and leaves the row alone.
 */
export async function GET(request: Request): Promise<Response> {
  const checked = verify(request);
  if (!checked.ok) return checked.response;
  return answer(confirmPage(mintUnsubscribeToken(checked.email, checked.secret)), 200);
}

/**
 * Remove the address. This is the verb that acts, for the button above and for RFC 8058 alike.
 *
 * A provider doing one-click unsubscribe sends `List-Unsubscribe=One-Click` as the body and expects
 * a 2xx. The body is not read: the token in the URL is the whole of the request's authority, and a
 * provider that varies the body must still be honoured.
 */
export async function POST(request: Request): Promise<Response> {
  const checked = verify(request);
  if (!checked.ok) return checked.response;

  try {
    await forgetAddress(checked.email);
  } catch (error) {
    /*
      The message goes to the log and not to the page: a Postgres error names tables, columns and
      constraints, and this route answers anybody holding a link.
    */
    console.error(
      JSON.stringify({ unsubscribeFailed: error instanceof Error ? error.name : 'unknown' }),
    );
    return answer(CANNOT_ANSWER, 500);
  }

  /*
    The same page whether a row was deleted or there was nothing to delete. A second press and a
    forwarded link both arrive here, and both of them mean the reader is off the list — which is
    what the page says.
  */
  return answer(REMOVED, 200);
}
