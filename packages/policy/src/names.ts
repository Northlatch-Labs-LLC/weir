// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{1,64}$/;

export function normaliseAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!ADDRESS_SHAPE.test(trimmed)) return null;
  const digits = trimmed.slice(2).toLowerCase();
  return `0x${digits.padStart(64, '0')}`;
}

export function normaliseType(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const open = trimmed.indexOf('<');
  if (open === -1) return normaliseTypeHead(trimmed);

  if (!trimmed.endsWith('>')) return null;
  const head = normaliseTypeHead(trimmed.slice(0, open));
  if (head === null) return null;

  const params = splitTypeParameters(trimmed.slice(open + 1, -1));
  if (params === null) return null;

  const normalisedParams: string[] = [];
  for (const param of params) {
    const normalised = normaliseType(param);
    if (normalised === null) return null;
    normalisedParams.push(normalised);
  }

  return `${head}<${normalisedParams.join(',')}>`;
}

function normaliseTypeHead(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const parts = trimmed.split('::');
  if (parts.length === 1) {
    return PRIMITIVE_TYPES.has(trimmed) ? trimmed : null;
  }
  if (parts.length !== 3) return null;

  const [address, moduleName, typeName] = parts as [string, string, string];
  const normalisedAddress = normaliseAddress(address);
  if (normalisedAddress === null) return null;
  if (!IDENTIFIER.test(moduleName) || !IDENTIFIER.test(typeName)) return null;

  return `${normalisedAddress}::${moduleName}::${typeName}`;
}

export function normaliseTarget(value: string): string | null {
  if (value.includes('<') || value.includes('>')) return null;
  return normaliseTypeHead(value);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PRIMITIVE_TYPES = new Set([
  'bool',
  'u8',
  'u16',
  'u32',
  'u64',
  'u128',
  'u256',
  'address',
  'signer',
]);

function splitTypeParameters(inner: string): string[] | null {
  const out: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '<') depth += 1;
    else if (ch === '>') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (ch === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }

  if (depth !== 0) return null;
  out.push(inner.slice(start));
  return out.every((s) => s.trim() !== '') ? out : null;
}
