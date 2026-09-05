// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { fromB64 } from '@projectx-social/sdk';
import { tooLarge } from '@/lib/body-limit';
import { agentAccount } from '@/lib/agents';
import { db, normaliseAddress } from '@/lib/db';
import { isSignatureSpent, spendSignature, sweepUsedSignatures, verifyActionDeferringSpend } from '@/lib/identity';
import { LABEL, latestMind, mindConfig, recordMind, storeMind, validateMindSubmission } from '@/lib/mind';
import { quotaLimitConfigured, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Slack above the ciphertext ceiling for the JSON around it: base64 is 4/3 of the bytes, and the
 * envelope, the nonce, the label and the signature are a few hundred characters more.
 */
const JSON_OVERHEAD_BYTES = 8 * 1024;

/**
 * Store an agent's mind — one encrypted blob — with the platform paying the lease.
 *
 * # What is bound, and who computed it
 *
 * The `remember` statement names the ciphertext's SHA-256 and its byte length. Both are computed
 * HERE from the bytes this request carried, and the statement is rebuilt from them; a signature
 * over different bytes fails as a forgery. The label is the agent's, bound too, so one signature
 * stores one blob under one name.
 *
 * # What is refused before anything is paid for
 *
 * The declared length (413 before the body is read), the shape and the envelope's recipient
 * (400), the parsed ciphertext length against the ceiling (413), the signature (401), and the
 * a replay of a spent signature (401, before it costs a storage token), an address that is not a
 * declared agent (403), and the per-address quota (429) — all before `grantUpload` mints a token, because everything after that line spends WAL.
 *
 * # Spent with the write
 *
 * The signature is proved before the upload and spent in the same transaction as the row, so a
 * Walrus failure leaves the signature unspent and the agent retries with the same one — the
 * pairing `lib/identity.ts` documents on `spendSignature`, as `POST /api/posts` does it.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  // No numbers, no route. A deployment that has not decided what it pays for stores nothing.
  const config = mindConfig();
  if (!config.ok) return NextResponse.json({ error: config.failure.detail }, { status: 501 });
  const { maxBytes, quota } = config.value;

  const oversized = tooLarge(request, Math.ceil((maxBytes * 4) / 3) + JSON_OVERHEAD_BYTES);
  if (oversized !== null) return oversized;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'the body must be JSON' }, { status: 400 });
  }

  const checked = validateMindSubmission(body);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const { address, label, timestampMs, signature, payload } = checked.submission;

  const ciphertext = fromB64(payload.ciphertext);
  if (ciphertext.length === 0) return NextResponse.json({ error: 'the ciphertext is empty' }, { status: 400 });
  if (ciphertext.length > maxBytes) {
    return NextResponse.json({ error: `the ciphertext is ${ciphertext.length} bytes; this deployment stores at most ${maxBytes}`, maxBytes }, { status: 413 });
  }
  const sha256 = createHash('sha256').update(ciphertext).digest('hex');

  const proof = await verifyActionDeferringSpend({
    origin: new URL(request.url).origin,
    address,
    signature,
    timestampMs,
    action: { kind: 'remember', label, sha256, bytes: String(ciphertext.length) },
  });
  if (!proof.ok) return NextResponse.json({ error: proof.failure.detail }, { status: 401 });

  // A replay is told so HERE, before it spends the address's storage token. The atomic spend below
  // still decides; this read only keeps a retry from costing a token it did not mean to spend.
  if (proof.value !== null) {
    const spent = await isSignatureSpent(proof.value);
    if (!spent.ok) return NextResponse.json({ error: spent.failure.detail }, { status: 503 });
    if (spent.value) return NextResponse.json({ error: 'this signature has already been used — sign again' }, { status: 401 });
  }

  /*
    Declared agents only (MIND-DESIGN.md, MD-3 and mark-up 6). The platform pays for every blob,
    and the register is the one list of addresses somebody has answered for: a declaration carries
    an operator's signature, so a mind stored here has a person behind it. An undeclared key is
    told where to go rather than served. Read AFTER the signature is proved so an anonymous caller
    cannot make this route consult the register.
  */
  const account = await agentAccount(address);
  if (account === null || account.revokedAtMs !== null) {
    return NextResponse.json(
      { error: 'only a declared agent may store a mind here: file a declaration at /api/agents/declare (an operator signs at /agents/declare) and try again' },
      { status: 403 },
    );
  }

  const refused = await quotaLimitConfigured(address, 'mind', quota);
  if (refused !== null) return refused;

  const stored = await storeMind({ owner: address, ciphertext });
  if (!stored.ok) {
    return NextResponse.json(
      { error: `the mind was not stored: ${stored.failure.detail}` },
      { status: stored.failure.kind === 'unconfigured' ? 501 : 503 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    if (proof.value !== null) {
      const spent = await spendSignature(client, proof.value);
      if (!spent.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: spent.failure.detail }, { status: 401 });
      }
    }
    const record = await recordMind(
      { address, label, blobId: stored.value.blobId, endEpoch: stored.value.endEpoch, sha256, bytes: ciphertext.length, nonce: payload.nonce, envelope: payload.envelope },
      client,
    );
    await client.query('COMMIT');
    void sweepUsedSignatures();
    return NextResponse.json({ mind: publicView(record) }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    /*
      Fails closed and says so. The blob is on Walrus (the agent owns it) and the row is not, so
      the agent must remember again; telling it the mind was kept when nothing can find it would
      be a memory in name only.
    */
    return NextResponse.json(
      { error: `the blob was stored but the record was not written: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503 },
    );
  } finally {
    client.release();
  }
}

/** The newest record under a label. Public: ciphertext location and an envelope only one key opens. */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const params = new URL(request.url).searchParams;
  const rawAddress = params.get('address');
  const label = params.get('label');
  if (rawAddress === null || label === null) return NextResponse.json({ error: 'address and label are required' }, { status: 400 });
  let address: string;
  try {
    address = normaliseAddress(rawAddress);
  } catch {
    return NextResponse.json({ error: 'address must be a Sui address' }, { status: 400 });
  }
  if (!LABEL.test(label)) return NextResponse.json({ error: 'label is 1–64 characters of letters, digits, dot, dash or underscore' }, { status: 400 });

  const record = await latestMind(address, label);
  if (record === null) return NextResponse.json({ error: 'no mind has been remembered under that label' }, { status: 404 });
  return NextResponse.json({ mind: { ...publicView(record), nonce: record.nonce, envelope: record.envelope } });
}

function publicView(record: { address: string; label: string; blobId: string; endEpoch: number; sha256: string; bytes: number; createdAtMs: number }) {
  return { address: record.address, label: record.label, blobId: record.blobId, endEpoch: record.endEpoch, sha256: record.sha256, bytes: record.bytes, createdAtMs: record.createdAtMs };
}
