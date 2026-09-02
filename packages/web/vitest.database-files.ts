// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The test files that share the disposable database.
 *
 * Every file here calls `useTestDatabase()` and truncates every table in `beforeEach`. Run in
 * parallel they erase each other's rows mid-assertion: a paging walk sees twenty-seven posts become
 * nine, an upsert finds its row gone. They passed side by side for months because each one's window
 * was a few milliseconds wide; a file that seeds thirty rows one round-trip at a time made the
 * collision reliable. So `vitest.config.ts` runs this list in its own project with
 * `fileParallelism: false`, and everything else stays parallel.
 *
 * The list is literal on purpose, and it is checked: `test/every-database-test-is-serialised.test.ts`
 * fails if a file calls `useTestDatabase()` and is not named here, or is named here and does not.
 */
export const DATABASE_TEST_FILES: readonly string[] = [
  'test/idempotency-routes.test.ts',
  'test/machine-edition.test.ts',
  'test/prices-are-whole-numbers.test.ts',
  'test/public-read.test.ts',
  'test/relay.test.ts',
  'test/replay.test.ts',
  'test/routes/browse.test.ts',
  'test/routes/creator-profile.test.ts',
  'test/spend-with-the-write.test.ts',
  'test/sponsor-gate.test.ts',
  'test/sponsor.test.ts',
  'test/the-simulate-ceiling-is-shared.test.ts',
  'test/tiered-sealing.test.ts',
];
