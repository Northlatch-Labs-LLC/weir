// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..', 'app');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function label(path: string): string {
  return path.slice(path.lastIndexOf('/app/') + 1);
}

function entitlementArguments(source: string): string[] {
  return [...source.matchAll(/readEntitlements\(\s*([^)]*?)\s*\)/g)].map((match) =>
    (match[1] ?? '').replace(/\s*\?\?\s*null\s*$/, '').trim(),
  );
}

function assignedFromSession(source: string, name: string): boolean {
  return new RegExp(`(?:const|let)\\s+${name}\\b[^;]*=\\s*await\\s+provenReader\\w*\\(`).test(
    source,
  );
}

function isProven(source: string, name: string): boolean {
  if (assignedFromSession(source, name)) return true;

  const foldedFrom = new RegExp(`(?:const|let)\\s+${name}\\b[^;]*=\\s*fold\\(\\s*(\\w+)`).exec(
    source,
  )?.[1];
  if (foldedFrom !== undefined && assignedFromSession(source, foldedFrom)) return true;

  return new RegExp(`verifyAction\\(\\s*\\{[^}]*address:\\s*${name}\\b`, 's').test(source);
}

const files = sources(APP).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

const callSites = files.flatMap(({ path, source }) =>
  entitlementArguments(source).map((argument) => ({ path, source, argument })),
);

describe('entitlements are resolved only for a proven reader', () => {
  it('finds the call sites it is meant to be guarding', () => {
    expect(callSites.length).toBeGreaterThan(0);
  });

  it.each(callSites.map((site) => [label(site.path), site] as const))(
    '%s resolves entitlements only for an address it proved',
    (_name, site) => {
      const { source, argument } = site;

      if (argument === 'null') return;

      expect(
        isProven(source, argument),
        `readEntitlements(${argument}) — "${argument}" is not proved in this file. It must come ` +
          `from provenReader…() (the signed read-session cookie), or be an address that ` +
          `verifyAction proved. An address taken from the URL is a claim, not an identity.`,
      ).toBe(true);
    },
  );
});

describe('the reader query parameter is never an authority', () => {
  it.each(
    files
      .filter(({ source }) => source.includes('readEntitlements('))
      .map(({ path, source }) => [label(path), source] as const),
  )('%s does not pass a URL-supplied reader into the entitlement read', (_name, source) => {
    const namesFromUrl = [
      ...source.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*[^;]*searchParams(?:\.get\(['"]reader['"]\)|\W[^;]*\breader\b)/g,
      ),
    ].map((match) => match[1] as string);

    for (const name of namesFromUrl) {
      expect(
        entitlementArguments(source),
        `"${name}" is read from the URL and passed to readEntitlements`,
      ).not.toContain(name);
    }
  });
});
