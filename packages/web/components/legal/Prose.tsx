// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import Link from 'next/link';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';

function Runs({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((run, i) => {
        switch (run.kind) {
          case 'strong':
            return <strong key={i}>{run.text}</strong>;
          case 'code':
            return (
              <code key={i} className="mono">
                {run.text}
              </code>
            );
          case 'link':
            return run.href.startsWith('/') ? (
              <Link key={i} href={run.href}>
                {run.text}
              </Link>
            ) : (
              <a key={i} href={run.href} target="_blank" rel="noreferrer noopener">
                {run.text}
              </a>
            );
          case 'text':
            return <span key={i}>{run.text}</span>;
        }
      })}
    </>
  );
}

function One({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 1 ? null : block.level === 2 ? (
        <h2 id={slug(block.text)}>
          <Runs runs={block.text} />
        </h2>
      ) : (
        <h3>
          <Runs runs={block.text} />
        </h3>
      );
    case 'paragraph':
      return (
        <p>
          <Runs runs={block.text} />
        </p>
      );
    case 'list':
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>
              <Runs runs={item} />
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="legal-tablewrap">
          <table className="legal-table weir-stack">
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} scope="col">
                    <Runs runs={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} data-label={j === 0 ? undefined : block.head[j]?.map((r) => r.text).join('')}>
                      <Runs runs={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <div className="weir-rule" aria-hidden />;
  }
}

function slug(runs: Inline[]): string {
  return runs
    .map((r) => r.text)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function Prose({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="legal-prose">
      {blocks.map((block, i) => (
        <One key={i} block={block} />
      ))}
    </div>
  );
}
