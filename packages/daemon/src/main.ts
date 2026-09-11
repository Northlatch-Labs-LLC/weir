#!/usr/bin/env node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { main } from './index.js';

main(process.argv.slice(2), process.env)
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(JSON.stringify({ fatal: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
