// Built-by: @projectx.sui · Co-authored-by: Claude
/*
  A no-op stand-in for the `server-only` package, used by the test runner alone.

  The real package throws on import. That is its entire purpose: it fails the build when server
  code is pulled into a client bundle, which is how a database credential or a derivation seed ends
  up shipped to a browser. Vitest is not a bundler and has no client boundary to protect, so the
  tripwire fires on every server module a test imports and nothing is being guarded against.

  Aliased here, in the test config only. `next build` still resolves the real package, so the
  protection is intact everywhere it means something.
*/
export {};
