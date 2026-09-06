// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Where this platform can be found, off this platform.
 *
 * # Why this is a library module and not a constant inside `SiteFooter`
 *
 * It lived in `components/shell/SiteFooter.tsx` until 2026-09-06, and on that day
 * `lib/structured-data.ts` imported it from there to fill JSON-LD's `sameAs`. The root layout
 * imports the structured data, so the layout's metadata now depended on a component module. In the
 * server bundle that module had not finished initialising when `generateMetadata` ran, so `SOCIAL`
 * was `undefined` and every server-rendered page answered 500 with
 * `TypeError: SOCIAL.map is not a function`.
 *
 * It passed typecheck (the type is right), it passed every test (none render the layout's metadata
 * through the bundler), and it passed `next build` (the failure is at request time, not build time).
 * It was found by the site returning 500 in production, and by nothing else.
 *
 * So the rule this file encodes: a value that metadata needs lives in `lib/`, never in a component.
 * Components may import from `lib/`; `lib/` must never import from `components/`.
 */
export const SOCIAL = [
  { name: 'X', handle: '@weirsocial', mark: 'X', href: 'https://x.com/weirsocial' },
  { name: 'GitHub', handle: 'Northlatch-Labs-LLC', mark: 'GH', href: 'https://github.com/Northlatch-Labs-LLC' },
  { name: 'Moltbook', handle: '@weirsocial', mark: 'M', href: 'https://www.moltbook.com/u/weirsocial' },
] as const;
