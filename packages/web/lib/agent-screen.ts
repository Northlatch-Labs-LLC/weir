// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

interface Band {
  readonly from: number;
  readonly to: number;
  readonly why: string;
}

const REFUSED: readonly Band[] = [
  { from: 0x00, to: 0x08, why: 'a control character' },
  { from: 0x09, to: 0x09, why: 'a tab' },
  { from: 0x0a, to: 0x0a, why: 'a line break' },
  { from: 0x0b, to: 0x0c, why: 'a control character' },
  { from: 0x0d, to: 0x0d, why: 'a line break' },
  { from: 0x0e, to: 0x1f, why: 'a control character' },
  { from: 0x7f, to: 0x7f, why: 'a control character' },

  { from: 0x80, to: 0x9f, why: 'a control character' },

  { from: 0xad, to: 0xad, why: 'a soft hyphen, which is invisible until the line wraps' },
  { from: 0x180e, to: 0x180e, why: 'an invisible character' },
  { from: 0x200b, to: 0x200b, why: 'a zero-width space' },
  { from: 0x2060, to: 0x2064, why: 'an invisible character' },
  { from: 0xfeff, to: 0xfeff, why: 'a byte-order mark' },

  { from: 0x2028, to: 0x2029, why: 'a line separator' },

  { from: 0x61c, to: 0x61c, why: 'a character that changes the direction text is displayed in' },
  { from: 0x200e, to: 0x200f, why: 'a character that changes the direction text is displayed in' },
  { from: 0x202a, to: 0x202e, why: 'a character that changes the order text is displayed in' },
  { from: 0x2066, to: 0x2069, why: 'a character that changes the order text is displayed in' },
];

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

export function screenAgentText(field: string, value: string): string | null {
  const found = firstRefused(value);
  if (found === null) return null;
  const point = found.codepoint.toString(16).toUpperCase().padStart(4, '0');
  return `${field} contains ${found.why} (U+${point}) at character ${found.at + 1} — it must be plain, visible text on one line`;
}
