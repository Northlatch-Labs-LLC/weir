// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
    expect(skeleton(serverHead ?? '')).toBe(
      `Weir\\naddress: ${SLOT}\\nissued: ${SLOT}\\norigin: ${SLOT}`,
    );
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

    // The encryption scheme was hoisted the same way on 2026-09-02: lib/e2e.ts is a pointer.
    const e2e = await import('../lib/e2e');
    expect(e2e.encrypt).toBe(sdk.encrypt);
    expect(e2e.decrypt).toBe(sdk.decrypt);
    expect(e2e.deriveSecret).toBe(sdk.deriveSecret);
    expect(e2e.KEY_STATEMENT).toBe(sdk.KEY_STATEMENT);
  });

  it('lib/identity.ts builds no statement of its own', () => {
    // A `case 'x': return \`…\`` in this file means the server has started formatting statements
    // again beside the module it imports them from — the defect, returning by the door it left by.
    expect(STATEMENT_SWITCH.test(read('lib/identity.ts'))).toBe(false);
  });

  /**
   * A statement-formatting switch: `case 'x':` followed by a returned template literal.
   *
   * Built with `RegExp` rather than written as a literal because the pattern ends in a backtick,
   * and a backtick inside a regex literal is legal JavaScript that esbuild's lexer rejects in some
   * positions. One definition, used by both assertions below.
   */
  const STATEMENT_SWITCH = new RegExp("case '[a-z-]+':\\s*\\n\\s*return `");

  /*
    Asserted across every package rather than by naming one.

    This used to read `../agent/src/statements.ts` directly. That named the package the 244-line
    hand copy actually lived in, and it was right about that package and blind to every other one —
    a seventh package growing a switch of its own would not have been noticed, and the check broke
    outright the moment the agent package was not present in the tree being tested.

    Walking each package's own `src` directory fixes both. The SDK is excluded because it is where the one
    implementation belongs; every other package is asserted to have none, whether or not it exists
    yet.
  */
  const statementSwitches = (): string[] => {
    const offenders: string[] = [];
    const packages = join(root, '..');
    for (const pkg of readdirSync(packages, { withFileTypes: true })) {
      if (!pkg.isDirectory() || pkg.name === 'sdk') continue;
      const src = join(packages, pkg.name, 'src');
      let files: string[];
      try {
        files = readdirSync(src, { recursive: true, encoding: 'utf8' });
      } catch {
        continue; // no src/ in this package
      }
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        const full = join(src, file);
        let body: string;
        try {
          body = readFileSync(full, 'utf8');
        } catch {
          continue; // a directory entry, not a file
        }
        if (STATEMENT_SWITCH.test(body)) {
          offenders.push(`packages/${pkg.name}/src/${file}`);
        }
      }
    }
    return offenders;
  };

  it('no package outside the SDK formats a statement of its own', () => {
    // Named in the failure, so it says which package returned by the door it left by.
    expect(statementSwitches()).toEqual([]);
  });

  it('packages/agent re-exports the builder, when that package is present', () => {
    /*
      The 244-line hand copy that started this. It is a re-export now.

      Conditional on the file existing because this suite runs in trees where the agent package has
      not been added yet, and a hard read there fails with ENOENT — reporting a missing package as
      a drift defect. The assertion above is the one that holds unconditionally; this one adds that
      the replacement is a re-export rather than merely not-a-switch.
    */
    const path = join(root, '..', 'agent', 'src', 'statements.ts');
    if (!existsSync(path)) return;
    expect(readFileSync(path, 'utf8')).toMatch(
      /export \{[^}]*statementFor[^}]*\} from '@projectx-social\/sdk'/s,
    );
  });
});

/*
  The publish digest, which is the one signed value a caller must COMPUTE rather than supply.

  The statement text above is pinned across every client component. The digest inside it was not,
  and it is written out by hand in four independent production files: the route that verifies it,
  the agent library, the browser composer, and the room package. Nothing tied any of them together.

  Change the formula in the route and the browser keeps signing yesterday's bytes. Every person
  publishing then gets "the signature does not prove control of 0x…", which points at their wallet
  rather than at our typo, and every suite stays green while it happens.

  Found on 2026-09-03 by tracing why `publish()` has the highest betweenness in the graph: it is
  the seam where the human path re-implements what the machine path implements.

  Read as TEXT, not imported and called. Two implementations that are both wrong in the same way
  agree perfectly at runtime — which is exactly what the agent package's own test does today, since
  it compares `publishContentSha256` against a copy of the formula written inside the test. This
  compares the source lines to the ROUTE's line, so a change to the authority breaks every copy
  that did not follow it.
*/
describe('the publish digest is written the same way everywhere', () => {
  /** The one line that decides whether a publish signature verifies. */
  const DIGEST = /\.update\(`\$\{preview\.length\}:\$\{preview\}\$\{(?:text|body)\.length\}:\$\{(?:text|body)\}`\)/;

  /*
    The route is the authority: it is what rebuilds the bytes and decides whether the signature
    stands. Every other copy is measured against this one, never against each other.
  */
  const ROUTE = 'app/api/posts/route.ts';

  const copies: Array<{ what: string; path: string; pattern: RegExp }> = [
    { what: 'the agent library', path: '../agent/src/statements.ts', pattern: DIGEST },
    { what: 'the room package', path: '../room/src/transcript.ts', pattern: DIGEST },
    /*
      The browser cannot import node:crypto, so it hashes through SubtleCrypto and the formula sits
      inside the call rather than after `.update(`. Same bytes, different spelling — pinned with its
      own pattern rather than excused.
    */
    {
      what: 'the browser composer',
      path: 'components/StudioComposer.tsx',
      pattern: /sha256Hex\(`\$\{preview\.length\}:\$\{preview\}\$\{text\.length\}:\$\{text\}`\)/,
    },
  ];

  it('the route contains the formula this test is pinned to', () => {
    // If this fails, the authority moved and every expectation below is measuring nothing.
    expect(read(ROUTE)).toMatch(DIGEST);
  });

  for (const { what, path, pattern } of copies) {
    it(`${what} builds the digest exactly as the route does`, () => {
      const full = join(root, path);
      // Conditional for the same reason the agent re-export check above is: this suite runs in
      // trees where a sibling package is absent, and ENOENT there is a missing package, not drift.
      if (!existsSync(full)) return;
      const body = readFileSync(full, 'utf8');
      expect(
        pattern.test(body),
        `${path} no longer builds the publish digest the way ${ROUTE} does. ` +
          'A publish signed there will not verify. Change all four together or none.',
      ).toBe(true);
    });
  }

  it('the published recipe still describes what the route computes', () => {
    // The prose an agent reads. `agent-manifest.test.ts` proves the recipe is arithmetically
    // correct; this proves the guide and the manifest still carry it at all.
    for (const path of ['public/llms.txt', 'lib/agent-manifest.ts']) {
      expect(read(path)).toContain('${preview.length}:${preview}${text.length}:${text}');
    }
  });

  it('would notice a changed digest', () => {
    // Teeth. A near-miss — one side dropping a length prefix — must not match.
    expect(DIGEST.test('.update(`${preview}${text}`)')).toBe(false);
    expect(DIGEST.test('.update(`${preview.length}:${preview}${text}`)')).toBe(false);
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

/*
  The HEAD, which this file did not pin until now.

  Everything above compares the ACTION lines and deliberately strips the head, on the reasoning that
  "the head is built once and shared". It is not shared: `statementFor` builds one and each of nine
  client components builds another by hand, and nothing compared them. So the one part of the
  statement common to every signature on the site was the one part with no drift protection — and it
  is exactly the part that changed when `origin` was bound into it.

  A client that misses the change signs the old bytes. The server rebuilds the new ones, the
  signature does not verify, and the user is told "the signature does not prove control of 0x…",
  which points at their wallet rather than at our typo. That is the failure this file exists to
  prevent, for the part it was not covering.
*/
describe('the head', () => {
  /** Every hand-built head in the client, as a skeleton. */
  function clientHeads(file: string): string[] {
    return [...skeleton(read(file)).matchAll(/Weir\\naddress: [^`\n]*?(?=\\naction|`)/g)]
      .map((m) => m[0] ?? '')
      /*
        The components do not agree on where the head ends: most write the head and the action as
        separate literals, and `Messages.tsx` writes `${head}\n${action}` as one. So a trailing bare
        slot is the action arriving inside the head match, and is removed rather than reported as a
        drift that is not there.

        Captured permissively and then compared, rather than matched against the expected head
        directly. A regex that only matches the correct head turns a drift into "no head found",
        which is a worse message than a diff — and an assertion that can only compare a string
        against itself is not comparing anything.
      */
      .map((head) => head.replace(/\\n\{\}$/, ''));
  }

  const serverHead = (() => {
    const source = read(STATEMENTS_SOURCE);
    const m = /const head = `([^`]*)`/.exec(source);
    return skeleton(m?.[1] ?? '');
  })();

  it('is built by the server with an origin in it', () => {
    // The property, not the punctuation: without this line the bytes are portable, and a signature
    // collected by any other deployment of this software verifies here.
    expect(serverHead).toContain('origin: ');
    expect(serverHead).toContain('Weir\\naddress: ');
    expect(serverHead).toContain('issued: ');
  });

  const files = [
    'components/Comments.tsx',
    'components/CreatorSetup.tsx',
    'components/FollowButton.tsx',
    'components/JoinFlow.tsx',
    'components/Messages.tsx',
    'components/Notifications.tsx',
    'components/PerksEditor.tsx',
    'components/SessionBridge.tsx',
    'components/StudioComposer.tsx',
  ];

  it('is built by every client component this test knows about', () => {
    // Guards against a vacuous pass: a rename that empties this list would make every assertion
    // below hold over nothing.
    for (const file of files) expect(existsSync(join(root, file)), file).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it.each(files)('%s builds the same head as the server', (file) => {
    const heads = clientHeads(file);
    expect(heads.length, `${file} builds no statement head this test can find`).toBeGreaterThan(0);
    for (const head of heads) {
      expect(head, `${file} drifted from statementFor`).toBe(serverHead);
    }
  });

  it('no client component still signs a head without an origin', () => {
    /*
      The direct form of the finding. A component that kept the old two-line head would fail the
      comparison above too, but this says why in one line rather than as a diff of two skeletons.
    */
    for (const file of files) {
      for (const head of clientHeads(file)) {
        expect(head, `${file} signs bytes that are not bound to this deployment`).toContain(
          'origin: ',
        );
      }
    }
  });
});
