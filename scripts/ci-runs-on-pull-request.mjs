// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// The web and contracts suites are the gate: they typecheck and test the half that ships to
// readers and the half that holds the money. Both run on a clean machine on every pull request,
// so a red result is read by the person who caused it while the change is still in their head.
// This script reads the workflow as text and fails if either job has been narrowed back to
// `workflow_dispatch` or `schedule` only, or if the trigger list has lost one of the three ways
// this suite is expected to run.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2] ?? join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '.github/workflows/ci.yml');
const text = readFileSync(target, 'utf8');
const lines = text.split('\n');

const problems = [];

// --- on: must offer pull_request, schedule and workflow_dispatch ---

const onStart = lines.findIndex((line) => /^on:\s*$/.test(line));
if (onStart === -1) {
  problems.push('no top-level `on:` block found');
} else {
  let onEnd = lines.length;
  for (let i = onStart + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) {
      onEnd = i;
      break;
    }
  }
  const onBlock = lines.slice(onStart, onEnd).join('\n');
  for (const trigger of ['pull_request', 'schedule', 'workflow_dispatch']) {
    if (!new RegExp(`^\\s*${trigger}:`, 'm').test(onBlock)) {
      problems.push(`\`on:\` is missing \`${trigger}\``);
    }
  }
}

// --- web and contracts must carry no job-level `if:` that restricts them to dispatch/schedule ---

const jobsStart = lines.findIndex((line) => /^jobs:\s*$/.test(line));
if (jobsStart === -1) {
  problems.push('no top-level `jobs:` block found');
} else {
  const jobStarts = [];
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const match = lines[i].match(/^  ([\w-]+):\s*$/);
    if (match) jobStarts.push({ name: match[1], line: i });
  }

  for (const jobName of ['web', 'contracts']) {
    const job = jobStarts.find((j) => j.name === jobName);
    if (!job) {
      problems.push(`no \`${jobName}\` job found`);
      continue;
    }
    const nextIndex = jobStarts.indexOf(job) + 1;
    const jobEnd = nextIndex < jobStarts.length ? jobStarts[nextIndex].line : lines.length;
    const jobBlock = lines.slice(job.line, jobEnd);
    const ifLine = jobBlock.find((line) => /^ {4}if:\s*\S/.test(line));
    if (ifLine && /workflow_dispatch|schedule/.test(ifLine)) {
      problems.push(`\`${jobName}\` carries a job-level \`if:\` that mentions workflow_dispatch or schedule: ${ifLine.trim()}`);
    }
  }
}

if (problems.length > 0) {
  console.error('ci-runs-on-pull-request: the suite is not gating pull requests —\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nweb and contracts must run on every pull_request, with push, schedule and workflow_dispatch as the other ways in.');
  process.exit(1);
}

console.log(`ci-runs-on-pull-request: OK (${target})`);
