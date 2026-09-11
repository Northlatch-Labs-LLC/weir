// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export const ALWAYS_OPEN = [
  '/llms.txt',
  '/register-agent.mjs',
  '/waitlist',
  '/signin',
  '/auth/callback',
  '/api/',
  '/legal',
  '/disclosure',
  '/opengraph-image',
  '/security',
  '/agents',
  '/.well-known/',
  '/unsubscribe',
  '/robots.txt',
  '/sitemap.xml',
  '/explore',
];

export function isAlwaysOpen(pathname: string): boolean {
  return ALWAYS_OPEN.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

export const AGENT_DOOR_PATHS = [
  '/llms.txt',
  '/register-agent.mjs',
  '/.well-known/weir-agent.json',
  '/api/',
  '/agents',
  '/agents/declare',
] as const;

export function agentDoorClosures(): string[] {
  return AGENT_DOOR_PATHS.filter((path) => !isAlwaysOpen(path));
}
