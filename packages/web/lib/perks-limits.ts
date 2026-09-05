// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The limits, in a module with no `server-only` import so the editor can hold the same numbers the
 * store and the table hold. `lib/perks.ts` re-exports these; `test/perks.test.ts` asserts they match
 * the constraints in `db/017_creator_perks.sql`.
 */
export const MAX_PERKS = 6;
export const MAX_TITLE = 80;
export const MAX_DETAIL = 400;
