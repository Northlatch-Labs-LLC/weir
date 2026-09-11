// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it, vi } from 'vitest';
import { ADMIN, CREATOR, MEMBER } from '../lib/site-map';
import { AGENT_MANIFEST_PATH } from '../lib/agent-manifest';
import { ALWAYS_OPEN } from '../proxy';

vi.mock('../lib/agent-manifest', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/agent-manifest')>();
  return {
    ...real,
    servedManifest: async () => ({
      manifest: {
        manifest: 'weir-agent/1',
        service: 'weir',
        note: 'A null section means this deployment has not configured it',
        origin: 'https://weir.social',
        chain: { network: 'mainnet' },
        endpoints: [{ path: '/api/session' }, { path: '/api/agents/declare' }],
      },
      contentDigest: 'sha-256=:x:',
      etag: '"x"',
    }),
  };
});

const { AGENT_READABLE_API_PATHS, AI_CRAWLERS, CONTENT_SIGNAL, privatePaths, robotsText } = await import(
  '../app/robots.txt/route'
);
const { openPages, default: sitemap } = await import('../app/sitemap');
const { REGISTRATION_TYPE, registrationFor } = await import('../app/.well-known/agent-registration.json/route');
const { GET: securityTxtGET, SECURITY_TXT } = await import('../app/.well-known/security.txt/route');

const ORIGIN = 'https://weir.social';

describe('robots.txt', () => {
  const text = robotsText(ORIGIN);
  const lines = text.split('\n');

  it('opens with the signal under the catch-all group, so a crawler that reads one group has it', () => {
    expect(lines[0]).toBe('User-agent: *');
    expect(lines[1]).toBe(`Content-Signal: ${CONTENT_SIGNAL}`);
  });

  it('says findable', () => {
    expect(CONTENT_SIGNAL).toMatch(/\bsearch=yes\b/);
  });

  it('says usable in answers', () => {
    expect(CONTENT_SIGNAL).toMatch(/\bai-input=yes\b/);
  });

  it('says NOT trained on — the value most likely to be flipped by accident', () => {
    expect(CONTENT_SIGNAL).toMatch(/\bai-train=no\b/);
    expect(text).not.toMatch(/ai-train=yes/);
  });

  it('carries the signal in exactly the vocabulary the edge prints', () => {
    expect(CONTENT_SIGNAL).toBe('search=yes, ai-input=yes, ai-train=no');
  });

  it('hides every page behind an account, taken from the site map rather than typed', () => {
    const hidden = privatePaths();
    for (const d of [...MEMBER, ...CREATOR, ADMIN]) {
      if (d.href === '/feed' || d.href === '/explore') continue;
      expect(hidden, `${d.href} is in a menu behind an account but not disallowed`).toContain(d.href);
      expect(text).toContain(`Disallow: ${d.href}`);
    }
    expect(text).toContain('Disallow: /api/');
  });

  it('does not hide the public pages that happen to sit in the member menu', () => {
    expect(text).not.toContain('Disallow: /feed');
    expect(text).not.toContain('Disallow: /explore');
  });

  it('admits every named AI crawler explicitly, with the same signal', () => {
    expect(AI_CRAWLERS.length).toBeGreaterThanOrEqual(9);
    for (const name of AI_CRAWLERS) {
      const at = lines.indexOf(`User-agent: ${name}`);
      expect(at, `${name} has no group`).toBeGreaterThan(-1);
      expect(lines[at + 1]).toBe(`Content-Signal: ${CONTENT_SIGNAL}`);
      expect(lines[at + 2]).toBe('Allow: /');
    }
  });

  it('names the crawlers the edge lists, so the two files speak about the same agents', () => {
    for (const name of ['ClaudeBot', 'GPTBot', 'CCBot', 'Google-Extended']) {
      expect(AI_CRAWLERS as readonly string[]).toContain(name);
    }
  });

  it('points at the sitemap on the origin it is served from', () => {
    expect(text).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('names the discovery documents as DIRECTIVES, not inside a comment', () => {
    const directives = text.split('\n').filter((line) => !line.trimStart().startsWith('#'));
    for (const path of ['/llms.txt', AGENT_MANIFEST_PATH, '/.well-known/mcp.json', '/agents', '/register-agent.mjs']) {
      expect(directives, `${path} must be reachable outside a comment`).toContain(`Allow: ${path}`);
    }
  });

  it('follows the origin it is given, so a mirror points crawlers at the mirror', () => {
    const mirror = robotsText('https://mirror.example');
    expect(mirror).toContain('Sitemap: https://mirror.example/sitemap.xml');
    expect(mirror).not.toContain(ORIGIN);
  });

  it('carries exactly one `User-agent: *` group', () => {
    expect(lines.filter((line) => line === 'User-agent: *')).toHaveLength(1);
  });

  it('allows the exact reads `llms.txt` sends an agent to, ahead of `Disallow: /api/`', () => {
    for (const path of AGENT_READABLE_API_PATHS) {
      const allowAt = lines.indexOf(`Allow: ${path}`);
      const disallowApi = lines.indexOf('Disallow: /api/');
      expect(allowAt, `Allow: ${path} must be present`).toBeGreaterThan(-1);
      expect(allowAt).toBeLessThan(disallowApi);
    }
    expect(text).toContain('Disallow: /api/');
  });
});

describe('sitemap.xml', () => {
  it('lists only pages from the open list, and no documents', () => {
    const pages = openPages();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(ALWAYS_OPEN).toContain(page);
    for (const notAPage of ['/api/', '/signin', '/waitlist', '/.well-known/', '/llms.txt', '/robots.txt', '/sitemap.xml']) {
      expect(pages).not.toContain(notAPage);
    }
  });

  it('the sitemap itself carries the agent documents, even though they are not pages', () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const doc of ['/llms.txt', '/.well-known/weir-agent.json', '/.well-known/mcp.json']) {
      expect(urls, `${doc} must be in the sitemap`).toContain(`https://weir.social${doc}`);
    }
    for (const page of openPages()) expect(urls).toContain(`https://weir.social${page}`);
  });

  it('includes the page an operator reads before pointing an agent here', () => {
    expect(openPages()).toContain('/agents');
  });

  it('lists the homepage, and only once', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.filter((u) => u === 'https://weir.social/')).toHaveLength(1);
  });

  it('never lists the same page twice', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('the gate', () => {
  it('lets robots.txt and sitemap.xml through, or a crawler behind it reads a 307 as "no robots.txt"', () => {
    expect(ALWAYS_OPEN).toContain('/robots.txt');
    expect(ALWAYS_OPEN).toContain('/sitemap.xml');
  });
});

describe('/.well-known/agent-registration.json', () => {
  it('is a registration-v1 document with the fields the standard requires', async () => {
    const r = await registrationFor(ORIGIN);
    expect(r.type).toBe(REGISTRATION_TYPE);
    expect(r.type).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
    for (const key of ['name', 'description', 'image', 'services', 'active', 'registrations'] as const) {
      expect(r[key], `${key} missing`).toBeDefined();
    }
    expect(typeof r.name).toBe('string');
    expect(r.name.length).toBeGreaterThan(0);
  });

  it('describes the service from measured facts, not from the manifest disclaimer', async () => {
    const r = await registrationFor(ORIGIN);
    expect(r.description).not.toContain('null section');
    expect(r.description).toContain('2 documented HTTP endpoints');
    expect(r.description).toContain(AGENT_MANIFEST_PATH);
    expect(r.description).toContain('mainnet');
  });

  it('is registered nowhere, and says so rather than inventing an entry', async () => {
    const r = await registrationFor(ORIGIN);
    expect(r.registrations).toEqual([]);
    expect(r.x402Support).toBe(false);
  });

  it('names the signed manifest as a service, at the path the manifest is actually served on', async () => {
    const r = await registrationFor(ORIGIN);
    const endpoints = r.services.map((s) => s.endpoint);
    expect(endpoints).toContain(`${ORIGIN}${AGENT_MANIFEST_PATH}`);
    expect(endpoints).toContain(`${ORIGIN}/agents`);
  });

  it('claims no A2A or MCP endpoint, because neither is served at a URL', async () => {
    const r = await registrationFor(ORIGIN);
    expect(r.services.map((s) => s.name)).not.toContain('A2A');
    expect(r.services.map((s) => s.name)).not.toContain('MCP');
  });

  it('builds every endpoint from the origin it is given', async () => {
    const r = await registrationFor('https://mirror.example');
    for (const s of r.services) expect(s.endpoint.startsWith('https://mirror.example/')).toBe(true);
    expect(r.image.startsWith('https://mirror.example/')).toBe(true);
  });
});

describe('/.well-known/security.txt', () => {
  it('is reachable while the door is closed, like every other well-known document', () => {
    expect(ALWAYS_OPEN).toContain('/.well-known/');
  });

  it('carries the RFC 9116 fields a scanner requires', () => {
    expect(SECURITY_TXT).toMatch(/^Contact: mailto:[^\s]+@weir\.social$/m);
    expect(SECURITY_TXT).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
  });

  it('uses the abuse address already published in /legal/terms, not a new mailbox', () => {
    expect(SECURITY_TXT).toContain('Contact: mailto:abuse@weir.social');
  });

  it('points at the human-readable policy page and names its own canonical URL', () => {
    expect(SECURITY_TXT).toContain('Policy: https://weir.social/security');
    expect(SECURITY_TXT).toContain('Canonical: https://weir.social/.well-known/security.txt');
    expect(SECURITY_TXT).toContain('Preferred-Languages: en');
  });

  it('expires no more than a year out, per the RFC\'s own recommendation', () => {
    const expires = /^Expires: (.+)$/m.exec(SECURITY_TXT)?.[1];
    expect(expires).toBeDefined();
    const expiresMs = new Date(expires!).getTime();
    expect(Number.isNaN(expiresMs)).toBe(false);
    const yearMs = 366 * 24 * 60 * 60 * 1000;
    expect(expiresMs - Date.now()).toBeLessThanOrEqual(yearMs);
    expect(expiresMs).toBeGreaterThan(Date.now());
  });

  it('serves as plain text, not JSON', async () => {
    const res = await securityTxtGET(new Request('https://weir.social/.well-known/security.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await res.text();
    expect(body).toBe(SECURITY_TXT);
  });
});
