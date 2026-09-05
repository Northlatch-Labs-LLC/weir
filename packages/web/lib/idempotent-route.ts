// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Run a write route at most once per `(caller, Idempotency-Key)`.
 *
 * # The gap this closes
 *
 * `lib/idempotency.ts` — the ledger, the claim-by-insert, the replay — was written, tested and
 * documented in migration 024, and then called by nothing: `claimIdempotencyKey` had zero callers
 * under `app/`. The agents page promised "a retry must not buy twice" against a header no route
 * read. This file is the single place a route reads it.
 *
 * # Optional by header, mandatory by consequence
 *
 * The header is OPTIONAL. Browsers do not retry a POST blind, and the composer, the message
 * thread and the wallet flows send no key; making the header mandatory would refuse every human.
 * When the header is absent the route runs exactly as before. When it is present — which is what
 * `@projectx-social/agent` and the MCP tools now do on every write — the request is claimed
 * before any side effect, its answer is recorded, and a retry with the same key and the same body
 * receives the recorded answer with `idempotency-replayed: true`, never a second execution.
 *
 * # Claim before the signature is verified, and why that is acceptable
 *
 * The claim is keyed on the address the body NAMES, before `verifyAction` proves it. The
 * alternative — claiming after verification — would put the claim in the middle of a route with
 * a dozen early returns, one forgotten `return` away from executing every retry. Keying on an
 * unproven address costs this: a stranger who guesses another caller's exact key can occupy that
 * caller's namespace for a day. Keys are digests of the caller's own request (`mcp/idempotency.ts`),
 * so the guess is a 256-bit one, and the row is released the moment the signature fails (below).
 *
 * # What is recorded, what is released
 *
 * A 2xx is completed: the body and status are stored and replayed verbatim. Anything else is
 * RELEASED, because on the three routes that use this the failing paths write nothing — every
 * validation, the signature check, an unreadable vault and a seal that did not happen all return
 * before the row is inserted, and the routes say so at each of those returns. A retry after a
 * refusal is therefore allowed to run, which is what a caller who fixed the refusal needs. A route
 * whose failure CAN leave a side effect behind must not use this helper without first changing
 * that rule; `releaseIdempotencyClaim`'s own doc is the authority.
 */
import {
  claimIdempotencyKey,
  completeIdempotentRequest,
  idempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/idempotency';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * @param request   the incoming request; its body is read here ONCE and handed on as text
 * @param route     the ledger's route name — a key reused across routes is a mismatch
 * @param addressOf the caller's address as the raw body names it, or `null` to refuse the claim
 * @param run       the route's own work, given a fresh `Request` carrying the same body
 */
export async function idempotently(
  request: Request,
  route: string,
  addressOf: (body: unknown) => string | null,
  run: (request: Request) => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get(IDEMPOTENCY_HEADER);
  const raw = await request.text();
  const again = () => new Request(request.url, { method: request.method, headers: request.headers, body: raw });

  if (key === null) return run(again());

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'the body is not JSON' }, { status: 400 });
  }
  const address = addressOf(parsed);
  if (address === null) {
    return Response.json(
      { error: 'an Idempotency-Key needs a caller to belong to, and this body names none' },
      { status: 400 },
    );
  }

  const claim = await claimIdempotencyKey({ key, address, route, body: raw });
  const answered = idempotencyResponse(claim);
  if (answered !== null) return answered;
  if (claim.kind !== 'claimed') return answered as never; // unreachable: every other kind answered above

  let response: Response;
  try {
    response = await run(again());
  } catch (error) {
    await releaseIdempotencyClaim(claim);
    throw error;
  }

  if (response.status >= 200 && response.status < 300) {
    // Stored from a clone so the caller still receives a readable body.
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    await completeIdempotentRequest(claim, response.status, body);
  } else {
    await releaseIdempotencyClaim(claim);
  }
  return response;
}
