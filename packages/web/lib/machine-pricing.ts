import { opaqueDetail } from './opaque';
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { fail, ok, unlockIdentity, type Reading } from '@projectx-social/sdk';

export const MACHINE_EDITION_MARKER = '#machine';

export const NO_MACHINE_BODY =
  'was published before machine editions existed; its words were never sealed to this key and ' +
  'cannot be now — republish it, and the new post carries both editions.';

export function machineKeyProblem(humanKey: string): string | null {
  const key = humanKey.trim();
  if (key === '') {
    return 'A content key cannot be empty.';
  }
  if (key.includes(MACHINE_EDITION_MARKER)) {
    return (
      `"${MACHINE_EDITION_MARKER}" is reserved: it is how the machine edition of a key is named, ` +
      `and it is appended for you. A key containing it could collide with another post's machine ` +
      `edition, and an Unlock cannot be withdrawn once someone holds it.`
    );
  }
  return null;
}

export function isMachineContentKey(contentKey: string): boolean {
  return contentKey.trim().endsWith(MACHINE_EDITION_MARKER);
}

export function machineContentKey(humanKey: string): Reading<string> {
  const problem = machineKeyProblem(humanKey);
  if (problem !== null) return fail('malformed', 'machine edition key', problem);
  return ok(`${humanKey.trim()}${MACHINE_EDITION_MARKER}`);
}

export function humanContentKey(machineKey: string): Reading<string> {
  const key = machineKey.trim();
  if (!isMachineContentKey(key)) {
    return fail('malformed', 'machine edition key', `"${key}" is not a machine edition key`);
  }
  return ok(key.slice(0, key.length - MACHINE_EDITION_MARKER.length));
}

export interface EditionIdentities {
  human: Uint8Array;
  machine: Uint8Array;
}

export function machineEditionIdentities(
  vaultId: string,
  humanKey: string,
): Reading<EditionIdentities> {
  const machineKey = machineContentKey(humanKey);
  if (!machineKey.ok) return machineKey;

  const encoder = new TextEncoder();
  try {
    return ok({
      human: unlockIdentity(vaultId, encoder.encode(humanKey.trim())),
      machine: unlockIdentity(vaultId, encoder.encode(machineKey.value)),
    });
  } catch (error) {
    return fail(
      'malformed',
      'machine edition identity',
      opaqueDetail('machine pricing', error),
    );
  }
}

export interface Edition<T> {
  contentKey: string;
  sealed: T;
}

export interface BothEditions<T> {
  human: Edition<T>;
  machine: Edition<T>;
}

export async function sealBothEditions<T>(
  input: {
    humanKey: string;
    body: string;
  },
  sealOne: (gate: { contentKey: string; body: string }) => Promise<Reading<T>>,
): Promise<Reading<BothEditions<T>>> {
  const machineKey = machineContentKey(input.humanKey);
  if (!machineKey.ok) return machineKey;

  const humanKey = input.humanKey.trim();

  const human = await sealOne({ contentKey: humanKey, body: input.body });
  if (!human.ok) return human;

  const machine = await sealOne({ contentKey: machineKey.value, body: input.body });
  if (!machine.ok) return machine;

  return ok({
    human: { contentKey: humanKey, sealed: human.value },
    machine: { contentKey: machineKey.value, sealed: machine.value },
  });
}
