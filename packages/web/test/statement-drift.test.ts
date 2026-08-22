// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The signed statements are duplicated across a boundary no compiler checks.
 *
 * `lib/identity.ts` rebuilds the statement server-side and verifies the signature against it; four
 * client components build the same text independently, because a browser component cannot import
 * a `server-only` module. Nothing ties the two together — a stray space added on one side makes
 * every signature of that kind fail to verify, and the message the user gets is
 * "the signature does not prove control of 0x…", which points at the wallet rather than the typo.
 *
 * So this test reads both sides from disk and compares them.
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

/** Stands in for one interpolation. Visible, so a failure diff can be read. */
const SLOT = '{}';

function skeleton(source: string): string {
  return source.replace(/\$\{[^}]*\}/gs, SLOT);
}

/**
 * Every `case '…': return \`…\`;` in `statementFor`, as a skeleton with the leading `${head}\n`
 * removed — the head is built once and shared, and each client builds it separately.
 */
function serverStatements(): Map<string, string> {
  const source = read('lib/identity.ts');
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

describe('lib/identity.ts statementFor', () => {
  it('defines exactly the actions the Action union declares', () => {
    // A case added to the union without a statement would not compile; a case whose *name* changed
    // would, and would silently stop matching what the client signs.
    expect([...server.keys()].sort()).toEqual([
      'comment',
      'follow',
      'name-vault',
      'publish',
      'read',
      'read-content',
      'send',
      'send-encrypted',
      'set-perks',
      'set-profile',
      'upload',
    ]);
  });

  it('names the address and the issue time in every statement', () => {
    // The shared head. Without the timestamp the replay window is unenforceable; without the
    // address the signature could be verified against anyone.
    const head = read('lib/identity.ts').match(/const head = `([^`]*)`/)?.[1] ?? '';
    expect(head).toContain('address: ');
    expect(head).toContain('issued: ');
  });
});

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
    Publishing. Added when the route stopped trusting the `author` field in the request body — it
    had been compared against the vault's owner read from chain, which authorises nothing, because
    a vault's owner is public and anybody could put it in the body.

    Pinned here for the same reason as the others, and with more at stake: the client rebuilds this
    statement by hand and hashes the content independently of the server, so a drift on either side
    fails every publish with a signature error that names nothing.
  */
  /*
    The three writes that named an address and never proved it: renaming a vault, setting a display
    name, and attaching media. Each compared a body field against a public on-chain value, so
    anybody could read the real owner's address, send it, and write as them.
  */
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
  {
    file: 'components/CreatorSetup.tsx',
    kind: 'name-vault',
    expected: `action: name vault\\nvault: ${SLOT}\\nname: ${SLOT}\\nbio: ${SLOT}\\ncoin: ${SLOT}`,
  },
  /*
    The read session. The only statement with no slots at all — it binds nothing but the address and
    the issue time already in the head, because there is no target to bind: it authorises being
    *asked about*, not any particular read.

    Pinned like the rest, and the failure it guards against is the loudest of them: a drift here
    rejects every sign-in, so nobody can see anything they have paid for.
  */
  {
    /*
      Moved out of `components/Shell.tsx`.

      The handshake was a side effect of rendering the navigation rail, so it ran on the twelve
      routes inside `app/(app)/` and nowhere else — and when the design port moved the feed, explore
      and the creator pages onto their own chrome, they silently stopped proving sessions at all.
      It lives in `SessionBridge` now, mounted from the root layout, where no route can lose it.
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
    const stmt = read('components/Messages.tsx').match(
      /function stmt\([^)]*\): string \{\s*return `([^`]*)`;/,
    )?.[1];
    expect(stmt).toBeDefined();
    expect(skeleton(stmt ?? '')).toBe(
      `Weir\\naddress: ${SLOT}\\nissued: ${SLOT}\\n${SLOT}`,
    );
  });
});

describe('the drift test itself', () => {
  it('would notice a changed statement', () => {
    // A test that reads files and asserts nothing useful looks identical to one that works. This
    // proves the comparison has teeth: one altered character must not match.
    expect(server.get('send')).not.toBe(`action: send\\nto: ${SLOT}\\ntext:${SLOT}`);
  });

  it('actually found statements to compare on both sides', () => {
    // Eleven since perks became a signed action. The count is asserted rather than derived so
    // that a case silently dropping out of the regex's reach — a comment landing between `case`
    // and `return` will do it — fails here instead of quietly leaving a statement unpinned.
    expect(server.size).toBe(11);
    expect(clientStatements('components/Messages.tsx').length).toBe(4);
  });
});
