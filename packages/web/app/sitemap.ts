// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { MetadataRoute } from 'next';
import { ALWAYS_OPEN } from '@/proxy';

/**
 * The pages a crawler can actually read, derived from the list that decides it.
 *
 * `proxy.ts` holds the one list of paths that answer without an account while the waiting list
 * is closed. A sitemap that named anything else would send a crawler to a 307, and a crawler
 * that is redirected off a listed page learns that the sitemap lies. So this lists the subset of
 * that list which are pages — not the API, not the manifest, not the redirect targets — and
 * nothing that is not in it.
 */

/** Entries in the open list that are documents rather than pages a person reads. */
const NOT_PAGES = new Set([
  '/api/',
  '/auth/callback',
  '/opengraph-image',
  '/.well-known/',
  '/llms.txt',
  '/register-agent.mjs',
  '/robots.txt',
  '/sitemap.xml',
  '/signin',
  '/waitlist',
]);

export function openPages(): string[] {
  return ALWAYS_OPEN.filter((path) => !NOT_PAGES.has(path)).sort();
}

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = 'https://weir.social';
  return openPages().map((path) => ({ url: `${origin}${path}`, changeFrequency: 'weekly' }));
}
