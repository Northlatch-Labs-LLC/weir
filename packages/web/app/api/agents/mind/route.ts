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

const JSON_OVERHEAD_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

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

  if (proof.value !== null) {
    const spent = await isSignatureSpent(proof.value);
    if (!spent.ok) return NextResponse.json({ error: spent.failure.detail }, { status: 503 });
    if (spent.value) return NextResponse.json({ error: 'this signature has already been used — sign again' }, { status: 401 });
  }

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
    return NextResponse.json(
      { error: `the blob was stored but the record was not written: ${error instanceof Error ? error.message : String(error)}` },
      { status: 503 },
    );
  } finally {
    client.release();
  }
}

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
