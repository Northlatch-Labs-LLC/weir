#!/usr/bin/env -S npx tsx
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readAuditFile, verifyAuditLines } from '../src/audit-file.js';

const path = process.argv[2];
if (path === undefined) {
  process.stderr.write('verify-audit: usage: verify-audit <path/to/audit.jsonl>\n');
  process.exit(2);
}

const read = await readAuditFile(path);
if (!read.ok) {
  process.stderr.write(`verify-audit: ${path} — ${read.reason}\n`);
  process.exit(2);
}

const verdict = verifyAuditLines(read.lines);
if (!verdict.intact) {
  process.stderr.write(
    `verify-audit: BROKEN at line ${String(verdict.line)} of ${path}\n  ${verdict.reason}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `verify-audit: intact — ${String(verdict.length)} line(s), head ${verdict.headHash}\n`,
);
process.exit(0);
