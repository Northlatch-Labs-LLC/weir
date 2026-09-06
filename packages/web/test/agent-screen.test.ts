// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The screen over what an agent brings to the onboarding door, and the three doors that run it.

  What is being proved here is one property: a field the register stores and a wallet displays
  cannot carry a character that makes the display disagree with the bytes. The sharp case is
  CVE-2021-42574 — a bidirectional override reorders the glyphs in a signing prompt, so the operator
  reads one sentence and signs another, and both the reader and the verifier are behaving correctly.

  The second half of the file is the half that matters more over time: the characters that are
  deliberately PERMITTED. A screen with false positives is a defect rather than extra safety, and
  U+200C and U+200D are load-bearing in Persian, in several Indic scripts and in every multi-person
  emoji sequence. Those tests exist so that a later tightening of the ranges has to argue with a red
  suite rather than with a comment.

  # Every codepoint here is built by number, and that is not a style choice

  `cp()` below exists because this file's whole subject is characters that are invisible or that
  reorder their neighbours. Written literally, they would make this file's own source display
  differently from what it says — the attack, committed into the test for it, where the next reader
  cannot see it either. This was not hypothetical: the first draft of this file was written with
  literal characters, and a scan of it found twenty of them sitting in the source. A number cannot
  do that, greps as itself, and cannot be pasted wrongly without changing.

  Mutations predicted: widen the invisible band to 0x200b..0x200f → "a zero-width joiner is
  permitted" and "a zero-width non-joiner is permitted" red; drop the bidi bands → "a right-to-left
  override in purpose is refused" red; drop the C1 band → "a C1 control in model is refused" red;
  drop 0x2028..0x2029 → "a Unicode line separator is refused" red; move the screen after the
  signature checks in validateDeclaration → "the screen runs before the signature is looked at" red;
  index by UTF-16 code unit instead of by codepoint → "the position counts characters, not code
  units" red; remove the screen call from validateSeeking or validateOffer → the door tests red.
*/
import { describe, expect, it } from 'vitest';
import { screenAgentText } from '@/lib/agent-screen';
import { validateDeclaration } from '@/lib/agents';
import { validateOffer, validateSeeking } from '@/lib/agent-seeking';

/** One character, by number, so nothing invisible is ever written into this file. */
const cp = (point: number): string => String.fromCodePoint(point);

/** The override at the centre of CVE-2021-42574. */
const RLO = cp(0x202e);
/** The two the screen must never refuse, named so the permitted tests read as prose. */
const ZWNJ = cp(0x200c);
const ZWJ = cp(0x200d);

const AGENT = `0x${'a1'.repeat(32)}`;
const OPERATOR = `0x${'b2'.repeat(32)}`;

/** A declaration that is correct in every respect, so a test can spoil exactly one field. */
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

  /*
    Each refused class, one representative each, named by the codepoint a Unicode table is indexed
    by. The assertion is on the returned sentence rather than merely on non-null, because the whole
    argument for returning a sentence is that the caller cannot SEE the character — a refusal that
    did not name it would send an honest caller to the wrong field.
  */
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

  /*
    The position is counted in characters a person would count, not in UTF-16 code units.

    An emoji is two code units and one character. With naive indexing the override below is reported
    at 3 rather than at 2, and a caller who counts along their own string to find it lands one place
    past it — on a string whose offending character is invisible, that is the difference between
    finding it and concluding the error is wrong.
  */
  it('the position counts characters, not code units', () => {
    expect(screenAgentText('purpose', `${cp(0x1f642)}${RLO}x`)).toContain('at character 2');
  });

  it('reports the FIRST refused character when a field carries several', () => {
    expect(screenAgentText('purpose', `a${cp(0x200b)}b${RLO}c`)).toContain('U+200B');
  });
});

describe('what is deliberately permitted', () => {
  /*
    These are the judgement in the whole file, and they are the reason the invisible band is written
    as two ranges around 0x200c..0x200d rather than as one range across them.
  */
  it('a zero-width non-joiner is permitted — Persian needs it to spell', () => {
    expect(screenAgentText('purpose', `mi${ZWNJ}khahad`)).toBeNull();
  });

  it('a zero-width joiner is permitted — emoji sequences and Indic conjuncts need it', () => {
    const family = `${cp(0x1f468)}${ZWJ}${cp(0x1f469)}${ZWJ}${cp(0x1f467)}`;
    expect(screenAgentText('purpose', `a family: ${family}`)).toBeNull();
  });

  /*
    Right-to-left script itself, spelled by codepoint: Arabic "ana wakil" and Hebrew "ani sokhen".
    The bidirectional algorithm orders these from the characters themselves, so they need none of
    the explicit controls this screen refuses — which is why refusing those controls costs no
    language anything it needs to say.
  */
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

  /*
    The attack, made concrete rather than described.

    The operator is shown `purpose: {purpose}` in a wallet dialog and signs the bytes underneath it.
    With an override in the field, the glyphs after it render in reverse, so the sentence the
    operator reads is not the sentence stored against their signature. The register then publishes
    the reordered line to everybody else.
  */
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

  /*
    The door-disagreement this item was written to close.

    `validateSeeking` has refused the whole C0 range since it was written. This function refused only
    CR and LF, so a tab or an ESC could be filed through the door that writes the PERMANENT row and
    not through the one that writes a listing that expires in a week. The weaker check was on the
    stronger door.
  */
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

  /*
    The case the newline refusal was written for, kept because its argument is the sharpest one in
    the file: `model: "a\npurpose: b"` with an empty purpose signs the same BYTES as `model: "a"`
    with `purpose: "b"`. Both verify. Without this the pair filed against two good signatures can be
    a different pair from the one that was signed.
  */
  it('the statement-splitting newline is still refused', () => {
    const result = validateDeclaration(declaration({ model: `a${cp(0x0a)}purpose: b` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+000A');
  });

  /*
    Ordering, and it is not cosmetic: a caller learns the shape of what is wrong without spending a
    signature to find out. With the screen moved below the signature checks, the declaration here
    would be refused for the missing signature, and the caller would fix that, sign, and be refused
    again for the character they still cannot see.
  */
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

  /*
    `words` is the field a stranger reads while deciding whether to answer for a machine they have
    never met. It is the longest free-text field on the platform at 600 characters and it is an
    advertisement aimed at a human, which makes it the most valuable place on the platform to put a
    sentence that displays differently from the one that was signed.
  */
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

  /*
    The offer carries the model and purpose the OPERATOR signed. It is the half that becomes the
    stored row when the agent answers it, so an override here reaches the register by the same route
    as one at the declaration door — through a different function that had the same gap.
  */
  it('a right-to-left override in the offer purpose is refused', () => {
    const result = validateOffer(offer({ purpose: `read only${RLO} etirw` }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.why).toContain('U+202E');
  });
});
