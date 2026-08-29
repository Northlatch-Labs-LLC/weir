// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
  Who may mint a payment session while the site is closed.

  The proxy keeps the API open because every route on it resolves its own authority. This route
  had none to resolve: any anonymous caller could mint single-use widget URLs against our on-ramp
  key while the rest of the site sat behind the waiting list. The gate mirrors the proxy's own
  rule — a pass from a redeemed code, or the site administrator — and vanishes when the site
  opens, because the visitor who needs the card door most has not signed in yet.
*/

const readSiteMode = vi.fn();
const passIsValid = vi.fn();
const provenReaderFor = vi.fn();
const isSiteAdmin = vi.fn();
const createOnrampSession = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, clientKey: () => 'unattributed' }));
vi.mock('@/lib/site-mode', () => ({ readSiteMode: (...a: unknown[]) => readSiteMode(...a) }));
vi.mock('@/lib/access-codes', () => ({
  passIsValid: (...a: unknown[]) => passIsValid(...a),
  passTokenFrom: (header: string | null) => header,
}));
vi.mock('@/lib/read-session', () => ({ provenReaderFor: (...a: unknown[]) => provenReaderFor(...a) }));
vi.mock('@/lib/site-admin', () => ({ isSiteAdmin: (...a: unknown[]) => isSiteAdmin(...a) }));
vi.mock('@/lib/onramp', () => ({ createOnrampSession: (...a: unknown[]) => createOnrampSession(...a) }));

const { POST } = await import('../app/api/onramp/session/route');

const ADDRESS = '0x8539945639191e1749b60c1cd56ada185569b69b1ca7a9e5d6c7915d60c06084';

function post(cookie?: string): Request {
  return new Request('https://weir.social/api/onramp/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify({ walletAddress: ADDRESS }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('the card door while the site is closed', () => {
  it('refuses an anonymous caller', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    passIsValid.mockResolvedValue(false);
    provenReaderFor.mockResolvedValue({ ok: false });
    isSiteAdmin.mockResolvedValue(false);

    const response = await POST(post());
    expect(response.status).toBe(403);
    expect(createOnrampSession).not.toHaveBeenCalled();
  });

  it('admits a redeemed pass', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    passIsValid.mockResolvedValue(true);
    createOnrampSession.mockResolvedValue({
      ok: true,
      widgetUrl: 'https://global-stg.transak.com/?x=1',
      environment: 'staging',
    });

    const response = await POST(post('weir_pass=token'));
    expect(response.status).toBe(200);
    expect(createOnrampSession).toHaveBeenCalledTimes(1);
    // The admin path was never consulted: a pass is sufficient on its own.
    expect(isSiteAdmin).not.toHaveBeenCalled();
  });

  it('admits the site administrator without a pass', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    passIsValid.mockResolvedValue(false);
    provenReaderFor.mockResolvedValue({ ok: true, value: ADDRESS });
    isSiteAdmin.mockResolvedValue(true);
    createOnrampSession.mockResolvedValue({
      ok: true,
      widgetUrl: 'https://global-stg.transak.com/?x=1',
      environment: 'staging',
    });

    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(createOnrampSession).toHaveBeenCalledTimes(1);
  });

  it('tells a refused caller nothing about which check failed', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    passIsValid.mockResolvedValue(false);
    provenReaderFor.mockResolvedValue({ ok: false });
    isSiteAdmin.mockResolvedValue(false);

    const body = (await (await POST(post())).json()) as { error: string };
    expect(body.error).toBe('the site is not open yet');
  });
});

describe('the card door once the site is open', () => {
  it('serves an anonymous caller, exactly as designed', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: false });
    createOnrampSession.mockResolvedValue({
      ok: true,
      widgetUrl: 'https://global.transak.com/?x=1',
      environment: 'production',
    });

    const response = await POST(post());
    expect(response.status).toBe(200);
    // None of the closed-door machinery ran: an open site asks no questions here.
    expect(passIsValid).not.toHaveBeenCalled();
    expect(isSiteAdmin).not.toHaveBeenCalled();
  });
});
