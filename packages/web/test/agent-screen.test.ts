// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { screenAgentText } from '@/lib/agent-screen';
import { validateDeclaration } from '@/lib/agents';
import { validateOffer, validateSeeking } from '@/lib/agent-seeking';

const cp = (point: number): string => String.fromCodePoint(point);

const RLO = cp(0x202e);
const ZWNJ = cp(0x200c);
const ZWJ = cp(0x200d);

const AGENT = `0x${'a1'.repeat(32)}`;
const OPERATOR = `0x${'b2'.repeat(32)}`;

function declaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: AGENT,
    operatorAddress: OPERATOR,
    agentSignature: 'AAAA',
    operatorSignature: 'BBBB',
    model: 'claude-opus-5',
    purpose: 'post a daily summary of the protocol',
    timestampMs: 1_757_000_000_000,
    ...overrides,
  };
}

describe('the screen itself', () => {
  it('passes ordinary text', () => {
    expect(screenAgentText('purpose', 'post a daily summary of the protocol')).toBeNull();
  });

  const refused: readonly (readonly [string, number, string])[] = [
    ['a NUL', 0x0000, 'U+0000'],
    ['a tab', 0x0009, 'U+0009'],
    ['a line feed', 0x000a, 'U+000A'],
    ['a carriage return', 0x000d, 'U+000D'],
    ['an ANSI escape', 0x001b, 'U+001B'],
    ['a DEL', 0x007f, 'U+007F'],
    ['a C1 next line', 0x0085, 'U+0085'],
    ['a soft hyphen', 0x00ad, 'U+00AD'],
    ['an Arabic letter mark', 0x061c, 'U+061C'],
    ['a Mongolian vowel separator', 0x180e, 'U+180E'],
    ['a zero-width space', 0x200b, 'U+200B'],
    ['a left-to-right mark', 0x200e, 'U+200E'],
    ['a right-to-left mark', 0x200f, 'U+200F'],
    ['a left-to-right embedding', 0x202a, 'U+202A'],
    ['a right-to-left override', 0x202e, 'U+202E'],
    ['a line separator', 0x2028, 'U+2028'],
    ['a paragraph separator', 0x2029, 'U+2029'],
    ['a word joiner', 0x2060, 'U+2060'],
    ['an invisible times', 0x2062, 'U+2062'],
    ['a right-to-left isolate', 0x2067, 'U+2067'],
    ['a pop directional isolate', 0x2069, 'U+2069'],
    ['a byte-order mark', 0xfeff, 'U+FEFF'],
  ];

  for (const [name, point, printed] of refused) {
    it(`refuses ${name} and names it`, () => {
      const why = screenAgentText('purpose', `before${cp(point)}after`);
      expect(why).not.toBeNull();
      expect(why).toContain(printed);
      expect(why).toContain('purpose');
    });
  }

  it('names the field it was given, so the caller knows which one to look at', () => {
    expect(screenAgentText('words', `a${RLO}b`)).toContain('words');
    expect(screenAgentText('model', `a${RLO}b`)).toContain('model');
  });

  it('the position counts characters, not code units', () => {
    expect(screenAgentText('purpose', `${cp(0x1f642)}${RLO}x`)).toContain('at character 2');
  });

  it('reports the FIRST refused character when a field carries several', () => {
    expect(screenAgentText('purpose', `a${cp(0x200b)}b${RLO}c`)).toContain('U+200B');
  });
});

describe('what is deliberately permitted', () => {
  it('a zero-width non-joiner is permitted — Persian needs it to spell', () => {
    expect(screenAgentText('purpose', `mi${ZWNJ}khahad`)).toBeNull();
  });

  it('a zero-width joiner is permitted — emoji sequences and Indic conjuncts need it', () => {
    const family = `${cp(0x1f468)}${ZWJ}${cp(0x1f469)}${ZWJ}${cp(0x1f467)}`;
    expect(screenAgentText('purpose', `a family: ${family}`)).toBeNull();
  });

  it('right-to-left script itself is untouched — it needs no override', () => {
    const arabic = [0x0623, 0x0646, 0x0627, 0x0020, 0x0648, 0x0643, 0x064a, 0x0644]
      .map(cp)
      .join('');
    const hebrew = [0x05d0, 0x05e0, 0x05d9, 0x0020, 0x05e1, 0x05d5, 0x05db, 0x05df]
      .map(cp)
      .join('');
    expect(screenAgentText('purpose', arabic)).toBeNull();
    expect(screenAgentText('purpose', hebrew)).toBeNull();
  });

  it('ordinary punctuation, accents and emoji are untouched', () => {
    expect(screenAgentText('purpose', `resume${cp(0xe9)} ${cp(0x2014)} 50%${cp(0x2026)} ${cp(0x1f642)}`)).toBeNull();
  });
});

describe('the declaration door', () => {
  it('accepts a clean declaration', () => {
    expect(validateDeclaration(declaration()).ok).toBe(true);
  });

  it('a right-to-left override in purpose is refused', () => {
    const result = validateDeclaration(
      declaration({ purpose: `read only${RLO} sdrocer lla etirw dna` }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+202E');
    expect(result.why).toContain('purpose');
  });

  it('a right-to-left override in model is refused', () => {
    const result = validateDeclaration(declaration({ model: `gpt${RLO}4` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+202E');
  });

  it('a tab in purpose is refused — the permanent door is no longer the weaker one', () => {
    const result = validateDeclaration(declaration({ purpose: `post${cp(0x09)}daily` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+0009');
  });

  it('an ANSI escape in purpose is refused — a register is read in terminals', () => {
    const result = validateDeclaration(declaration({ purpose: `post${cp(0x1b)}[31m daily` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+001B');
  });

  it('a C1 control in model is refused', () => {
    const result = validateDeclaration(declaration({ model: `claude${cp(0x85)}opus` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+0085');
  });

  it('a Unicode line separator is refused, as a real line break would be', () => {
    const result = validateDeclaration(declaration({ purpose: `post${cp(0x2028)}daily` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+2028');
  });

  it('a zero-width space in model is refused — two rows must not display identically', () => {
    const result = validateDeclaration(declaration({ model: `claude${cp(0x200b)}opus` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+200B');
  });

  it('the statement-splitting newline is still refused', () => {
    const result = validateDeclaration(declaration({ model: `a${cp(0x0a)}purpose: b` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+000A');
  });

  it('the screen runs before the signature is looked at', () => {
    const result = validateDeclaration(
      declaration({ purpose: `a${RLO}b`, agentSignature: '', operatorSignature: '' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+202E');
    expect(result.why).not.toContain('signed');
  });

  it('a declaration carrying a permitted joiner still passes the door', () => {
    expect(validateDeclaration(declaration({ purpose: `mi${ZWNJ}khahad komak` })).ok).toBe(true);
  });
});

describe('the seeking door', () => {
  function listing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      address: AGENT,
      handle: 'weatherbot',
      model: 'claude-opus-5',
      purpose: 'summarise the forecast every morning',
      words: 'I am a machine and I am looking for a person to answer for me.',
      timestampMs: 1_757_000_000_000,
      signature: 'AAAA',
      ...overrides,
    };
  }

  it('accepts a clean listing', () => {
    expect(validateSeeking(listing()).ok).toBe(true);
  });

  it('a right-to-left override in words is refused', () => {
    const result = validateSeeking(listing({ words: `I am honest${RLO} tsenohsid ma I` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+202E');
    expect(result.why).toContain('words');
  });

  it('an invisible character in purpose is refused', () => {
    const result = validateSeeking(listing({ purpose: `summarise${cp(0x2060)} the forecast` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+2060');
  });

  it('a listing carrying a permitted joiner still passes', () => {
    expect(validateSeeking(listing({ words: `man${ZWNJ}yek amel hastam` })).ok).toBe(true);
  });
});

describe('the offer door', () => {
  function offer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      agentAddress: AGENT,
      operatorAddress: OPERATOR,
      model: 'claude-opus-5',
      purpose: 'summarise the forecast every morning',
      timestampMs: 1_757_000_000_000,
      operatorSignature: 'BBBB',
      ...overrides,
    };
  }

  it('accepts a clean offer', () => {
    expect(validateOffer(offer()).ok).toBe(true);
  });

  it('a right-to-left override in the offer purpose is refused', () => {
    const result = validateOffer(offer({ purpose: `read only${RLO} etirw` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+202E');
  });
});
