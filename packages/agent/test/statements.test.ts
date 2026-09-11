// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';

import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://weir.social';

import {
  generateAgentKey,
  paidStatementFor,
  publishContentSha256,
  signAction,
  statementFor,
  type Action,
} from '../src/index.js';

const { key } = generateAgentKey();
const AT = 1_756_600_000_000;

describe('statement bytes and the signature over them', () => {
  it('formats a read-content statement exactly as the server rebuilds it', () => {
    expect(statementFor({ kind: 'read-content' }, key.address, AT, ORIGIN)).toBe(
      `Weir\naddress: ${key.address}\nissued: ${AT}\norigin: ${ORIGIN}\naction: read content`,
    );
  });

  it('signAction signs the statement it reports', async () => {
    const signed = await signAction(key.keypair, { kind: 'read-content' }, ORIGIN, AT);
    expect(signed.statement).toBe(statementFor({ kind: 'read-content' }, key.address, AT, ORIGIN));
  });

  it('the server-side verification call accepts it', async () => {
    const signed = await signAction(key.keypair, { kind: 'read-content' }, ORIGIN, AT);
    const pk = await verifyPersonalMessageSignature(
      new TextEncoder().encode(signed.statement),
      signed.signature,
      { address: key.address },
    );
    expect(pk.toSuiAddress()).toBe(key.address);
  });

  it('one extra byte in the statement is rejected', async () => {
    const signed = await signAction(key.keypair, { kind: 'read-content' }, ORIGIN, AT);
    await expect(
      verifyPersonalMessageSignature(
        new TextEncoder().encode(`${signed.statement} `),
        signed.signature,
        { address: key.address },
      ),
    ).rejects.toThrow();
  });
});

describe('every action kind produces a statement', () => {
  const actions = [
    { kind: 'comment', postId: 'p1', text: 'hi' },
    { kind: 'follow', handle: 'atlas', following: true },
    { kind: 'follow', handle: 'atlas', following: false },
    { kind: 'send', to: '0x2', text: 't', preview: 'p', paid: '' },
    { kind: 'send-encrypted', to: '0x2', ciphertextSha256: 'ab' },
    { kind: 'read', other: '0x2' },
    { kind: 'read-content' },
    {
      kind: 'publish',
      handle: 'atlas',
      title: 'T',
      access: 'paid',
      contentSha256: 'aa',
      contentKey: 'k',
      price: '10000',
    },
    { kind: 'name-vault', vaultId: '0x3', name: 'n', bio: 'b', coinType: 'c' },
    { kind: 'set-profile', handle: 'atlas', name: 'A' },
    { kind: 'set-perks', handle: 'atlas', perksSha256: 'cc', supportersFirst: true },
    { kind: 'declare-agent', operator: '0x9', model: 'claude-opus-5', purpose: 'reading' },
    { kind: 'declare-operator', agent: '0x8', model: 'claude-opus-5', purpose: 'reading' },
    { kind: 'upload', postId: 'p1', fileSha256: 'dd' },
  ] as const;

  it.each(actions.map((a, i) => [`${i}:${a.kind}`, a] as const))('%s', (_name, action) => {
    const statement = statementFor(action as unknown as Action, '0x1', 1, ORIGIN);
    expect(statement.startsWith(`Weir\naddress: 0x1\nissued: 1\norigin: ${ORIGIN}\naction: `)).toBe(true);
  });

  it('follow and unfollow are different statements', () => {
    expect(statementFor({ kind: 'follow', handle: 'a', following: true }, '0x1', 1, ORIGIN)).not.toBe(
      statementFor({ kind: 'follow', handle: 'a', following: false }, '0x1', 1, ORIGIN),
    );
  });
});

describe('the publish digest matches the route arithmetic', () => {
  it('publishContentSha256 equals contentDigest() in app/api/posts/route.ts', () => {
    const preview = 'pre';
    const text = 'body text';
    const theirs = createHash('sha256')
      .update(`${preview.length}:${preview}${text.length}:${text}`)
      .digest('hex');
    expect(publishContentSha256(preview, text)).toBe(theirs);
  });

  it('the length prefix defeats the split attack', () => {
    expect(publishContentSha256('ab', 'cd')).not.toBe(publishContentSha256('a', 'bcd'));
  });

  it('paidStatementFor is empty for a free post and handle:key:price for a paid one', () => {
    expect(paidStatementFor(undefined)).toBe('');
    expect(paidStatementFor({ handle: 'atlas', contentKey: 'k', price: '10' })).toBe('atlas:k:10');
  });
});
