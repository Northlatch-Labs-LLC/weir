// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { MetadataRoute } from 'next';
import { ALWAYS_OPEN } from '@/proxy';

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
  '/unsubscribe',
]);

export function openPages(): string[] {
  return [...new Set(ALWAYS_OPEN.filter((path) => !NOT_PAGES.has(path)))].sort();
}

const AGENT_DOCUMENTS = ['/llms.txt', '/.well-known/weir-agent.json', '/.well-known/mcp.json'];

const HOME_PAGE = '/';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = 'https://weir.social';
  return [
    { url: origin + HOME_PAGE, changeFrequency: 'weekly' as const, priority: 1.0 },
    ...openPages().map((path) => ({ url: `${origin}${path}`, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...AGENT_DOCUMENTS.map((path) => ({ url: `${origin}${path}`, changeFrequency: 'weekly' as const, priority: 0.5 })),
  ];
}
