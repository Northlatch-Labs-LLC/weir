// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
  Who may mint a payment session.

  # What changed, and why the previous shape of this file was the defect

  This suite used to end with a case called "serves an anonymous caller, exactly as designed",
  asserting 200. That was true of the code and it was the vulnerability: the only authority on the
  route lived inside `if (mode.waitlistMode)`, so the day the site opened, the one endpoint that
  mints third-party payment links against our on-ramp key began answering anybody at all — and the
  suite went green while it happened, because it had been taught that this was correct.

  The authority is now the caller's own signature over the address they are asking us to fund, and
  it does not depend on the site being closed. The waiting-list gate stays where it is: it is a
  rule about the site, not about this door, and it is correct that it lifts when the site opens.

  What is deliberately NOT required: an account, a read session, or a redeemed pass. Anyone with a
  Sui address can sign this, including a first-time visitor holding nothing — which is the person
  this door exists for.
*/

const readSiteMode = vi.fn();
const passIsValid = vi.fn();
const provenReaderFor = vi.fn();
const isSiteAdmin = vi.fn();
const createOnrampSession = vi.fn();
const verifyAction = vi.fn();
const quotaLimit = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  // The simulate-class guard: durable ceiling plus the per-process Map. Allowed here, because
  // these files are about what the route decides and not about how often it may be asked.
  simulateLimit: async () => null,
  rateLimit: () => null,
  clientKey: () => 'unattributed',
  quotaLimit: (...a: unknown[]) => quotaLimit(...a),
}));
vi.mock('@/lib/site-mode', () => ({ readSiteMode: (...a: unknown[]) => readSiteMode(...a) }));
vi.mock('@/lib/access-codes', () => ({
  passIsValid: (...a: unknown[]) => passIsValid(...a),
  passTokenFrom: (header: string | null) => header,
}));
vi.mock('@/lib/read-session', () => ({ provenReaderFor: (...a: unknown[]) => provenReaderFor(...a) }));
vi.mock('@/lib/site-admin', () => ({ isSiteAdmin: (...a: unknown[]) => isSiteAdmin(...a) }));
vi.mock('@/lib/onramp', () => ({ createOnrampSession: (...a: unknown[]) => createOnrampSession(...a) }));
vi.mock('@/lib/identity', () => ({ verifyAction: (...a: unknown[]) => verifyAction(...a) }));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { network: 'mainnet' } }),
}));

const { POST } = await import('../app/api/onramp/session/route');

const ADDRESS = '0x8539945639191e1749b60c1cd56ada185569b69b1ca7a9e5d6c7915d60c06084';
const OTHER = `0x${'cd'.repeat(32)}`;

/** A request as an honest visitor sends it: the address, and a signature over it. */
function signed(address = ADDRESS, cookie?: string): Request {
  return new Request('https://weir.social/api/onramp/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify({ walletAddress: address, signature: 'sig', timestampMs: Date.now() }),
  });
}

/** A request carrying no proof at all — the anonymous caller this route used to serve. */
function unsigned(address = ADDRESS): Request {
  return new Request('https://weir.social/api/onramp/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ walletAddress: address }),
  });
}

function openSite(): void {
  readSiteMode.mockResolvedValue({ waitlistMode: false });
  quotaLimit.mockResolvedValue(null);
  createOnrampSession.mockResolvedValue({
    ok: true,
    widgetUrl: 'https://global.transak.com/?x=1',
    environment: 'production',
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('the card door once the site is open', () => {
  it('REFUSES an anonymous caller — the reproduction that opened this finding', async () => {
    openSite();
    // No signature in the body, so the verifier refuses. This is the exact request that used to
    // return 200 and a live widget URL.
    verifyAction.mockResolvedValue({ ok: false, failure: { kind: 'malformed', detail: 'no signature' } });

    const response = await POST(unsigned());

    expect(response.status).toBe(403);
    expect(createOnrampSession).not.toHaveBeenCalled();
  });

  it('serves a caller who proves the wallet is theirs', async () => {
    openSite();
    verifyAction.mockResolvedValue({ ok: true, value: true });

    const response = await POST(signed());

    expect(response.status).toBe(200);
    expect(createOnrampSession).toHaveBeenCalledTimes(1);
  });

  it('checks the signature against the address it is asked to fund, not some other one', async () => {
    openSite();
    verifyAction.mockResolvedValue({ ok: true, value: true });

    await POST(signed(OTHER));

    // The address the verifier is given IS the address that will receive the money. If these could
    // differ, a signature for a wallet you own would fund a wallet you do not.
    const call = verifyAction.mock.calls[0]?.[0] as { address: string; action: { walletAddress: string } };
    expect(call.address).toBe(OTHER);
    expect(call.action.walletAddress).toBe(OTHER);
  });

  it('binds the network and this deployment origin into the signed statement', async () => {
    openSite();
    verifyAction.mockResolvedValue({ ok: true, value: true });

    await POST(signed());

    // Without these, bytes signed against a staging, local or forked deployment verify here.
    const call = verifyAction.mock.calls[0]?.[0] as {
      origin: string;
      action: { kind: string; network: string };
    };
    expect(call.action.kind).toBe('onramp');
    expect(call.action.network).toBe('mainnet');
    /*
      The origin moved into the shared head, so it is verified for EVERY statement rather than only
      this one, and carrying it twice in the signed bytes would be two sources for one fact. The
      network stays in the action because the head does not bind it.
    */
    expect(call.origin).toBe('https://weir.social');
  });

  it('refuses a malformed address before it verifies anything or touches the on-ramp', async () => {
    openSite();
    verifyAction.mockResolvedValue({ ok: true, value: true });

    const response = await POST(
      new Request('https://weir.social/api/onramp/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress: 'not-an-address', signature: 'sig', timestampMs: Date.now() }),
      }),
    );

    expect(response.status).toBe(400);
    expect(verifyAction).not.toHaveBeenCalled();
    expect(createOnrampSession).not.toHaveBeenCalled();
  });

  it('stops an address that has proved itself and then loops', async () => {
    openSite();
    verifyAction.mockResolvedValue({ ok: true, value: true });
    // The durable ceiling answers rather than the request passing through. Proof of ownership is
    // not a licence to mint without end: an attacker signing for their own address still spends
    // our partner-account calls.
    quotaLimit.mockResolvedValue(Response.json({ error: 'too many onramp requests' }, { status: 429 }));

    const response = await POST(signed());

    expect(response.status).toBe(429);
    expect(createOnrampSession).not.toHaveBeenCalled();
    expect(quotaLimit).toHaveBeenCalledWith(ADDRESS, 'onramp');
  });
});

describe('the card door while the site is closed', () => {
  it('still refuses an anonymous caller', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    passIsValid.mockResolvedValue(false);
    provenReaderFor.mockResolvedValue({ ok: false });
    isSiteAdmin.mockResolvedValue(false);

    const response = await POST(unsigned());

    expect(response.status).toBe(403);
    expect(createOnrampSession).not.toHaveBeenCalled();
  });

  it('admits a redeemed pass that also proves the wallet', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    passIsValid.mockResolvedValue(true);
    quotaLimit.mockResolvedValue(null);
    verifyAction.mockResolvedValue({ ok: true, value: true });
    createOnrampSession.mockResolvedValue({
      ok: true,
      widgetUrl: 'https://global-stg.transak.com/?x=1',
      environment: 'staging',
    });

    const response = await POST(signed(ADDRESS, 'weir_pass=token'));

    expect(response.status).toBe(200);
    expect(createOnrampSession).toHaveBeenCalledTimes(1);
  });

  it('a pass alone is no longer enough, and that is the change', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    passIsValid.mockResolvedValue(true);
    verifyAction.mockResolvedValue({ ok: false, failure: { kind: 'malformed', detail: 'no signature' } });

    const response = await POST(unsigned());

    // A pass proves someone had a code. It does not prove they control the wallet the money is
    // going to, which is the only question this route needs answered.
    expect(response.status).toBe(403);
    expect(createOnrampSession).not.toHaveBeenCalled();
  });

  it('tells a refused caller nothing about which check failed', async () => {
    readSiteMode.mockResolvedValue({ waitlistMode: true });
    passIsValid.mockResolvedValue(false);
    provenReaderFor.mockResolvedValue({ ok: false });
    isSiteAdmin.mockResolvedValue(false);

    const body = (await (await POST(unsigned())).json()) as { error: string };
    expect(body.error).toBe('the site is not open yet');
  });
});
