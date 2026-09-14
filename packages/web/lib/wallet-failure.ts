// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/*
  What a wallet throws, said in words the reader can act on.

  Every connect and every signature goes through a browser extension we do not control, and what
  those throw is written for whoever wrote the extension: `{code: 4001}`, "User rejected the
  request.", "Wallet is locked", a bare string, sometimes nothing at all. Four call sites used to
  put that straight on the screen with `setError(cause.message)`.

  Two rules decide everything here:

  A dismissal is not a failure. Closing the wallet popup is the reader saying "not now", and the
  screen should return to rest with nothing said. Reporting it as an error teaches people that the
  product is broken when they have simply changed their mind — and it is by far the most common
  thing that happens at this boundary.

  What is left must say what to DO. "Wallet is locked" is a fact about the extension; "Unlock your
  wallet and press it again" is the same fact with the next move in it.
*/

export type WalletFailureKind =
  | 'dismissed'
  | 'locked'
  | 'wrong-network'
  | 'unsupported'
  | 'already-pending'
  | 'offline'
  | 'unknown';

export interface WalletFailure {
  readonly kind: WalletFailureKind;
  /* One sentence, addressed to the reader, naming what to do next. Null when nothing is wrong. */
  readonly say: string | null;
  /* The extension's own words, kept for the console and for support — never rendered. */
  readonly raw: string;
}

/* EIP-1193 and the Wallet Standard both settled on 4001 for "the user said no". */
const DISMISSED_CODES = new Set([4001, -32603]);

const DISMISSED = /\b(user (rejected|denied|cancell?ed)|rejected by (the )?user|request (was )?(rejected|cancell?ed)|cancell?ed by user|user closed|denied by the user)\b/i;
const LOCKED = /\b(locked|unlock|no accounts? (are )?(available|authorized)|not authori[sz]ed)\b/i;
const WRONG_NETWORK = /\b(wrong|unsupported|mismatch(ed)?) (network|chain)\b|\bchain ?id\b/i;
const UNSUPPORTED = /\b(not supported|unsupported (method|feature)|does not support)\b/i;
const PENDING = /\b(already (pending|processing)|request (is )?pending|another request)\b/i;
const OFFLINE = /\b(network ?error|failed to fetch|offline|timed? ?out|timeout|ECONN)\b/i;

function textOf(cause: unknown): string {
  if (cause === null || cause === undefined) return '';
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  if (typeof cause === 'object') {
    const bag = cause as { message?: unknown; reason?: unknown; name?: unknown };
    const parts = [bag.name, bag.message, bag.reason].filter((p) => typeof p === 'string');
    if (parts.length > 0) return parts.join(': ');
    try {
      return JSON.stringify(cause);
    } catch {
      return String(cause);
    }
  }
  return String(cause);
}

function codeOf(cause: unknown): number | null {
  if (typeof cause !== 'object' || cause === null) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

/*
  `dismissed` carries no sentence on purpose: the caller shows nothing at all for it. Every other
  kind carries one, so a screen never has to invent wording for a case it did not anticipate.
*/
export function readWalletFailure(cause: unknown): WalletFailure {
  const raw = textOf(cause);
  const code = codeOf(cause);

  if (code !== null && DISMISSED_CODES.has(code)) return { kind: 'dismissed', say: null, raw };
  if (DISMISSED.test(raw)) return { kind: 'dismissed', say: null, raw };

  if (PENDING.test(raw)) {
    return {
      kind: 'already-pending',
      say: 'Your wallet is already asking about this. Open it and answer there.',
      raw,
    };
  }
  if (LOCKED.test(raw)) {
    return { kind: 'locked', say: 'Unlock your wallet, then press it again.', raw };
  }
  if (WRONG_NETWORK.test(raw)) {
    return { kind: 'wrong-network', say: 'Switch your wallet to Sui mainnet, then press it again.', raw };
  }
  if (UNSUPPORTED.test(raw)) {
    return {
      kind: 'unsupported',
      say: 'This wallet cannot sign what Weir needs. Try another Sui wallet.',
      raw,
    };
  }
  if (OFFLINE.test(raw)) {
    return { kind: 'offline', say: 'That did not reach the network. Check your connection and try again.', raw };
  }

  return { kind: 'unknown', say: 'That did not go through. Try again, or use a different wallet.', raw };
}

/* True when the screen should return to rest and say nothing. */
export function wasDismissed(cause: unknown): boolean {
  return readWalletFailure(cause).kind === 'dismissed';
}
