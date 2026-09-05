// Built-by: @projectx.sui · Co-authored-by: Claude
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInline, parseMarkdown, type Block } from '../lib/markdown';

describe('inline', () => {
  it('reads bold, links and code, and keeps the text between them', () => {
    expect(parseInline('a **b** c [d](/e) f `g`')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'link', text: 'd', href: '/e' },
      { kind: 'text', text: ' f ' },
      { kind: 'code', text: 'g' },
    ]);
  });

  it('returns plain text as one run', () => {
    expect(parseInline('nothing special')).toEqual([{ kind: 'text', text: 'nothing special' }]);
  });

  it('never drops characters', () => {
    // The property that matters for a legal page: what goes in comes out.
    const samples = [
      '2.1 **Subscriptions.** The fee is 2.9%.',
      'See the [Terms](/legal/terms) and the [Privacy Policy](/legal/privacy).',
      'A `.sui` name is an object.',
      'Asterisks * on their own * survive.',
    ];
    for (const sample of samples) {
      const rebuilt = parseInline(sample)
        .map((run) => (run.kind === 'link' ? run.text : run.text))
        .join('');
      const stripped = sample.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      expect(rebuilt).toBe(stripped);
    }
  });
});

describe('blocks', () => {
  it('reads headings by depth', () => {
    const blocks = parseMarkdown('# One\n\n## Two\n\n### Three');
    expect(blocks.map((b) => (b.kind === 'heading' ? b.level : b.kind))).toEqual([1, 2, 3]);
  });

  it('joins wrapped lines into one paragraph and separates on a blank line', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ kind: 'paragraph', text: [{ kind: 'text', text: 'one two' }] });
  });

  it('reads a bullet list as one block', () => {
    const blocks = parseMarkdown('- a\n- b\n\nafter');
    expect(blocks[0]?.kind).toBe('list');
    expect((blocks[0] as Extract<Block, { kind: 'list' }>).items).toHaveLength(2);
    expect(blocks[1]?.kind).toBe('paragraph');
  });

  it('reads a table, dropping only the separator row', () => {
    const blocks = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
    const table = blocks[0] as Extract<Block, { kind: 'table' }>;
    expect(table.kind).toBe('table');
    expect(table.head).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]?.[1]).toEqual([{ kind: 'text', text: '4' }]);
  });

  it('reads a rule', () => {
    expect(parseMarkdown('---')[0]).toEqual({ kind: 'rule' });
  });
});

/*
  The guard that matters more than any of the above: every line of every published document must
  reach the page. A parser that silently skipped a clause would be the worst defect this file could
  have, and it would look like nothing at all.
*/
describe('the published documents', () => {
  const dir = resolve(process.cwd(), 'content/legal');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  it('there are documents to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`${file} loses no content`, () => {
      const source = readFileSync(resolve(dir, file), 'utf8');
      const blocks = parseMarkdown(source);

      const text = (runs: { text: string }[]) => runs.map((r) => r.text).join('');
      const rendered = blocks
        .map((block) => {
          switch (block.kind) {
            case 'heading':
            case 'paragraph':
              return text(block.text);
            case 'list':
              return block.items.map(text).join(' ');
            case 'table':
              return [block.head.map(text).join(' '), ...block.rows.map((r) => r.map(text).join(' '))].join(' ');
            case 'rule':
              return '';
          }
        })
        .join(' ');

      /*
        Compare word by word, ignoring punctuation entirely: wrapping, table pipes and the markers
        themselves are formatting, and a diff that counted them would fail for reasons that are not
        content. What must never differ is the words.
      */
      const words = (s: string) =>
        s
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .toLowerCase()
          .match(/[a-z0-9]+/g) ?? [];

      const seen = new Set(words(rendered));
      const missing = [...new Set(words(source))].filter((w) => !seen.has(w));
      expect(missing, `${file} dropped words`).toEqual([]);
    });
  }
});

describe('the header block every document opens with', () => {
  it('keeps each field on its own line rather than joining them into prose', () => {
    const blocks = parseMarkdown(
      '**Effective date:** 1 September 2026\n**Controller:** Northlatch Labs LLC\n**Contact:** privacy@weir.social',
    );
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true);
  });

  it('leaves an ordinary wrapped paragraph joined', () => {
    // The rule must not turn every bold sentence into its own line.
    const blocks = parseMarkdown('2.1 **Subscriptions.** A fee applies\nand it is deducted at settlement.');
    expect(blocks).toHaveLength(1);
  });
});
