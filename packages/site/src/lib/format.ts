// Numerals always carry their unit. SUI amounts are machine-verifiable,
// rendered in JetBrains Mono — never decorated, never counted up.

export function fmtSui(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  // trim trailing zeros but keep enough precision to be exact
  const s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

export function fmtUsd(sui: number, pricePerSui = 3.14): string {
  const usd = sui * pricePerSui;
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`;
}

export function shortAddress(addr: string): string {
  if (!addr) return '';
  if (addr.includes('…')) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Coin amounts are stored as WHOLE NUMBER STRINGS in the smallest unit (mist,
// 1e-9 SUI). These helpers convert at the boundary; a price never exists as a
// float in the data.
export const MIST_PER_SUI = 1_000_000_000;

export function suiToMist(sui: number): string {
  return String(Math.round(sui * MIST_PER_SUI));
}

// A pure conversion of a valid whole-number mist string. Callers must treat a
// null/absent amount as "not measured" before reaching here.
export function mistToSui(mist: string): number {
  return Number(mist) / MIST_PER_SUI;
}

export function fmtMist(mist: string | null | undefined): string {
  if (mist == null) return '0';
  return fmtSui(mistToSui(mist));
}

// A deterministic digest from the parts of a payment. Same inputs always give
// the same digest, so a receipt always describes the payment that produced it.
export function makeDigest(parts: string[]): string {
  let hash = 0x811c9dc5;
  const input = parts.join('::');
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let state = hash >>> 0;
  let out = '';
  for (let i = 0; i < 16; i++) {
    state = Math.imul(state ^ (state >>> 16), 0x21f0aaad) >>> 0;
    state = Math.imul(state ^ (state >>> 15), 0x735a2d97) >>> 0;
    state ^= state >>> 15;
    out += (state >>> 0).toString(16).padStart(8, '0');
  }
  return `0x${out.slice(0, 64)}`;
}