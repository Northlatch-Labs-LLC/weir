// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

/**
 * What an agent brings to the door, screened for the vulnerability classes that live in text.
 *
 * # Why this file exists at all
 *
 * An agent onboarding here submits four things: two addresses, two signatures, and two lines of
 * free text — `model` and `purpose`. The addresses are normalised, the signatures are verified
 * against two public keys, and until this file there was nothing whatever between the free text and
 * two places it must never have been trusted in:
 *
 *  1. **A wallet dialog a human reads and then signs.** `statementFor` interpolates both fields
 *     verbatim into the bytes each party signs — `model: {model}` on one line, `purpose: {purpose}`
 *     on the next. The operator's signature is the half that carries the accountability, and they
 *     give it after reading that dialog. Whatever the dialog *displays* is the whole of what they
 *     are consenting to.
 *  2. **The public register.** The same strings are published as the record of who declared what.
 *
 * # The attack this closes, by name
 *
 * Unicode carries characters that change how a string is *displayed* without changing the bytes.
 * The bidirectional overrides — U+202A..U+202E and the isolates U+2066..U+2069 — reorder the
 * glyphs around them. A `purpose` carrying one renders in the wallet as one sentence and is signed
 * as different bytes, and both the reader and the verifier are behaving correctly: the reader
 * believes the dialog, the verifier believes the bytes, and the two were never the same sentence.
 * That is CVE-2021-42574, published as Trojan Source against compilers in 2021, and a signing
 * prompt is the same shape of target as a source file — text a human reviews and a machine acts
 * on. The register then publishes the reordered line to everyone else.
 *
 * The invisible characters are the second half. A zero-width space inside a model name produces a
 * row that displays identically to another row and is a different string to every comparison —
 * which is impersonation on a register whose entire product is telling one declared agent from
 * another.
 *
 * # Refused, never repaired
 *
 * Nothing here strips, normalises or substitutes. `validateSeeking` already gives the reason in its
 * own words — "refused rather than trimmed … a trimmed value would be stored under a signature over
 * other bytes" — and it is sharper here than it looks. The signature was made over the text as
 * submitted. Cleaning the text server-side would file a repaired string against a signature that
 * proves a different one, so the register's central claim — that a reader can rebuild the statement
 * from the stored row and check it against two public keys — would quietly become false. A refusal
 * costs the caller one round trip. A repair costs the register the only thing it sells.
 *
 * For the same reason the screen runs BEFORE any signature is verified: a caller learns the shape
 * of what is wrong without spending a signature to find out.
 *
 * # What is deliberately NOT refused, and why that is not laziness
 *
 * A screen with false positives is a defect, not extra safety, so this refuses only characters that
 * are invisible *and* unnecessary in prose:
 *
 *  - **U+200C ZERO WIDTH NON-JOINER and U+200D ZERO WIDTH JOINER are permitted.** ZWNJ is required
 *    to spell Persian correctly and is load-bearing in several Indic scripts; ZWJ is required for
 *    both Indic conjuncts and every multi-person emoji sequence. Refusing them would not harden the
 *    register, it would tell a Persian-speaking operator their purpose is malformed.
 *  - **Right-to-left script itself is untouched.** Arabic and Hebrew are ordered correctly by the
 *    Unicode bidirectional algorithm from the characters themselves; they do not need the explicit
 *    overrides this file refuses. Only the explicit controls go, which is why refusing them does
 *    not cost a single language anything it needs to say.
 *
 * That line — invisible and unnecessary — is the whole of the judgement in this file. Everything
 * else is a fixed list of codepoints, so two callers submitting the same string always get the same
 * answer, and there is no heuristic anywhere to tune, age or argue with.
 */

/**
 * One refused range, with the sentence a caller is given when they land in it.
 *
 * The reason travels with the range rather than being written once at the call site, because a
 * caller told only "invalid characters" has to guess which of six classes they tripped, and the
 * guess a caller makes about invisible characters is usually that the field is fine.
 */
interface Band {
  readonly from: number;
  readonly to: number;
  readonly why: string;
}

/**
 * Every codepoint refused, and nothing else.
 *
 * Ordered from the oldest class to the newest so a reader meets them in the order they became
 * problems rather than in numeric order.
 */
const REFUSED: readonly Band[] = [
  /*
    C0 controls and DEL.

    `agent-seeking.ts` has refused these at the seeking door since it was written; the declaration
    door refused only carriage return and line feed, which is how the two entrances to one register
    came to disagree about what a field may contain. A tab or a NUL cannot be typed into a wallet
    prompt by a person and has no meaning in a one-line field, and ESC in particular is the first
    byte of an ANSI escape sequence — a register read in a terminal, which is exactly how an agent
    client reads it, will act on those rather than print them.
  */
  { from: 0x00, to: 0x08, why: 'a control character' },
  { from: 0x09, to: 0x09, why: 'a tab' },
  { from: 0x0a, to: 0x0a, why: 'a line break' },
  { from: 0x0b, to: 0x0c, why: 'a control character' },
  { from: 0x0d, to: 0x0d, why: 'a line break' },
  { from: 0x0e, to: 0x1f, why: 'a control character' },
  { from: 0x7f, to: 0x7f, why: 'a control character' },

  /*
    C1 controls.

    The half of the control range that gets forgotten, because it is invisible in a UTF-8 file
    rather than obviously broken. U+0085 NEXT LINE is a line terminator to a good many parsers,
    which puts it in the same class as the line breaks the statement format cannot survive.
  */
  { from: 0x80, to: 0x9f, why: 'a control character' },

  /*
    Invisible characters with no meaning in prose.

    Each one is a way to write two strings that display identically. SOFT HYPHEN renders as nothing
    until a line wraps; ZERO WIDTH SPACE and WORD JOINER render as nothing ever; the invisible
    mathematical operators U+2061..U+2064 are meaningful only inside mathematical markup; and
    U+FEFF is a byte-order mark that has no business in the middle of a field.

    U+200C and U+200D are conspicuously absent from this range and their absence is deliberate —
    see the header. The range is split around them rather than written as one band so that nobody
    later "tidies" 0x200b..0x200f into a single line and silently takes Persian with it.
  */
  { from: 0xad, to: 0xad, why: 'a soft hyphen, which is invisible until the line wraps' },
  { from: 0x180e, to: 0x180e, why: 'an invisible character' },
  { from: 0x200b, to: 0x200b, why: 'a zero-width space' },
  { from: 0x2060, to: 0x2064, why: 'an invisible character' },
  { from: 0xfeff, to: 0xfeff, why: 'a byte-order mark' },

  /*
    The two Unicode line separators.

    U+2028 and U+2029 are line terminators to JavaScript itself and to a good many renderers, so
    they split the statement exactly as CR and LF do — the attack the line-break refusal above was
    written against — while being neither ASCII nor a control character, which is how they get past
    a `[\r\n]` test and a C0 range test both. `String.prototype.trim` removes them at the ends of a
    field and leaves them in the middle, so trimming is not a defence either.
  */
  { from: 0x2028, to: 0x2029, why: 'a line separator' },

  /*
    The bidirectional controls — the Trojan Source class, and the reason this file was written.

    U+202A..U+202E are the embeddings and the two overrides; U+2066..U+2069 are the isolates that
    replaced them; U+061C is the Arabic letter mark and U+200E/U+200F the two directional marks.
    All of them change the order glyphs appear in without changing a byte of what is signed.

    The marks (U+061C, U+200E, U+200F) are weaker than the overrides — they nudge the algorithm
    rather than seize it — and they are refused anyway. In a single line of prose displayed inside a
    signing prompt there is no sentence a person needs them to write, and the register cannot tell
    a nudge that clarifies from a nudge that misleads without rendering the string itself.
  */
  { from: 0x61c, to: 0x61c, why: 'a character that changes the direction text is displayed in' },
  { from: 0x200e, to: 0x200f, why: 'a character that changes the direction text is displayed in' },
  { from: 0x202a, to: 0x202e, why: 'a character that changes the order text is displayed in' },
  { from: 0x2066, to: 0x2069, why: 'a character that changes the order text is displayed in' },
];

/**
 * The first refused codepoint in `value`, or `null` when there is nothing to refuse.
 *
 * Iterated with `for…of`, which walks codepoints rather than UTF-16 code units, so a string
 * containing an astral character is measured as the characters a reader sees. None of the refused
 * bands is astral, so this changes no verdict — it makes the reported position the one a person
 * counting characters would arrive at, which is the position they need in order to find it.
 */
function firstRefused(value: string): { at: number; codepoint: number; why: string } | null {
  let at = 0;
  for (const character of value) {
    const codepoint = character.codePointAt(0) ?? 0;
    for (const band of REFUSED) {
      if (codepoint >= band.from && codepoint <= band.to) {
        return { at, codepoint, why: band.why };
      }
    }
    at += 1;
  }
  return null;
}

/**
 * Screen one field an agent submitted.
 *
 * Returns `null` when the field is clean, or the sentence to hand back when it is not.
 *
 * The sentence names the field, the position, the codepoint in the `U+XXXX` form every Unicode
 * table is indexed by, and what the character does. That is more than a refusal usually says, and
 * the reason is that this is the one class of refusal where the caller cannot see the problem: the
 * offending character is invisible in their editor, their terminal and their logs, so "purpose
 * contains an invalid character" would send an honest caller looking at the wrong field. A caller
 * given the offset and the codepoint can find it in one search.
 *
 * @param field the name the caller knows the field by, used verbatim in the sentence
 * @param value the submitted text, exactly as it arrived and as it was signed
 */
export function screenAgentText(field: string, value: string): string | null {
  const found = firstRefused(value);
  if (found === null) return null;
  const point = found.codepoint.toString(16).toUpperCase().padStart(4, '0');
  return `${field} contains ${found.why} (U+${point}) at character ${found.at + 1} — it must be plain, visible text on one line`;
}
