// The single function the payment dialog calls. It owns prepare → sign →
// submit, and surfaces every state the flow can be in.
//
// The app owns none of the middle step: the backend prepares opaque bytes,
// the wallet signs those exact bytes (passed through unchanged), and the
// signature plus the original bytes go back to the backend. The app never
// constructs, inspects, or modifies a transaction.

import { checkoutPrepare, checkoutSubmit, fail, type ApiResult, type CheckoutRequest, type CheckoutSubmitResult } from '@/lib/api';
import { base64ToBytes, type WalletSigner } from './standard';

export type PayStage =
  | 'preparing'
  | 'awaiting-signature'
  | 'submitting'
  | 'confirming'
  | 'settled'
  | 'rejected'
  | 'timed-out'
  | 'failed';

// The ordered progress states a payment passes through. rejected / timed-out /
// failed are terminal, not on this list.
export const PAY_ORDER: PayStage[] = [
  'preparing',
  'awaiting-signature',
  'submitting',
  'confirming',
  'settled',
];

const SIGN_TIMEOUT_MS = 15000;
const CONFIRM_MS = 1200;

const TIMEOUT = Symbol('timeout');

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(TIMEOUT), ms);
    }),
  ]);
}

// A payment moves money, so it needs a connected wallet. The caller passes the
// signer; when it is null the flow stops before any signing is attempted.
export async function pay(
  req: CheckoutRequest,
  signer: WalletSigner | null,
  onStage: (stage: PayStage, detail?: string) => void,
): Promise<ApiResult<CheckoutSubmitResult>> {
  // Prepare — the backend returns opaque bytes. Nothing is built here.
  onStage('preparing');
  const prepared = await checkoutPrepare(req);
  if (!prepared.ok) {
    onStage('failed', prepared.error.message);
    return prepared;
  }

  // No wallet to sign with — the flow stops honestly.
  if (!signer) {
    onStage('rejected', 'Connect a wallet to pay.');
    return fail(
      'unauthorized',
      'No wallet is connected.',
      'Connect a wallet to pay. Nothing was sent.',
    );
  }

  // The wallet signs the exact bytes the backend produced.
  const toSignBytes = base64ToBytes(prepared.data.toSign);
  onStage('awaiting-signature');

  let signed: { bytes: string; signature: string };
  try {
    signed = await withTimeout(signer.signTransaction(toSignBytes), SIGN_TIMEOUT_MS);
  } catch (e) {
    if (e === TIMEOUT) {
      onStage('timed-out', 'The wallet did not respond.');
      return fail('timeout', 'The wallet did not respond.', 'Nothing was sent. Try again.');
    }
    onStage('rejected', 'The wallet rejected the signature.');
    return fail('invalid-request', 'The wallet rejected the signature.', 'Nothing was sent. Try again.');
  }

  // Submit — the signature and the original bytes go back unchanged.
  onStage('submitting');
  const submitted = await checkoutSubmit(prepared.data.id, signed.signature, prepared.data.toSign);
  if (!submitted.ok) {
    onStage('failed', submitted.error.message);
    return submitted;
  }

  onStage('confirming');
  await delay(CONFIRM_MS);

  onStage('settled');
  return submitted;
}