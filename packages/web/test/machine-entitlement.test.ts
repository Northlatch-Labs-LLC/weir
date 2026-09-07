// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A machine buyer is entitled by the machine key, and is handed the machine body.
 *
 * # The defect this pins
 *
 * A paid post is sold under two keys on one vault — the creator's, and `<key>#machine` for machine
 * buyers. Both mint a real `Unlock` through the same `creator::unlock`. `canRead` compared the
 * reader's unlocks against the human key only, so a machine buyer holding a valid `Unlock` was
 * refused as a stranger; and even where it was not, `sealApprover` named no key, so the card asked
 * the key server for the HUMAN identity against a machine `Unlock` — a `MoveAbort` that reads as
 * "you do not have access" on a post that was paid for.
 *
 * # Mutations these must catch (predicted before the run)
 *
 *   - `canRead` paid branch reverted to the human key only → "is entitled by the machine key" red.
 *   - `sealApprover` returns the human key for a machine `Unlock` → "names the machine key" red.
 *   - `visiblePost` hands the human body to a machine approver → "hands the machine body" red.
 */
import { describe, expect, it } from 'vitest';
import { machineContentKey } from '../lib/machine-pricing';
import { NO_ENTITLEMENTS, canRead, sealApprover, unlockKey, type Entitlements } from '../lib/entitlement';
import { visiblePost, type Post } from '../lib/content';

const VAULT = '0xa1f80da9efffa73a2617163f5f35249130972e4f6e0bfd2bf7396c584423fd6d';
const HUMAN = 'post-7';
const MACHINE = (() => {
  const derived = machineContentKey(HUMAN);
  if (!derived.ok) throw new Error('the machine key should derive');
  return derived.value;
})();

function paidPost(withMachineBody: boolean): Post {
  return {
    id: 'p1',
    vaultId: VAULT,
    authorHandle: 'atlas',
    createdAtMs: 1,
    title: 't',
    preview: 'p', commentCount: 0,
    body: '',
    access: { kind: 'paid', price: '250000', contentKey: HUMAN },
    sealedBody: { blobId: 'human-blob', endEpoch: 1, nonce: 'hn', sealWrappedKey: 'hk', sha256: 'hs' },
    ...(withMachineBody
      ? {
          machineBody: {
            blobId: 'machine-blob', endEpoch: 1, nonce: 'mn', sealWrappedKey: 'mk', sha256: 'ms',
            contentKey: MACHINE,
          },
        }
      : {}),
  };
}

/** A reader holding exactly these unlocks, with the object id behind each. */
function holding(...keys: Array<[contentKey: string, objectId: string]>): Entitlements {
  const unlocked = new Set<string>();
  const unlockIds = new Map<string, string>();
  for (const [key, id] of keys) {
    unlocked.add(unlockKey(VAULT, key));
    unlockIds.set(unlockKey(VAULT, key), id);
  }
  return { ...NO_ENTITLEMENTS, unlocked, unlockIds };
}

describe('canRead for a paid post', () => {
  it('is entitled by the machine key alone', () => {
    expect(canRead(paidPost(true), holding([MACHINE, '0xm']))).toBe(true);
  });

  it('is still entitled by the human key alone', () => {
    expect(canRead(paidPost(true), holding([HUMAN, '0xh']))).toBe(true);
  });

  it('is not entitled by neither', () => {
    expect(canRead(paidPost(true), holding())).toBe(false);
    expect(canRead(paidPost(true), NO_ENTITLEMENTS)).toBe(false);
  });

  it('is not entitled by another post’s machine key', () => {
    const other = machineContentKey('post-70');
    if (!other.ok) throw new Error('unreachable');
    expect(canRead(paidPost(true), holding([other.value, '0xo']))).toBe(false);
  });
});

describe('sealApprover for a paid post', () => {
  it('names the machine key and the machine Unlock for a machine buyer', () => {
    expect(sealApprover(paidPost(true), holding([MACHINE, '0xm']))).toEqual({
      kind: 'unlock', objectId: '0xm', contentKey: MACHINE,
    });
  });

  it('names the human key for a human buyer', () => {
    expect(sealApprover(paidPost(true), holding([HUMAN, '0xh']))).toEqual({
      kind: 'unlock', objectId: '0xh', contentKey: HUMAN,
    });
  });

  it('prefers the human Unlock when a reader somehow holds both', () => {
    const both = sealApprover(paidPost(true), holding([MACHINE, '0xm'], [HUMAN, '0xh']));
    expect(both?.kind).toBe('unlock');
    expect(both?.kind === 'unlock' ? both.contentKey : null).toBe(HUMAN);
  });

  it('names nothing for a reader holding neither', () => {
    expect(sealApprover(paidPost(true), holding())).toBeUndefined();
  });
});

describe('visiblePost hands over the edition the approver can open', () => {
  it('hands the machine body to a machine approver, and says so', () => {
    const post = paidPost(true);
    const approver = sealApprover(post, holding([MACHINE, '0xm']));
    const visible = visiblePost(post, true, approver);
    expect(visible.edition).toBe('machine');
    expect(visible.sealedBody?.blobId).toBe('machine-blob');
    // The human body stays behind: one field, one thing to open.
    expect(JSON.stringify(visible)).not.toContain('human-blob');
    expect(visible.approver).toEqual(approver);
  });

  it('hands the human body to a human approver', () => {
    const post = paidPost(true);
    const visible = visiblePost(post, true, sealApprover(post, holding([HUMAN, '0xh'])));
    expect(visible.edition).toBe('human');
    expect(visible.sealedBody?.blobId).toBe('human-blob');
    expect(JSON.stringify(visible)).not.toContain('machine-blob');
  });

  it('reports a machine Unlock on a post that has no machine body, rather than handing the wrong one', () => {
    // A paid post sealed before machine editions were (pre-034). Its plaintext is gone; the machine
    // buyer's object can open nothing, and the human blob would abort on the key server.
    const post = paidPost(false);
    const visible = visiblePost(post, true, sealApprover(post, holding([MACHINE, '0xm'])));
    expect(visible.edition).toBe('machine-absent');
    expect(visible.sealedBody).toBeUndefined();
  });

  it('hands a locked reader nothing at all', () => {
    const visible = visiblePost(paidPost(true), false, undefined);
    expect(visible.locked).toBe(true);
    expect(JSON.stringify(visible)).not.toMatch(/human-blob|machine-blob/);
  });
});
