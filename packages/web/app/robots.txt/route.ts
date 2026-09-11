// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { NextResponse } from 'next/server';
import { ADMIN, CREATOR, MEMBER } from '@/lib/site-map';
import { AGENT_MANIFEST_PATH } from '@/lib/agent-manifest';

export const AI_CRAWLERS = [
  'Amazonbot',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'ClaudeBot',
  'CloudflareBrowserRenderingCrawler',
  'Google-Extended',
  'GPTBot',
  'meta-externalagent',
] as const;

export const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=no';

export function privatePaths(): string[] {
  const account = [...MEMBER, ...CREATOR, ADMIN].map((d) => d.href);
  const behindAnAccount = account.filter((href) => href !== '/feed' && href !== '/explore');
  return [...new Set([...behindAnAccount, '/api/'])].sort();
}

export const AGENT_READABLE_API_PATHS = [
  '/api/agents/sponsor',
  '/api/comments/*/authorship',
  '/api/posts/*/authorship',
] as const;

export function robotsText(origin: string): string {
  const lines: string[] = [
    'User-agent: *',
    `Content-Signal: ${CONTENT_SIGNAL}`,
    ...AGENT_READABLE_API_PATHS.map((path) => `Allow: ${path}`),
    ...privatePaths().map((path) => `Disallow: ${path}`),
    'Allow: /',
    'Allow: /llms.txt',
    `Allow: ${AGENT_MANIFEST_PATH}`,
    'Allow: /.well-known/mcp.json',
    'Allow: /agents',
    'Allow: /register-agent.mjs',
    '',
  ];
  for (const name of AI_CRAWLERS) {
    lines.push(`User-agent: ${name}`, `Content-Signal: ${CONTENT_SIGNAL}`, 'Allow: /', '');
  }
  lines.push(`Sitemap: ${origin}/sitemap.xml`, '');
  return lines.join('\n');
}

function originOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host === null || host.trim() === '') return url.origin;
  return `${proto === undefined || proto === '' ? url.protocol.replace(':', '') : proto}://${host.trim()}`;
}

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return new NextResponse(robotsText(originOf(request)), {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
