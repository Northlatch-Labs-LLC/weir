// Built-by: @projectx.sui · Co-authored-by: Claude <no-reply@anthropic.com>
//
// The Vercel build configuration, kept in the one file Vercel reads.
//
// WHY THIS EXISTS. The Vercel project's Root Directory is packages/web, and Vercel reads the
// vercel.json that sits there. Until 2026-11-21 only the repository-root vercel.json existed, so
// that one was read: it pinned the install and build commands to the pnpm this repository pins.
// Commit f17278b added packages/web/vercel.json for the cron schedule — five lines, `crons` only.
// From that commit no git-triggered build succeeded again, production or preview, for four days:
// the new file became the project configuration, the root file stopped being read, and with it
// went `installCommand`. Vercel fell back to its own `pnpm install` at its own pnpm (12.16.1),
// `devEngines.packageManager.onFail: "error"` refused it, and every build died in four seconds
// with ERR_PNPM_BAD_PM_VERSION. Production carried on only because it had been deployed by hand
// from a laptop, which is why nobody saw it: the last three "deploys" of main were all errors.
//
// What it checks, offline, on every pull request:
//   packages/web/vercel.json  is complete on its own (install, build, crons)
//   both commands             name the pnpm that package.json pins, by exact version
//   vercel.json (root)        carries nothing the nested file shadows
//   every cron path           is a route that exists
//
// It reads files only. It cannot see the Vercel project's settings; the Root Directory named
// above is the one the project has had since it was created, and if that ever changes, this
// script changes with it in the same commit.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'packages/web');

const problems = [];
const refuse = (message) => problems.push(message);

const readJson = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

const pkg = readJson('package.json');
const pinned =
  pkg.devEngines?.packageManager?.version ?? pkg.packageManager?.split('@')[1]?.split('+')[0] ?? null;

if (pinned === null) {
  refuse('package.json pins no pnpm version (devEngines.packageManager.version or packageManager).');
}

// --- the file Vercel reads -------------------------------------------------------------------
const nestedFile = 'packages/web/vercel.json';
if (!existsSync(join(root, nestedFile))) {
  refuse(`${nestedFile} does not exist. It is the project configuration for a project whose Root Directory is packages/web.`);
} else {
  const nested = readJson(nestedFile);

  for (const key of ['installCommand', 'buildCommand', 'crons']) {
    if (nested[key] === undefined) {
      refuse(
        `${nestedFile} has no "${key}". Vercel reads this file and no other, so a key missing here ` +
          'is a key left to Vercel\'s defaults — which is how the pinned pnpm was lost.',
      );
    }
  }

  for (const key of ['installCommand', 'buildCommand']) {
    const command = nested[key];
    if (typeof command !== 'string') continue;

    const named = command.match(/pnpm@(\d+\.\d+\.\d+)/);
    if (named === null) {
      refuse(`${nestedFile} "${key}" does not name a pnpm version: "${command}".`);
    } else if (named[1] !== pinned) {
      refuse(
        `${nestedFile} "${key}" names pnpm@${named[1]}, but package.json pins ${pinned}. ` +
          'Vercel runs the version this file names and devEngines refuses any other, so the build dies before it installs.',
      );
    }
  }

  if (typeof nested.installCommand === 'string' && !nested.installCommand.includes('--frozen-lockfile')) {
    refuse(`${nestedFile} "installCommand" does not pass --frozen-lockfile: "${nested.installCommand}".`);
  }

  // The web app imports the SDK as compiled JavaScript from a gitignored dist/. A build that runs
  // `next build` alone typechecks against whatever dist/ held, which on a clean machine is nothing.
  if (typeof nested.buildCommand === 'string' && !/\s-r\s+build/.test(nested.buildCommand)) {
    refuse(
      `${nestedFile} "buildCommand" is not a recursive build: "${nested.buildCommand}". It must build every ` +
        'workspace package, because packages/sdk/dist does not exist on a clean checkout.',
    );
  }

  if (Array.isArray(nested.crons)) {
    for (const cron of nested.crons) {
      if (typeof cron?.path !== 'string' || !cron.path.startsWith('/')) {
        refuse(`${nestedFile} names a cron with no absolute path: ${JSON.stringify(cron)}.`);
        continue;
      }
      const route = join(web, 'app', cron.path.slice(1), 'route.ts');
      if (!existsSync(route)) {
        refuse(`${nestedFile} schedules "${cron.path}", but there is no route at packages/web/app${cron.path}/route.ts.`);
      }
    }
  }
}

// --- the file it shadows ---------------------------------------------------------------------
const rootConfig = readJson('vercel.json');
for (const key of ['installCommand', 'buildCommand', 'crons']) {
  if (rootConfig[key] !== undefined) {
    refuse(
      `vercel.json (root) carries "${key}". Vercel reads ${nestedFile} for the build, so this copy is ` +
        'never run; it reads as live configuration and is not. Keep build settings in one file.',
    );
  }
}
if (rootConfig.git?.deploymentEnabled === undefined) {
  refuse('vercel.json (root) has no git.deploymentEnabled. That setting is repository-level and only read from here.');
}

if (problems.length > 0) {
  console.error(`vercel configuration REFUSED — ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `vercel configuration agrees: ${nestedFile} installs and builds with pnpm@${pinned}, the pin in package.json.`,
);
