// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The way in.
 *
 * The ten artboards have existed as files on disk since the rebuild started, at
 * `docs/app-production/artboards/`. Being files, they had to be found and opened, and nobody was
 * told where. This gives them an address on the running server, alongside every screen of the real
 * application, so there is one page to open and everything is one click from it.
 *
 * Development only. The route is `notFound()` in any other environment, which is a 404 rather than
 * a redirect: a redirect would confirm the address exists.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound } from 'next/navigation';
import NextLink from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Design lab · Weir' };

/** The application's own screens, in the order the rail lists them. */
const SCREENS: readonly { href: string; label: string; note: string }[] = [
  { href: '/', label: 'Home', note: 'the feed, which is also the front door' },
  { href: '/feed', label: 'Feed', note: 'the same screen at its own address' },
  { href: '/explore', label: 'Explore', note: 'what is being read' },
  { href: '/creators', label: 'Creators', note: 'people and agents publishing' },
  { href: '/agents', label: 'Agents', note: 'the machine side of the register' },
  { href: '/alerts', label: 'Alerts', note: 'what happened while you were away' },
  { href: '/messages', label: 'Messages', note: 'direct conversations' },
  { href: '/vault', label: 'Vault', note: 'your money, and whose it is behind' },
  { href: '/studio', label: 'Studio', note: 'publishing, pricing and sealing a post' },
  { href: '/signin', label: 'Sign in', note: 'the door — Google or a wallet' },
  { href: '/join', label: 'Join', note: 'claiming a handle on chain' },
  { href: '/security', label: 'Security', note: 'what the contracts actually enforce' },
];

export default async function Lab() {
  if (process.env.NODE_ENV !== 'development') notFound();

  const dir = join(process.cwd(), '..', '..', 'docs', 'app-production', 'artboards');
  let artboards: string[] = [];
  try {
    artboards = (await readdir(dir)).filter((f) => f.endsWith('.dc.html')).sort();
  } catch {
    artboards = [];
  }

  return (
    <main style={S.page}>
      <h1 style={S.h1}>Design lab</h1>
      <p style={S.lede}>
        Two ways to change something and have it reach me as a fact rather than as a description.
        This page only exists while the dev server is running.
      </p>

      <section style={S.card}>
        <h2 style={S.h2}>1 · The running application</h2>
        <p style={S.p}>
          Open any screen below. A <b>Design lab</b> button sits in the bottom-right corner of every
          one of them. It can recolour the whole design, resize and re-space any single element,
          move a block up or down, take a block out, and let you rewrite any words on the page by
          clicking into them. Press <b>Save what I changed</b> and it is written into the repository.
        </p>
        <ul style={S.grid}>
          {SCREENS.map((s) => (
            <li key={s.href} style={S.item}>
              <NextLink href={s.href} style={S.link}>
                {s.label}
              </NextLink>
              <span style={S.note}>{s.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={S.card}>
        <h2 style={S.h2}>2 · The artboards</h2>
        <p style={S.p}>
          The ten drawings the rebuild is being built from. They are plain HTML files in{' '}
          <code style={S.code}>docs/app-production/artboards/</code> — this serves them so they can
          be opened rather than found. They open with the same editing bar: click into anything, type,
          and save.
        </p>
        {artboards.length === 0 ? (
          <p style={S.p}>None found on disk.</p>
        ) : (
          <ul style={S.grid}>
            {artboards.map((file) => (
              <li key={file} style={S.item}>
                <NextLink href={`/lab/art/${file.replace('.dc.html', '')}`} style={S.link}>
                  {file.replace('.dc.html', '')}
                </NextLink>
                <span style={S.note}>{file}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={S.card}>
        <h2 style={S.h2}>Where a save lands</h2>
        <p style={S.p}>
          <code style={S.code}>docs/app-production/lab/&lt;date-time&gt;/</code> — a readable report,
          the exact numbers as JSON, and the page as it looked when you pressed save. Tell me it is
          there and I will read it.
        </p>
      </section>
    </main>
  );
}

/*
  This page's own appearance is hard-coded, like the panel's and for the same reason: it is a tool
  for working on the design and must not move when the design moves.
*/
const S = {
  page: { maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px', font: '400 15px/1.6 ui-sans-serif, system-ui, sans-serif', color: '#e8ecf6' },
  h1: { margin: '0 0 6px', fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' },
  lede: { margin: '0 0 28px', color: '#9aa4bd', fontSize: 15 },
  card: { border: '1px solid #2a2f3d', borderRadius: 12, padding: '20px 22px', marginBottom: 18, background: '#0e1017' },
  h2: { margin: '0 0 8px', fontSize: 16, fontWeight: 700 },
  p: { margin: '0 0 14px', color: '#c3cbdb', fontSize: 14 },
  grid: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 },
  item: { border: '1px solid #2a2f3d', borderRadius: 9, padding: '10px 12px', background: '#151824' },
  link: { display: 'block', color: '#7ee2b0', fontWeight: 600, fontSize: 14, textDecoration: 'none' },
  note: { display: 'block', color: '#7c869c', fontSize: 11.5, marginTop: 2 },
  code: { fontFamily: 'ui-monospace, monospace', fontSize: 12.5, color: '#e8ecf6' },
} as const;
