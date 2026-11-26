// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import {
  claimIdempotencyKey,
  completeIdempotentRequest,
  idempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/idempotency';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/// What a route does before its own work: its rate limit. Returns the refusal, or null to go on.
export type Admission = (request: Request) => Response | null | Promise<Response | null>;

export async function idempotently(
  request: Request,
  route: string,
  addressOf: (body: unknown) => string | null,
  run: (request: Request) => Promise<Response>,
  admit?: Admission,
): Promise<Response> {
  /*
    The cheap refusal comes first, and the order is the whole point.

    A claim is two writes to Postgres (the insert, then the release when the route refuses), and
    until 2026-11-25 it happened before the route's limiter ran, because the limiter lived inside
    `run`. So a caller who was already over budget — or who never intended to sign anything — still
    spent database work on every request, with nothing cheap in front of it. The limiter is memory
    and a microsecond; the ledger is shared by every reader of the site. Admit first, then read the
    body, then claim.

    A route that passes `admit` must not limit again inside `run`: one request, one charge.
  */
  const refused = admit === undefined ? null : await admit(request);
  if (refused !== null) return refused;

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
  if (claim.kind !== 'claimed') return answered as never;

  let response: Response;
  try {
    response = await run(again());
  } catch (error) {
    await releaseIdempotencyClaim(claim);
    throw error;
  }

  if (response.status >= 200 && response.status < 300) {
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
