// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { UNSUBSCRIBE_SECRET_VAR, readUnsubscribeToken } from '@/lib/email-token';
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
 * one-click unsubscribe, and a request that must complete its side effect before it answers. Both
 * verbs do the same work and answer the same document.
 *
 * # Both verbs act
 *
 * `POST` is what a provider sends when it shows its own "unsubscribe" button — RFC 8058 fixes the
 * shape, and `listUnsubscribeHeaders` in `lib/email-token.ts` emits it. `GET` is what the link in
 * the body does when a person clicks it, and it removes the row rather than showing a confirm
 * button, because the promise on the page is one click and a confirmation step is two.
 *
 * The cost of that decision is real and is recorded rather than hidden: some mail security scanners
 * fetch every link in a message, and a scanner that fetches this one unsubscribes the reader who
 * never clicked. The alternative — a page with a button — breaks the promise for every reader in
 * order to protect the few behind a link-following scanner. It is a product decision, not a
 * technical one, and it can be reversed by making `GET` render the button and `POST` do the work
 * without changing anything else in this file.
 *
 * # Nothing here says whether an address was on the list
 *
 * A valid token answers the same page with the same status whether a row was deleted or there was
 * never one to delete. The link travels in a message that can be forwarded, quoted or left open,
 * and an endpoint that reported "yes, that address is on our list" would be a membership oracle for
 * what `db/014_waitlist.sql` calls a phishing list.
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

/** The document, in the one register this page has: plain, sans, and short. */
function page(title: string, lines: readonly string[]): string {
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
      @media (prefers-color-scheme: light) {
        body { background: #ffffff; color: #10171f; }
      }
    </style>
  </head>
  <body>
    <main>
    <h1>${title}</h1>
${body}
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
 * Verify, remove, answer.
 *
 * The order matters. The signature is checked before the environment is, and both before Postgres
 * is touched, so an unsigned request never reaches the database and a misconfigured deployment
 * never reports a removal it did not perform.
 */
async function unsubscribe(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');
  if (token === null || token === '') return answer(NOT_A_LINK, 400);

  let email: string | null;
  try {
    email = readUnsubscribeToken(token, process.env[UNSUBSCRIBE_SECRET_VAR]);
  } catch {
    /*
      The secret is missing or too short, which is a deployment fault and not the reader's. Their
      link is fine and will work once the variable is set, so they are told to come back rather than
      told their link is bad.
    */
    console.error(JSON.stringify({ unsubscribeUnconfigured: UNSUBSCRIBE_SECRET_VAR }));
    return answer(CANNOT_ANSWER, 503);
  }

  if (email === null) return answer(NOT_A_LINK, 400);

  if (!waitlistIsConfigured()) {
    console.error(JSON.stringify({ unsubscribeUnconfigured: 'PROJECTX_DATABASE_URL' }));
    return answer(CANNOT_ANSWER, 503);
  }

  try {
    await forgetAddress(email);
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
    The same page whether a row was deleted or there was nothing to delete. A second click, a
    forwarded link and a mail client's prefetch all arrive here, and all of them mean the reader is
    off the list — which is what the page says.
  */
  return answer(REMOVED, 200);
}

export async function GET(request: Request): Promise<Response> {
  return unsubscribe(request);
}

/**
 * The verb a mail provider uses for one-click unsubscribe.
 *
 * RFC 8058 sends `List-Unsubscribe=One-Click` as the body and expects a 2xx. The body is not read:
 * the token in the URL is the whole of the request's authority, and a provider that varies the body
 * must still be honoured.
 */
export async function POST(request: Request): Promise<Response> {
  return unsubscribe(request);
}
