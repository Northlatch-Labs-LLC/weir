// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import {
  claimIdempotencyKey,
  completeIdempotentRequest,
  idempotencyResponse,
  releaseIdempotencyClaim,
} from '@/lib/idempotency';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

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
