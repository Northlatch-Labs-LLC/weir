// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

const STATEMENTS_SOURCE = '../sdk/src/statements.ts';

const SLOT = '{}';

function skeleton(source: string): string {
  return source.replace(/\$\{[^}]*\}/gs, SLOT);
}

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

function clientStatements(file: string): string[] {
  return [...skeleton(read(file)).matchAll(/`([^`\n]*action: [^`\n]*)`/g)].map((m) =>
    (m[1] ?? '').replace(/^\\n/, ''),
  );
}

const server = serverStatements();

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
  {
    file: 'components/SignerProvider.tsx',
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
    const clientHead = read('components/Messages.tsx').match(
      /function stmt\([^)]*\): string \{\s*return `([^`]*)`;/,
    )?.[1];
    const serverHead = read(STATEMENTS_SOURCE).match(/const head = `([^`]*)`/)?.[1];

    expect(clientHead).toBeDefined();
    expect(serverHead).toBeDefined();
    expect(skeleton(serverHead ?? '')).toBe(
      `Weir\\naddress: ${SLOT}\\nissued: ${SLOT}\\norigin: ${SLOT}`,
    );
    expect(skeleton(clientHead ?? '')).toBe(`${skeleton(serverHead ?? '')}\\n${SLOT}`);
  });
});

describe('the duplication stays removed', () => {
  it('lib/identity.ts re-exports the SDK function itself, not a copy of it', async () => {
    const identity = await import('../lib/identity');
    const sdk = await import('@projectx-social/sdk');
    expect(identity.statementFor).toBe(sdk.statementFor);
    expect(identity.isSingleUse).toBe(sdk.isSingleUse);
    expect(identity.SIGNATURE_WINDOW_MS).toBe(sdk.SIGNATURE_WINDOW_MS);

    const e2e = await import('../lib/e2e');
    expect(e2e.encrypt).toBe(sdk.encrypt);
    expect(e2e.decrypt).toBe(sdk.decrypt);
    expect(e2e.deriveSecret).toBe(sdk.deriveSecret);
    expect(e2e.KEY_STATEMENT).toBe(sdk.KEY_STATEMENT);
  });

  it('lib/identity.ts builds no statement of its own', () => {
    expect(STATEMENT_SWITCH.test(read('lib/identity.ts'))).toBe(false);
  });

  const STATEMENT_SWITCH = new RegExp("case '[a-z-]+':\\s*\\n\\s*return `");

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
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        const full = join(src, file);
        let body: string;
        try {
          body = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        if (STATEMENT_SWITCH.test(body)) {
          offenders.push(`packages/${pkg.name}/src/${file}`);
        }
      }
    }
    return offenders;
  };

  it('no package outside the SDK formats a statement of its own', () => {
    expect(statementSwitches()).toEqual([]);
  });

  it('packages/agent re-exports the builder, when that package is present', () => {
    const path = join(root, '..', 'agent', 'src', 'statements.ts');
    if (!existsSync(path)) return;
    expect(readFileSync(path, 'utf8')).toMatch(
      /export \{[^}]*statementFor[^}]*\} from '@projectx-social\/sdk'/s,
    );
  });
});

describe('the publish digest is written the same way everywhere', () => {
  const DIGEST = /\.update\(`\$\{preview\.length\}:\$\{preview\}\$\{(?:text|body)\.length\}:\$\{(?:text|body)\}`\)/;

  const ROUTE = 'app/api/posts/route.ts';

  const copies: Array<{ what: string; path: string; pattern: RegExp }> = [
    { what: 'the agent library', path: '../agent/src/statements.ts', pattern: DIGEST },
    { what: 'the room package', path: '../room/src/transcript.ts', pattern: DIGEST },
    {
      what: 'the browser composer',
      path: 'components/StudioComposer.tsx',
      pattern: /sha256Hex\(`\$\{preview\.length\}:\$\{preview\}\$\{text\.length\}:\$\{text\}`\)/,
    },
  ];

  it('the route contains the formula this test is pinned to', () => {
    expect(read(ROUTE)).toMatch(DIGEST);
  });

  for (const { what, path, pattern } of copies) {
    it(`${what} builds the digest exactly as the route does`, () => {
      const full = join(root, path);
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
    for (const path of ['public/llms.txt', 'lib/agent-manifest.ts']) {
      expect(read(path)).toContain('${preview.length}:${preview}${text.length}:${text}');
    }
  });

  it('would notice a changed digest', () => {
    expect(DIGEST.test('.update(`${preview}${text}`)')).toBe(false);
    expect(DIGEST.test('.update(`${preview.length}:${preview}${text}`)')).toBe(false);
  });
});

describe('the drift test itself', () => {
  it('would notice a changed statement', () => {
    expect(server.get('send')).not.toBe(`action: send\\nto: ${SLOT}\\ntext:${SLOT}`);
  });

  it('actually found statements to compare on both sides', () => {
    expect(server.size).toBeGreaterThan(10);
    for (const { kind } of copies) expect(server.get(kind)).toBeDefined();
    expect(clientStatements('components/Messages.tsx').length).toBe(4);
  });
});

describe('the head', () => {
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
    'components/SignerProvider.tsx',
    'components/StudioComposer.tsx',
  ];

  it('is built by every client component this test knows about', () => {
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
    for (const file of files) {
      for (const head of clientHeads(file)) {
        expect(head, `${file} signs bytes that are not bound to this deployment`).toContain(
          'origin: ',
        );
      }
    }
  });
});
