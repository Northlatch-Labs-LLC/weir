// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';
import { accessStatement, parseAccessStatement } from '../src/statements.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEAD_LINES,
  isSingleUse,
  statementFor,
  SIGNATURE_WINDOW_MS,
  STATEMENT_SHAPES,
  type Action,
} from '../src/statements.js';

const ADDRESS = `0x${'ab'.repeat(32)}`;
const ORIGIN = 'https://weir.social';
const AT = 1_756_600_000_000;

const GOLDEN: Readonly<Record<string, string>> = {
  "comment": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: comment\npost: pmtgxlqay\ntext: a comment — with an em dash",
  "follow(true)": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: follow\ncreator: atlas",
  "follow(false)": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: unfollow\ncreator: atlas",
  "send": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: send\nto: 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd\ntext: hello\npreview: hel\npaid: atlas:key-1:10000",
  "send(free)": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: send\nto: 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd\ntext: hello\npreview: hel\npaid: ",
  "send-encrypted": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: send encrypted\nto: 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd\nciphertext-sha256: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "read": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: read\nthread with: 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
  "onramp": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: fund wallet\nwallet: 0xabababababababababababababababababababababababababababababababab\nnetwork: mainnet",
  "read-content": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: read content",
  "publish": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: publish\ncreator: atlas\naccess: paid\ntitle: Sealed on Walrus\ncontent-sha256: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\nkey: sealed-on-walrus-001\nprice: 10000",
  "name-vault": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: name vault\nvault: 0x1111111111111111111111111111111111111111111111111111111111111111\nname: Atlas\nbio: Documentary notes.\ncoin: 0x2::sui::SUI",
  "set-profile": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: set profile\nhandle: atlas\nname: Atlas",
  "set-perks(true)": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: set perks\nhandle: atlas\nperks-sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsupporters-first: yes",
  "set-perks(false)": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: set perks\nhandle: atlas\nperks-sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsupporters-first: no",
  "declare-agent": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: declare agent\noperated by: 0x2222222222222222222222222222222222222222222222222222222222222222\nmodel: claude-opus-5\npurpose: publishes notes",
  "declare-operator": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: declare operator\noperating: 0x3333333333333333333333333333333333333333333333333333333333333333\nmodel: claude-opus-5\npurpose: publishes notes",
  "upload": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: upload\npost: pmtgxlqay\nfile-sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "seek-operator": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: seek operator\nhandle: wanderer\nmodel: claude-opus-5\npurpose: publishes notes\nwords: I read contracts and write what they do. Claim me and I will earn.",
  "remember": "Weir\naddress: 0xabababababababababababababababababababababababababababababababab\nissued: 1756600000000\norigin: https://weir.social\naction: remember\nlabel: session-notes\nciphertext-sha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\nbytes: 4096",
};

const CASES: ReadonlyArray<readonly [string, Action]> = [
  ['comment', { kind: 'comment', postId: 'pmtgxlqay', text: 'a comment — with an em dash' }],
  ['follow(true)', { kind: 'follow', handle: 'atlas', following: true }],
  ['follow(false)', { kind: 'follow', handle: 'atlas', following: false }],
  [
    'send',
    { kind: 'send', to: `0x${'cd'.repeat(32)}`, text: 'hello', preview: 'hel', paid: 'atlas:key-1:10000' },
  ],
  ['send(free)', { kind: 'send', to: `0x${'cd'.repeat(32)}`, text: 'hello', preview: 'hel', paid: '' }],
  [
    'send-encrypted',
    { kind: 'send-encrypted', to: `0x${'cd'.repeat(32)}`, ciphertextSha256: 'e'.repeat(64) },
  ],
  ['read', { kind: 'read', other: `0x${'cd'.repeat(32)}` }],
  ['read-content', { kind: 'read-content' }],
  [
    'onramp',
    { kind: 'onramp', walletAddress: `0x${'ab'.repeat(32)}`, network: 'mainnet' },
  ],

  [
    'publish',
    {
      kind: 'publish',
      handle: 'atlas',
      title: 'Sealed on Walrus',
      access: 'paid',
      contentSha256: 'f'.repeat(64),
      contentKey: 'sealed-on-walrus-001',
      price: '10000',
    },
  ],
  [
    'name-vault',
    {
      kind: 'name-vault',
      vaultId: `0x${'11'.repeat(32)}`,
      name: 'Atlas',
      bio: 'Documentary notes.',
      coinType: '0x2::sui::SUI',
    },
  ],
  ['set-profile', { kind: 'set-profile', handle: 'atlas', name: 'Atlas' }],
  [
    'set-perks(true)',
    { kind: 'set-perks', handle: 'atlas', perksSha256: 'a'.repeat(64), supportersFirst: true },
  ],
  [
    'set-perks(false)',
    { kind: 'set-perks', handle: 'atlas', perksSha256: 'a'.repeat(64), supportersFirst: false },
  ],
  [
    'declare-agent',
    { kind: 'declare-agent', operator: `0x${'22'.repeat(32)}`, model: 'claude-opus-5', purpose: 'publishes notes' },
  ],
  [
    'declare-operator',
    { kind: 'declare-operator', agent: `0x${'33'.repeat(32)}`, model: 'claude-opus-5', purpose: 'publishes notes' },
  ],
  ['remember', { kind: 'remember', label: 'session-notes', sha256: 'c'.repeat(64), bytes: '4096' }],
  [
    'seek-operator',
    { kind: 'seek-operator', handle: 'wanderer', model: 'claude-opus-5', purpose: 'publishes notes', words: 'I read contracts and write what they do. Claim me and I will earn.' },
  ],
  ['upload', { kind: 'upload', postId: 'pmtgxlqay', fileSha256: 'b'.repeat(64) }],
];

describe('statementFor still builds the bytes it built before the hoist', () => {
  it.each(CASES)('%s', (label, action) => {
    expect(statementFor(action, ADDRESS, AT, ORIGIN)).toBe(GOLDEN[label]);
  });

  it('pins every case, and no vector goes unused', () => {
    expect(CASES.map(([label]) => label).sort()).toEqual(Object.keys(GOLDEN).sort());
  });

  it('everyKindIsCovered', () => {
    const covered: Record<Action['kind'], true> = {
      comment: true,
      follow: true,
      send: true,
      'send-encrypted': true,
      read: true,
      'read-content': true,
      onramp: true,
      publish: true,
      'name-vault': true,
      'set-profile': true,
      'set-perks': true,
      'declare-agent': true,
      'declare-operator': true,
      upload: true,
      remember: true,
      'seek-operator': true,
    };
    expect([...new Set(CASES.map(([, action]) => action.kind))].sort()).toEqual(
      Object.keys(covered).sort(),
    );
    expect(Object.keys(covered)).toHaveLength(16);
  });

  it('would notice a single changed byte', () => {
    const real = statementFor({ kind: 'read', other: 'x' }, ADDRESS, AT, ORIGIN);
    expect(real.replace('thread with: ', 'thread with:')).not.toBe(real);
    expect(GOLDEN['read']).not.toBe(
      statementFor({ kind: 'read', other: `0x${'cd'.repeat(32)}` }, ADDRESS, AT + 1, ORIGIN),
    );
  });
});

describe('isSingleUse', () => {
  it('spends every kind, with no exemption', () => {
    for (const [, action] of CASES) {
      expect([action.kind, isSingleUse(action)]).toEqual([action.kind, true]);
    }
  });
});

describe('SIGNATURE_WINDOW_MS', () => {
  it('is ten minutes', () => {
    expect(SIGNATURE_WINDOW_MS).toBe(600_000);
  });
});

describe('STATEMENT_SHAPES', () => {
  it('names lines that really appear in the statement it describes', () => {
    for (const [, action] of CASES) {
      const lines = statementFor(action, ADDRESS, AT, ORIGIN).split('\n').slice(HEAD_LINES);
      const shape = STATEMENT_SHAPES[action.kind];
      for (const line of lines) {
        expect(shape.some((s) => line === s || line.startsWith(s))).toBe(true);
      }
    }
  });

  it('publishes both rendered forms of every branching line', () => {
    expect(STATEMENT_SHAPES.follow).toEqual(['action: follow', 'action: unfollow', 'creator: ']);
    expect(STATEMENT_SHAPES['set-perks']).toEqual([
      'action: set perks',
      'handle: ',
      'perks-sha256: ',
      'supporters-first: yes',
      'supporters-first: no',
    ]);
  });

  it('describes every kind', () => {
    expect(Object.keys(STATEMENT_SHAPES)).toHaveLength(16);
  });
});

describe('the module stays importable by a browser and by a stranger', () => {
  it('imports nothing at all', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/statements.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

describe('accessStatement — the tier rides on the access line', () => {
  it('leaves tier 0 and non-subscriber posts exactly as they were signed before', () => {
    expect(accessStatement('subscribers', 0)).toBe('subscribers');
    expect(accessStatement('subscribers')).toBe('subscribers');
    expect(accessStatement('public', 3)).toBe('public');
    expect(accessStatement('paid', 3)).toBe('paid');
  });
  it('binds a non-zero tier, and parses it back', () => {
    expect(accessStatement('subscribers', 2)).toBe('subscribers:2');
    expect(parseAccessStatement('subscribers:2')).toEqual({ access: 'subscribers', tier: 2 });
    expect(parseAccessStatement('subscribers')).toEqual({ access: 'subscribers', tier: 0 });
    expect(parseAccessStatement('subscribers:0')).toBeNull();
    expect(parseAccessStatement('subscribers:x')).toBeNull();
  });
  it('refuses a tier that is not a whole number', () => {
    expect(() => accessStatement('subscribers', 1.5)).toThrow(RangeError);
    expect(() => accessStatement('subscribers', -1)).toThrow(RangeError);
  });
});
