// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export interface ParsedUnit {
  readonly sections: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

export function parseUnit(text: string): ParsedUnit {
  const sections = new Map<string, Map<string, string[]>>();
  let current = '';

  const logical: string[] = [];
  let pending = '';
  let continued = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1)} `;
      continued = true;
      continue;
    }
    logical.push(continued ? (pending + line).replace(/[ \t]+/g, ' ').trim() : pending + line);
    pending = '';
    continued = false;
  }
  if (pending !== '') logical.push(pending.replace(/[ \t]+/g, ' ').trim());

  for (const line of logical) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      current = trimmed.slice(1, -1);
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }

    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = trimmed.slice(equals + 1).trim();

    let section = sections.get(current);
    if (section === undefined) {
      section = new Map();
      sections.set(current, section);
    }
    const existing = section.get(key);
    if (existing === undefined) section.set(key, [value]);
    else existing.push(value);
  }

  return { sections };
}

export function directive(unit: ParsedUnit, section: string, key: string): readonly string[] {
  return unit.sections.get(section)?.get(key) ?? [];
}

export function onlyValue(unit: ParsedUnit, section: string, key: string): string | null {
  const values = directive(unit, section, key);
  return values.length === 1 ? values[0]! : null;
}
