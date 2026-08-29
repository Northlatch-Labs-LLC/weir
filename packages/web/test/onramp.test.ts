// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The door either opens onto the right chain or it does not open.
 *
 * Every assertion here guards a way a supporter's money could go somewhere they did not choose:
 * the wrong network, an editable address, a live widget under a test key, a secret leaking into a
 * browser, or a failure swallowed into a dead-end button.
 *
 * `fetch` is replaced so the suite never touches the real on-ramp — a test that spends someone's
 * network quota to prove a URL shape is a test that gets deleted the first time it is flaky.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOnrampSession, onrampConfigured } from '@/lib/onramp';

const ADDRESS = '0x8539945639191e1749b60c1cd56ada185569b69b1ca7a9e5d6c7915d60c06084';
const VARS = ['TRANSAK_API_KEY', 'TRANSAK_API_SECRET', 'TRANSAK_ENVIRONMENT'] as const;

let saved: Record<string, string | undefined>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function configure(environment = 'staging'): void {
  process.env['TRANSAK_API_KEY'] = 'test-key';
  process.env['TRANSAK_API_SECRET'] = 'test-secret';
  process.env['TRANSAK_ENVIRONMENT'] = environment;
}

/** Records what the module asked the on-ramp for, and answers the two-step handshake. */
function stubUpstream(overrides?: { tokenFails?: boolean; sessionFails?: boolean }) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      url: href,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    if (href.includes('refresh-token')) {
      return new Response(
        JSON.stringify(
          overrides?.tokenFails
            ? { error: { message: 'Invalid api-secret' } }
            : { data: { accessToken: 'tok-123' } },
        ),
        { status: overrides?.tokenFails ? 400 : 200 },
      );
    }
    return new Response(
      JSON.stringify(
        overrides?.sessionFails
          ? { error: { message: 'session refused' } }
          : { data: { widgetUrl: 'https://global-stg.transak.com?apiKey=test-key&sessionId=abc' } },
      ),
      { status: overrides?.sessionFails ? 400 : 200 },
    );
  }) as unknown as typeof fetch;
  return calls;
}

describe('the on-ramp door', () => {
  it('refuses to guess when nothing is configured, and names what is missing', async () => {
    for (const v of VARS) delete process.env[v];
    const session = await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });
    expect(session.ok).toBe(false);
    if (session.ok || session.reason !== 'unconfigured') throw new Error('expected unconfigured');
    expect(session.missing).toContain('TRANSAK_API_KEY');
    expect(session.missing).toContain('TRANSAK_API_SECRET');
    expect(session.missing.join(' ')).toContain('TRANSAK_ENVIRONMENT');
  });

  it('refuses an environment that is neither staging nor production', async () => {
    // A typo must not fall through to the live widget. There is no default here on purpose:
    // the two hosts differ by whether real cards are charged.
    configure('prod');
    const session = await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });
    expect(session.ok).toBe(false);
  });

  it('talks to the staging hosts under staging, and the live hosts under production', async () => {
    configure('staging');
    let calls = stubUpstream();
    await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });
    expect(calls[0]?.url).toContain('api-stg.transak.com');
    expect(calls[1]?.url).toContain('api-gateway-stg.transak.com');

    configure('production');
    calls = stubUpstream();
    await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });
    expect(calls[0]?.url).toContain('api.transak.com');
    expect(calls[0]?.url).not.toContain('-stg');
    expect(calls[1]?.url).toContain('api-gateway.transak.com');
  });

  it('sends the secret only to the token step, and the token only to the session step', async () => {
    // The secret must never travel further than it has to, and must never reach a browser —
    // which is why this module is server-only and the variable is not NEXT_PUBLIC.
    configure();
    const calls = stubUpstream();
    await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });

    expect(calls[0]?.headers['api-secret']).toBe('test-secret');
    expect(JSON.stringify(calls[1])).not.toContain('test-secret');
    expect(calls[1]?.headers['access-token']).toBe('tok-123');
    expect(calls[1]?.headers['x-api-key']).toBe('test-key');
  });

  it('always names the Sui network and locks the delivery address', async () => {
    configure();
    const calls = stubUpstream();
    await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'weir.social', asset: 'SUI' });

    const params = (calls[1]?.body as { widgetParams: Record<string, unknown> }).widgetParams;
    expect(params['network']).toBe('sui');
    expect(params['cryptoCurrencyCode']).toBe('SUI');
    expect(params['walletAddress']).toBe(ADDRESS);
    // A mistyped address is a permanent loss with nobody to appeal to.
    expect(params['disableWalletAddressForm']).toBe(true);
    expect(params['productsAvailed']).toBe('BUY');
    expect(params['referrerDomain']).toBe('weir.social');
  });

  it('defaults to USDC and passes optional fields only when given', async () => {
    configure();
    let calls = stubUpstream();
    await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });
    let params = (calls[1]?.body as { widgetParams: Record<string, unknown> }).widgetParams;
    expect(params['cryptoCurrencyCode']).toBe('USDC');
    for (const field of ['fiatAmount', 'fiatCurrency', 'email', 'partnerOrderId', 'redirectURL']) {
      expect(field in params).toBe(false);
    }

    calls = stubUpstream();
    await createOnrampSession({
      walletAddress: ADDRESS,
      referrerDomain: 'x.test',
      fiatAmount: 25,
      fiatCurrency: 'USD',
      email: 'someone@example.com',
      partnerOrderId: 'weir-001',
      redirectUrl: 'https://weir.social/back/thanks',
    });
    params = (calls[1]?.body as { widgetParams: Record<string, unknown> }).widgetParams;
    expect(params['fiatAmount']).toBe(25);
    expect(params['fiatCurrency']).toBe('USD');
    expect(params['email']).toBe('someone@example.com');
    expect(params['partnerOrderId']).toBe('weir-001');
    expect(params['redirectURL']).toBe('https://weir.social/back/thanks');
  });

  it('returns the widget url when the handshake completes', async () => {
    configure();
    stubUpstream();
    const session = await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.widgetUrl).toContain('sessionId=');
    expect(session.environment).toBe('staging');
  });

  it('reports an upstream refusal in words instead of a dead button', async () => {
    // The night this was built, a swallowed upstream error cost an hour: the widget said
    // "something went wrong" while the real message named the exact cause.
    configure();
    stubUpstream({ tokenFails: true });
    const bad = await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });
    expect(bad.ok).toBe(false);
    if (bad.ok || bad.reason !== 'upstream') throw new Error('expected upstream');
    expect(bad.detail).toContain('api-secret');

    stubUpstream({ sessionFails: true });
    const worse = await createOnrampSession({ walletAddress: ADDRESS, referrerDomain: 'x.test' });
    expect(worse.ok).toBe(false);
    if (worse.ok || worse.reason !== 'upstream') throw new Error('expected upstream');
    expect(worse.detail).toContain('session refused');
  });

  it('tells callers whether to offer the button at all', () => {
    // A button that leads to an error page is worse than no button: the visitor blames themselves.
    for (const v of VARS) delete process.env[v];
    expect(onrampConfigured()).toBe(false);
    configure();
    expect(onrampConfigured()).toBe(true);
  });
});

describe('the end-user IP', () => {
  const VARS2 = ['TRANSAK_API_KEY', 'TRANSAK_API_SECRET', 'TRANSAK_ENVIRONMENT'] as const;

  it('forwards the visitor IP as x-user-ip when we have it', async () => {
    // Required by the on-ramp, and used for their fraud and sanctions checks. It must be the
    // visitor's address: sending this server's would make every purchase on the platform look
    // like it came from one machine, which is the exact signal those controls exist to catch.
    for (const v of VARS2) process.env[v] = v === 'TRANSAK_ENVIRONMENT' ? 'staging' : 'test-value';
    const calls: { headers: Record<string, string> }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ headers: (init?.headers ?? {}) as Record<string, string> });
      const href = String(url);
      return new Response(
        JSON.stringify(
          href.includes('refresh-token')
            ? { data: { accessToken: 'tok' } }
            : { data: { widgetUrl: 'https://global-stg.transak.com?sessionId=x' } },
        ),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await createOnrampSession({
      walletAddress: '0x8539945639191e1749b60c1cd56ada185569b69b1ca7a9e5d6c7915d60c06084',
      referrerDomain: 'weir.social',
      userIp: '203.0.113.7',
    });
    expect(calls[1]?.headers['x-user-ip']).toBe('203.0.113.7');
  });

  it('omits the header rather than inventing an address', async () => {
    // A fabricated IP is worse than none: it would be our own, and it would be wrong about
    // every visitor.
    for (const v of VARS2) process.env[v] = v === 'TRANSAK_ENVIRONMENT' ? 'staging' : 'test-value';
    const calls: { headers: Record<string, string> }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ headers: (init?.headers ?? {}) as Record<string, string> });
      const href = String(url);
      return new Response(
        JSON.stringify(
          href.includes('refresh-token')
            ? { data: { accessToken: 'tok' } }
            : { data: { widgetUrl: 'https://global-stg.transak.com?sessionId=x' } },
        ),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await createOnrampSession({
      walletAddress: '0x8539945639191e1749b60c1cd56ada185569b69b1ca7a9e5d6c7915d60c06084',
      referrerDomain: 'weir.social',
    });
    expect('x-user-ip' in (calls[1]?.headers ?? {})).toBe(false);
  });
});
