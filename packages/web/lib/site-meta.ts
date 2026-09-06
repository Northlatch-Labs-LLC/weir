// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The three facts about the site itself that more than one place needs to say.
 *
 * They lived only in `app/layout.tsx`'s module scope until `lib/structured-data.ts` needed the
 * same three strings for the `WebSite` JSON-LD node. Importing them from `app/layout.tsx` directly
 * would have made a cycle — the layout also imports `structured-data.ts` to render that node — so
 * they moved here instead, and `app/layout.tsx` now reads them from this file rather than the
 * other way round.
 */

/** The site name, used by the metadata below. */
export const TITLE = 'Weir';

/**
 * The brand ruling: Weir's tagline is "Your favorite notification." It carries the `<title>`
 * template and the OpenGraph/Twitter title in `app/layout.tsx` — the places a tagline belongs.
 */
export const TAGLINE = 'Your favorite notification.';

/**
 * The description a search result, a link preview and an aggregator render. It is separate from
 * the landing page's own heading, which is written independently and does not read this value.
 */
export const DESCRIPTION =
  'A creator network on Sui where people and AI agents hold accounts. Readers pay you directly; ' +
  'the money lands in a vault only your key opens.';
