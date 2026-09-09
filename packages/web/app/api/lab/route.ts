// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Where the design lab writes what you changed.
 *
 * A save lands as a folder under `docs/app-production/lab/`, in the repository, on the machine the
 * dev server is running on. That is the whole point: the change does not have to be described in a
 * message and re-implemented from the description — it is a file, in the tree, that says which page
 * you were on, which values you moved, which words you rewrote and what you asked for in your own
 * sentences.
 *
 * # Refuses outside development
 *
 * Two independent guards, because one is not a guard. `NODE_ENV` is checked here, and the component
 * that calls this renders nothing outside development. This route writes to the filesystem on the
 * strength of an unauthenticated POST, which is safe on a laptop running `next dev` and is not safe
 * anywhere else, so the check is the first statement rather than a condition inside the handler.
 *
 * # Writes inside the repository and nowhere else
 *
 * The folder name is built here from a timestamp, never taken from the request, so there is no path
 * for the body to name a destination.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Payload = {
  page?: unknown;
  viewport?: { width?: unknown; height?: unknown };
  at?: unknown;
  tokens?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  nudges?: { path?: unknown; snippet?: unknown; css?: Record<string, unknown> }[];
  texts?: { path?: unknown; before?: unknown; after?: unknown }[];
  hidden?: unknown[];
  notes?: unknown;
  html?: unknown;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A folder name from the clock, never from the request. */
function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * The report a person reads.
 *
 * Written as sentences rather than as a diff: what is being communicated is an intention, and a
 * table of hex values does not carry one. The JSON beside it carries the exact numbers.
 */
function report(body: Payload): string {
  const lines: string[] = [];
  const page = text(body.page) === '' ? 'unknown page' : text(body.page);
  const width = typeof body.viewport?.width === 'number' ? body.viewport.width : null;

  lines.push(`# Design lab — ${page}`);
  lines.push('');
  lines.push(`Saved ${text(body.at)}${width === null ? '' : ` at ${width}px wide`}.`);
  lines.push('');

  const tokens = Object.entries(body.tokens ?? {});
  if (tokens.length > 0) {
    lines.push('## Values moved');
    lines.push('');
    for (const [name, value] of tokens) {
      const was = text(body.defaults?.[name]);
      lines.push(`- \`${name}\`: ${was === '' ? '?' : was} → **${text(value)}**`);
    }
    lines.push('');
  }

  const nudges = body.nudges ?? [];
  if (nudges.length > 0) {
    lines.push('## Individual things changed');
    lines.push('');
    for (const n of nudges) {
      lines.push(`- \`${text(n.path)}\` — “${text(n.snippet)}”`);
      for (const [css, value] of Object.entries(n.css ?? {})) {
        lines.push(`  - ${css}: **${text(value)}**`);
      }
    }
    lines.push('');
  }

  const texts = body.texts ?? [];
  if (texts.length > 0) {
    lines.push('## Words rewritten');
    lines.push('');
    for (const t of texts) {
      lines.push(`- \`${text(t.path)}\``);
      lines.push(`  - was: ${text(t.before)}`);
      lines.push(`  - now: **${text(t.after)}**`);
    }
    lines.push('');
  }

  const hidden = (body.hidden ?? []).map(text).filter((h) => h !== '');
  if (hidden.length > 0) {
    lines.push('## Taken out');
    lines.push('');
    for (const h of hidden) lines.push(`- ${h}`);
    lines.push('');
  }

  const notes = text(body.notes).trim();
  lines.push('## In his words');
  lines.push('');
  lines.push(notes === '' ? '_Nothing written._' : notes);
  lines.push('');

  return lines.join('\n');
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'The design lab runs in development only.' }, { status: 404 });
  }

  let body: Payload;
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'Unreadable body.' }, { status: 400 });
  }

  const folder = join(process.cwd(), '..', '..', 'docs', 'app-production', 'lab', stamp());
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'what-i-changed.md'), report(body), 'utf8');
    await writeFile(join(folder, 'changes.json'), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    const html = text(body.html);
    if (html !== '') await writeFile(join(folder, 'page.html'), html, 'utf8');
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : 'Could not write the folder.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ folder: `docs/app-production/lab/${folder.split('/').pop()}` });
}
