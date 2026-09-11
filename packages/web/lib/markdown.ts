// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: Inline[] }
  | { kind: 'paragraph'; text: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };

const INLINE = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(`[^`]+`)/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const match of source.matchAll(INLINE)) {
    const index = match.index;
    if (index > at) out.push({ kind: 'text', text: source.slice(at, index) });
    const token = match[0];
    if (token.startsWith('**')) {
      out.push({ kind: 'strong', text: token.slice(2, -2) });
    } else if (token.startsWith('`')) {
      out.push({ kind: 'code', text: token.slice(1, -1) });
    } else {
      const split = token.indexOf('](');
      out.push({
        kind: 'link',
        text: token.slice(1, split),
        href: token.slice(split + 2, -1),
      });
    }
    at = index + token.length;
  }
  if (at < source.length) out.push({ kind: 'text', text: source.slice(at) });
  return out.length === 0 ? [{ kind: 'text', text: source }] : out;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: parseInline(paragraph.join(' ').trim()) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      flush();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      flush();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: parseInline(heading[2]!),
      });
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }

    if (trimmed.startsWith('- ')) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('- ')) {
        items.push(parseInline((lines[i] ?? '').trim().slice(2)));
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'list', items });
      continue;
    }

    if (trimmed.startsWith('|')) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push((lines[i] ?? '').trim());
        i += 1;
      }
      i -= 1;
      const head = cells(rows[0] ?? '');
      const body = rows.slice(/^\|[\s:|-]+\|$/.test(rows[1] ?? '') ? 2 : 1);
      blocks.push({
        kind: 'table',
        head: head.map(parseInline),
        rows: body.map((row) => cells(row).map(parseInline)),
      });
      continue;
    }

    if (/^\*\*[^*]+:\*\*/.test(trimmed)) {
      flush();
      blocks.push({ kind: 'paragraph', text: parseInline(trimmed) });
      continue;
    }

    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}
