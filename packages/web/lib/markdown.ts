// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * A parser for the markdown these legal documents actually use, and nothing else.
 *
 * # Why not a library, and why not HTML
 *
 * The documents are ours, they change rarely, and they use six constructs. A markdown dependency
 * would be a supply-chain addition for that; a hand-rolled one that emitted HTML strings would need
 * `dangerouslySetInnerHTML` and would put an injection hole in the one part of the site whose whole
 * job is to be trustworthy.
 *
 * So this parses to plain data. The renderer turns that data into React elements, which escape
 * their own text — there is no path from a document's bytes to markup.
 *
 * Anything it does not recognise is rendered as the paragraph it is, rather than silently dropped.
 * A legal page that quietly omits a clause because the parser did not know a syntax is the worst
 * failure available here, so there is no branch anywhere below that discards a line.
 */

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

/**
 * Bold, links and code, in one pass.
 *
 * Ordered alternation, longest-first: `**` must be tried before a single `*` would matter, and a
 * link's text may contain neither, which is true of every link in these documents.
 */
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
  // A line that matched nothing is still a line.
  return out.length === 0 ? [{ kind: 'text', text: source }] : out;
}

function cells(row: string): string[] {
  // `| a | b |` — the split leaves an empty string at each end, which is not a column.
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
      // The `|---|---|` separator carries no content; its absence is not an error.
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
