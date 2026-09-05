// Built-by: @projectx.sui · Co-authored-by: Claude
import 'server-only';

/**
 * The card-to-coins door.
 *
 * A supporter arrives with a debit card and no crypto. Without this the story ends there:
 * "install a wallet, find an exchange, wait for a transfer" is where somebody who wanted to back
 * a creator gives up. Transak sells SUI and USDC directly onto the Sui network — both verified
 * allowed against their live currency API, not their marketing page — and delivers to an address
 * we name.
 *
 * # Why this is server-only, and why the old shape is gone
 *
 * Transak retired the query-string widget URL: a link carrying only an API key now returns 403.
 * The current flow is three steps and the middle one holds a secret:
 *
 *   1. exchange the API SECRET for a short-lived access token
 *   2. ask their session API for a one-time widget URL (single use, five-minute life)
 *   3. send the visitor to that URL
 *
 * The secret never reaches a browser, and the link a visitor holds cannot be replayed by anyone
 * who copies it out of their history. That is strictly better than the shape it replaces.
 *
 * # Defaults restrict
 *
 * Environment decides staging vs production and there is no default: an unset variable produces
 * `unconfigured`, never a guess that might point a real card at a test widget — or a test card at
 * a real one.
 */

export type OnrampSession =
  | { ok: true; widgetUrl: string; environment: 'staging' | 'production' }
  | { ok: false; reason: 'unconfigured'; missing: string[] }
  | { ok: false; reason: 'upstream'; detail: string };

export interface OnrampRequest {
  /** Sui address the purchased coins are delivered to. */
  walletAddress: string;
  /** SUI for gas-and-stake, USDC for stable-value backing. Both verified allowed on Sui. */
  asset?: 'SUI' | 'USDC';
  fiatAmount?: number;
  fiatCurrency?: string;
  redirectUrl?: string;
  email?: string;
  /** Our own id for the purchase, echoed back on the return trip. */
  partnerOrderId?: string;
  /** The domain the widget will be opened from. Transak validates this. */
  referrerDomain: string;
  /**
   * The end user's originating IP, forwarded as `x-user-ip`.
   *
   * Required by the on-ramp and used by them for fraud and sanctions checks — the visitor's own
   * address, never this server's. Sending our datacentre IP would make every purchase on the
   * platform look like it came from one machine, which is exactly the signal their controls are
   * built to catch.
   */
  userIp?: string;
}

const HOSTS = {
  staging: { auth: 'https://api-stg.transak.com', gateway: 'https://api-gateway-stg.transak.com' },
  production: { auth: 'https://api.transak.com', gateway: 'https://api-gateway.transak.com' },
} as const;

function config():
  | { ok: true; apiKey: string; apiSecret: string; environment: 'staging' | 'production' }
  | { ok: false; missing: string[] } {
  const apiKey = (process.env['TRANSAK_API_KEY'] ?? '').trim();
  const apiSecret = (process.env['TRANSAK_API_SECRET'] ?? '').trim();
  const environment = (process.env['TRANSAK_ENVIRONMENT'] ?? '').trim();

  const missing: string[] = [];
  if (apiKey === '') missing.push('TRANSAK_API_KEY');
  if (apiSecret === '') missing.push('TRANSAK_API_SECRET');
  if (environment !== 'staging' && environment !== 'production') {
    missing.push('TRANSAK_ENVIRONMENT (staging|production)');
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, apiKey, apiSecret, environment: environment as 'staging' | 'production' };
}

/** Is the door open at all? Callers use this to decide whether to offer the button — a button
 *  leading to an error page is worse than no button, because the visitor blames themselves. */
export function onrampConfigured(): boolean {
  return config().ok;
}

/**
 * Step one: the secret becomes a short-lived access token.
 *
 * Deliberately not cached across requests in this first cut. A cached token that outlives its
 * expiry produces a failure at the exact moment a supporter is trying to pay, and the cost of
 * one extra round trip is invisible next to the card flow that follows it.
 */
async function accessToken(
  hosts: (typeof HOSTS)[keyof typeof HOSTS],
  apiKey: string,
  apiSecret: string,
): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  let response: Response;
  try {
    response = await fetch(`${hosts.auth}/partners/api/v2/refresh-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-secret': apiSecret },
      body: JSON.stringify({ apiKey }),
    });
  } catch (cause) {
    return { ok: false, detail: `could not reach the on-ramp: ${String(cause)}` };
  }
  const body = (await response.json().catch(() => ({}))) as {
    data?: { accessToken?: string };
    error?: { message?: string };
  };
  const token = body.data?.accessToken;
  if (token === undefined) {
    return { ok: false, detail: body.error?.message ?? `token request returned ${response.status}` };
  }
  return { ok: true, token };
}

/**
 * Build a one-time widget session.
 *
 * The address is fixed by us and the wallet form is disabled: a supporter cannot be talked into
 * editing the destination, and a mistyped address is a permanent loss with no counterparty to
 * appeal to. The network is always named — "USDC" alone is ambiguous across a dozen chains, and
 * the wrong one delivers to an address on a chain the supporter is not standing on.
 */
export async function createOnrampSession(request: OnrampRequest): Promise<OnrampSession> {
  const cfg = config();
  if (!cfg.ok) return { ok: false, reason: 'unconfigured', missing: cfg.missing };

  const hosts = HOSTS[cfg.environment];
  const token = await accessToken(hosts, cfg.apiKey, cfg.apiSecret);
  if (!token.ok) return { ok: false, reason: 'upstream', detail: token.detail };

  const widgetParams: Record<string, unknown> = {
    apiKey: cfg.apiKey,
    referrerDomain: request.referrerDomain,
    cryptoCurrencyCode: request.asset ?? 'USDC',
    network: 'sui',
    walletAddress: request.walletAddress,
    disableWalletAddressForm: true,
    productsAvailed: 'BUY',
  };
  if (request.fiatAmount !== undefined) widgetParams['fiatAmount'] = request.fiatAmount;
  if (request.fiatCurrency !== undefined) widgetParams['fiatCurrency'] = request.fiatCurrency;
  if (request.redirectUrl !== undefined) widgetParams['redirectURL'] = request.redirectUrl;
  if (request.email !== undefined) widgetParams['email'] = request.email;
  if (request.partnerOrderId !== undefined) widgetParams['partnerOrderId'] = request.partnerOrderId;

  let response: Response;
  try {
    response = await fetch(`${hosts.gateway}/api/v2/auth/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'access-token': token.token,
        ...(request.userIp === undefined ? {} : { 'x-user-ip': request.userIp }),
      },
      body: JSON.stringify({ widgetParams }),
    });
  } catch (cause) {
    return { ok: false, reason: 'upstream', detail: `could not reach the on-ramp: ${String(cause)}` };
  }

  const body = (await response.json().catch(() => ({}))) as {
    data?: { widgetUrl?: string };
    error?: { message?: string };
  };
  const widgetUrl = body.data?.widgetUrl;
  if (widgetUrl === undefined) {
    return {
      ok: false,
      reason: 'upstream',
      detail: body.error?.message ?? `session request returned ${response.status}`,
    };
  }
  return { ok: true, widgetUrl, environment: cfg.environment };
}
