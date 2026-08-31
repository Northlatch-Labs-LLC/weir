// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The browser builds these statements by hand, and no compiler checks that it gets them right.
 *
 * # What this test guards now
 *
 * Eight client components rebuild the signed statement as a template literal, because a browser
 * component cannot import a `server-only` module and will not pull a signing SDK into a button.
 * Nothing ties those literals to the format they must match — a stray space added on one side makes
 * every signature of that kind fail to verify, and the message the user gets is "the signature does
 * not prove control of 0x…", which points at the wallet rather than at the typo.
 *
 * So this test reads the client components from disk and compares them against the one
 * implementation of `statementFor`, which now lives in `packages/sdk/src/statements.ts`.
 *
 * # What was removed, and why keeping it would have been worse
 *
 * This file used to do a second job. `statementFor` and the `Action` union existed **twice** — in
 * `packages/web/lib/identity.ts` and again as a 244-line hand copy in
 * `packages/agent/src/statements.ts` — and part of this file policed the server side of that
 * duplication: a hand-maintained list of all thirteen action kinds, and `expect(server.size).toBe(13)`.
 *
 * Those are gone because the duplication is gone. Both former copies now re-export the SDK's
 * module; there is one `statementFor` in this repository. A drift test between one implementation
 * and itself asserts nothing, and a hand-maintained count of thirteen is worse than nothing: it
 * fails on the honest day somebody adds an action, which teaches people to edit the number rather
 * than read the diff. The properties those assertions were reaching for moved to
 * `packages/sdk/test/statements.test.ts`, where they are checked properly — every kind is pinned to
 * bytes captured from `identity.ts` *before* the hoist, and coverage of the union is a `Record`
 * over `Action['kind']`, so a kind added and forgotten fails `tsc` instead of a counter.
 *
 * **The client copies were not removed and must not be.** They are still hand-written, still
 * unreachable by the compiler, and they are the only remaining place the format can drift.
 *
 * # It compares skeletons, not strings
 *
 * Interpolations are replaced by a marker — `${handle}` on one side and `${action.handle}` on the
 * other are the same slot under different local names, and comparing them literally would fail on
 * every file for no reason. What is compared is the fixed text around the slots and the number of
 * slots, which is exactly the part that has to agree byte for byte.
 *
 * Note that `\n` below means the two-character escape as it appears in the source, not a newline.
 * These statements are single-line string literals containing escapes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

/**
 * Where the one implementation lives.
 *
 * Read out of the SDK's source rather than imported, deliberately. The client side of this
 * comparison is source text — a template literal in a `.tsx` file that is never executed here — so
 * the server side has to be source text too, or the two would not be comparable. Importing
 * `statementFor` and calling it would compare a rendered string against an unrendered one.
 */
const STATEMENTS_SOURCE = '../sdk/src/statements.ts';

/** Stands in for one interpolation. Visible, so a failure diff can be read. */
const SLOT = '{}';

function skeleton(source: string): string {
  return source.replace(/\$\{[^}]*\}/gs, SLOT);
}

/**
 * Every `case '…': return \`…\`;` in `statementFor`, as a skeleton with the leading `${head}\n`
 * removed — the head is built once and shared, and each client builds it separately.
 *
 * The regex requires `case` and `return` adjacent, which is why `statements.ts` carries a comment
 * forbidding anything between them. A case that falls out of the regex's reach goes unpinned; for
 * every kind a client actually signs, the comparisons below fail rather than passing quietly,
 * because `server.get(kind)` then returns `undefined` and nothing equals the expected skeleton.
 */
function serverStatements(): Map<string, string> {
  const source = read(STATEMENTS_SOURCE);
  const out = new Map<string, string>();
  for (const m of source.matchAll(/case '([a-z-]+)':\s*\n\s*return `([^`]*)`;/g)) {
    const [, kind = '', template = ''] = m;
    const body = skeleton(template);
    const headPrefix = `${SLOT}\\n`;
    out.set(kind, body.startsWith(headPrefix) ? body.slice(headPrefix.length) : body);
  }
  return out;
}

/**
 * Every backtick literal in a component that contains an `action:` line, as a skeleton.
 *
 * Interpolations are replaced across the whole file first, because prettier wraps a long one over
 * several real lines. After that a statement literal occupies a single line — which is what lets
 * the search require that, and so avoid matching the code that happens to sit between two
 * unrelated backticks elsewhere in the file.
 *
 * A leading `\n` is trimmed because some components concatenate the head and the action as two
 * literals while others build one — a difference in how the string is assembled, not in the string.
 */
function clientStatements(file: string): string[] {
  return [...skeleton(read(file)).matchAll(/`([^`\n]*action: [^`\n]*)`/g)].map((m) =>
    (m[1] ?? '').replace(/^\\n/, ''),
  );
}

const server = serverStatements();

/*
  Each entry is one client-side copy. The expected skeleton is written out here rather than derived
  from either side, so a matching edit made carelessly on *both* still has to be made deliberately
  on a third.
*/
const copies: Array<{ file: string; kind: string; expected: string }> = [
  {
    file: 'components/Comments.tsx',
    kind: 'comment',
    expected: `action: comment\\npost: ${SLOT}\\ntext: ${SLOT}`,
  },
  {
    file: 'components/FollowButton.tsx',
    kind: 'follow',
    expected: `action: ${SLOT}\\ncreator: ${SLOT}`,
  },
  {
    file: 'components/Notifications.tsx',
    kind: 'read',
    expected: `action: read\\nthread with: ${SLOT}`,
  },
  /*
    Perks. The client hashes the list itself and the route hashes the list it is about to store, so
    a drift on either side fails every save with a signature error that names nothing — the same
    exposure `publish` has, and pinned for the same reason.

    It matters more than its size suggests: these are promises published in a creator's name, and
    they are the one thing on this site no contract can hold anybody to.
  */
  {
    file: 'components/PerksEditor.tsx',
    kind: 'set-perks',
    expected: `action: set perks\\nhandle: ${SLOT}\\nperks-sha256: ${SLOT}\\nsupporters-first: ${SLOT}`,
  },
  /*
    Renaming a vault, and setting a display name. Both were writes that named an address and never
    proved it — each compared a body field against a public on-chain value, so anybody could read
    the real owner's address, send it, and write as them.
  */
  {
    file: 'components/CreatorSetup.tsx',
    kind: 'name-vault',
    expected: `action: name vault\\nvault: ${SLOT}\\nname: ${SLOT}\\nbio: ${SLOT}\\ncoin: ${SLOT}`,
  },
  {
    /*
      The read session. The only statement with no slots at all — it binds nothing but the address
      and the issue time already in the head, because there is no target to bind: it authorises
      being *asked about*, not any particular read.

      Pinned like the rest, and the failure it guards against is the loudest of them: a drift here
      rejects every sign-in, so nobody can see anything they have paid for.

      Moved out of `components/Shell.tsx`. The handshake was a side effect of rendering the
      navigation rail, so it ran on the twelve routes inside `app/(app)/` and nowhere else — and
      when the design port moved the feed, explore and the creator pages onto their own chrome, they
      silently stopped proving sessions at all. It lives in `SessionBridge` now, mounted from the
      root layout, where no route can lose it.
    */
    file: 'components/SessionBridge.tsx',
    kind: 'read-content',
    expected: `action: read content`,
  },
  {
    file: 'components/JoinFlow.tsx',
    kind: 'set-profile',
    expected: `action: set profile\\nhandle: ${SLOT}\\nname: ${SLOT}`,
  },
  /*
    Publishing. Added when the route stopped trusting the `author` field in the request body — it
    had been compared against the vault's owner read from chain, which authorises nothing, because
    a vault's owner is public and anybody could put it in the body.

    Pinned here for the same reason as the others, and with more at stake: the client rebuilds this
    statement by hand and hashes the content independently of the server, so a drift on either side
    fails every publish with a signature error that names nothing.
  */
  {
    file: 'components/StudioComposer.tsx',
    kind: 'publish',
    expected: `action: publish\\ncreator: ${SLOT}\\naccess: ${SLOT}\\ntitle: ${SLOT}\\ncontent-sha256: ${SLOT}\\nkey: ${SLOT}\\nprice: ${SLOT}`,
  },
];

describe.each(copies)('$file', ({ file, kind, expected }) => {
  it(`matches statementFor('${kind}')`, () => {
    expect(clientStatements(file)).toContain(expected);
    expect(server.get(kind)).toBe(expected);
  });
});

describe('components/Messages.tsx', () => {
  const found = clientStatements('components/Messages.tsx');

  /*
    `register-key` is deliberately absent. Publishing an encryption key is no longer a signed
    statement to this server — it is a transaction against the `key_registry` module on Sui, so
    there is nothing for the two sides to agree about. This test failing when that action was
    removed is the guard working: a statement dropped on one side and left on the other is exactly
    what it exists to catch.
  */
  const expected: Record<string, string> = {
    read: `action: read\\nthread with: ${SLOT}`,
    send: `action: send\\nto: ${SLOT}\\ntext: ${SLOT}\\npreview: ${SLOT}\\npaid: ${SLOT}`,
    'send-encrypted': `action: send encrypted\\nto: ${SLOT}\\nciphertext-sha256: ${SLOT}`,
  };

  it.each(Object.entries(expected))('builds statementFor(%s) exactly', (kind, text) => {
    expect(found).toContain(text);
    expect(server.get(kind)).toBe(text);
  });

  it('builds the same head as the server', () => {
    /*
      The head is the one part every statement shares and the one part no `case` line contains, so
      it would go unchecked by the comparisons above. Without the timestamp the replay window is
      unenforceable; without the address the signature could be verified against anyone.

      Compared against the head read out of the SDK source rather than against a literal written
      here, so this asserts the two sides agree rather than that each matches something a test
      author typed.
    */
    const clientHead = read('components/Messages.tsx').match(
      /function stmt\([^)]*\): string \{\s*return `([^`]*)`;/,
    )?.[1];
    const serverHead = read(STATEMENTS_SOURCE).match(/const head = `([^`]*)`/)?.[1];

    expect(clientHead).toBeDefined();
    expect(serverHead).toBeDefined();
    expect(skeleton(serverHead ?? '')).toBe(`Weir\\naddress: ${SLOT}\\nissued: ${SLOT}`);
    // The client appends the action line as a fourth slot; the server interpolates `${head}` and
    // then writes the action inline. Same bytes, assembled differently.
    expect(skeleton(clientHead ?? '')).toBe(`${skeleton(serverHead ?? '')}\\n${SLOT}`);
  });
});

/*
  The two assertions this file lost were policing a duplicate implementation. These three replace
  them by policing the thing that replaced it: that there is still only one.

  Worth having because the copies were not deleted by accident and will not come back by accident
  either — they come back the next time somebody needs the format somewhere it cannot be imported
  and reaches for a template literal instead. That is a legitimate impulse, which is why it needs a
  test rather than a comment.
*/
describe('the duplication stays removed', () => {
  it('lib/identity.ts re-exports the SDK function itself, not a copy of it', async () => {
    /*
      Reference equality, not behavioural equality. Two functions that agree today are exactly what
      this repository already had, twice, and agreeing today is what a copy does right up until it
      does not. If these are the same object there is nothing to drift.
    */
    const identity = await import('../lib/identity');
    const sdk = await import('@projectx-social/sdk');
    expect(identity.statementFor).toBe(sdk.statementFor);
    expect(identity.isSingleUse).toBe(sdk.isSingleUse);
    expect(identity.SIGNATURE_WINDOW_MS).toBe(sdk.SIGNATURE_WINDOW_MS);
  });

  it('lib/identity.ts builds no statement of its own', () => {
    // A `case 'x': return \`…\`` in this file means the server has started formatting statements
    // again beside the module it imports them from — the defect, returning by the door it left by.
    expect(read('lib/identity.ts')).not.toMatch(/case '[a-z-]+':\s*\n\s*return `/);
  });

  it('packages/agent builds no statement of its own', () => {
    // The 244-line hand copy that started this. It is a re-export now; if a switch reappears there,
    // an agent and this server can disagree again about bytes nobody compares at runtime.
    const agent = read('../agent/src/statements.ts');
    expect(agent).not.toMatch(/case '[a-z-]+':\s*\n\s*return `/);
    expect(agent).toMatch(/export \{[^}]*statementFor[^}]*\} from '@projectx-social\/sdk'/s);
  });
});

describe('the drift test itself', () => {
  it('would notice a changed statement', () => {
    // A test that reads files and asserts nothing useful looks identical to one that works. This
    // proves the comparison has teeth: one altered character must not match.
    expect(server.get('send')).not.toBe(`action: send\\nto: ${SLOT}\\ntext:${SLOT}`);
  });

  it('actually found statements to compare on both sides', () => {
    /*
      No count is pinned on the server side any more. A hard number there was policing a
      duplication that no longer exists, and it failed on the honest day somebody added an action.
      What still has to be true is that both sides were *found at all* — if `statements.ts` moved
      or the regex stopped reaching the switch, every `server.get` above would return `undefined`,
      and this says so in one line instead of nine.

      Every kind a client signs IS pinned, by the `copies` table and the `Messages.tsx` block. The
      full union is pinned to captured bytes in `packages/sdk/test/statements.test.ts`.
    */
    expect(server.size).toBeGreaterThan(10);
    for (const { kind } of copies) expect(server.get(kind)).toBeDefined();
    expect(clientStatements('components/Messages.tsx').length).toBe(4);
  });
});
