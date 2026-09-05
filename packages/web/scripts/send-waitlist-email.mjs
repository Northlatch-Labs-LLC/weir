// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Send one templated message to the waiting list, or to one address, once.
 *
 *     node --env-file=.env.local scripts/send-waitlist-email.mjs --template=<path> --to=<address>
 *     node --env-file=.env.local scripts/send-waitlist-email.mjs --template=<path> --list
 *     WEIR_EMAIL_SEND_APPROVED=1 node --env-file=.env.local scripts/send-waitlist-email.mjs \
 *       --template=<path> --to=<address> --really-send
 *
 * # It does not send
 *
 * Every run is a dry run unless BOTH of these are true: `--really-send` is on the command line, and
 * `WEIR_EMAIL_SEND_APPROVED=1` is in the environment. Two switches rather than one, because they
 * are set by different acts — one is typed with the command, the other is placed deliberately
 * beforehand — and a single switch is one that gets left on in a shell history.
 *
 * A dry run renders every message in full, substitutes the same per-recipient unsubscribe link, and
 * touches neither the provider nor the send log. It needs no provider key, so it can be run by
 * anybody, at any time, and it is the only thing this script does by default.
 *
 * # It cannot send twice
 *
 * Before each message the row is claimed in `waitlist_email_sends` — `db/042` explains why the
 * claim comes first — and a claim that conflicts means that address has already had this template
 * and is skipped without the provider being called. On 2026-08-30 one recipient got the same card
 * twice, eight minutes apart, because a failed-looking attempt was retried with nothing remembering
 * the first. This is the thing that remembers.
 *
 * # Every message carries a way out
 *
 * The template is refused unless both bodies contain `{{unsubscribe_url}}`, and the link put in its
 * place is signed for that one recipient. There is no run of this script that sends a message
 * somebody cannot leave.
 *
 * # Nothing secret is printed
 *
 * Not the provider key, not the signing secret, not the connection string. The database is
 * identified by its name and host, because "which database am I about to write to" has to be
 * answerable out loud.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';

import {
  UNSUBSCRIBE_SECRET_VAR,
  listUnsubscribeHeaders,
  requireSecret,
  unsubscribeUrl,
} from '../lib/email-token.ts';
import {
  RESEND_KEY_VAR,
  WEIR_FROM,
  loadTemplate,
  requireResendKey,
  sendTemplatedEmail,
} from '../lib/email-sender.ts';
import {
  claimSend,
  confirmSend,
  unresolvedClaims,
  waitlistRecipients,
} from '../lib/waitlist-email-log.ts';

/** The variable that stands for the word to send. Its NAME is here; nothing else is. */
const APPROVAL_VAR = 'WEIR_EMAIL_SEND_APPROVED';

/**
 * Where the links point on a real send, always. `--origin` can move them for a dry run and is
 * refused outright with `--really-send`, which is the check below rather than a promise here.
 */
const DEFAULT_ORIGIN = 'https://weir.social';

const argv = process.argv.slice(2);

/** `--name=value`, or `--name value`. Both are typed by people and both are accepted. */
function option(name) {
  const prefixed = argv.find((a) => a.startsWith(`--${name}=`));
  if (prefixed !== undefined) return prefixed.slice(`--${name}=`.length);
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return undefined;
  const next = argv[at + 1];
  return next === undefined || next.startsWith('--') ? '' : next;
}

const flag = (name) => argv.includes(`--${name}`);

const USAGE = `
send-waitlist-email — one templated message to the waiting list, or to one address.

  --template=<path>   the message, as JSON: { "id", "subject", "html", "text" }.
                      A body may instead be pointed at beside the manifest with
                      "htmlPath" / "textPath", which is how design's two files are
                      used without retyping them. Both bodies must contain
                      {{unsubscribe_url}}.
  --list              every address in waitlist_signups.
  --to=<address>      one address, for a test send to somewhere we control.
  --origin=<url>      where the unsubscribe links point, for reading a dry run against a
                      local server. Refused with --really-send; a real send always uses
                      ${DEFAULT_ORIGIN}.
  --really-send       send for real. Also needs ${APPROVAL_VAR}=1 in the environment.

Dry run by default: renders every message, sends nothing, writes nothing.
`;

/** The database by name and host. Never the credential. */
function describeDatabase(url) {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, '');
    const host = parsed.hostname === '' ? parsed.searchParams.get('host') : parsed.hostname;
    return `${name === '' ? '(default)' : name} at ${host ?? '(socket)'}`;
  } catch {
    return '(unparseable connection string)';
  }
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(2);
}

async function main() {
  const templatePath = option('template');
  if (templatePath === undefined || templatePath === '') fail(`A template is required.\n${USAGE}`);

  const single = option('to');
  const wantsList = flag('list');
  if (wantsList === (single !== undefined && single !== '')) {
    fail(`Give exactly one of --list or --to=<address>.\n${USAGE}`);
  }

  const asked = flag('really-send');

  const given = option('origin');
  /*
    `--origin` is a dry-run option and this is what makes that sentence true rather than a comment.
    The value ends up in the `List-Unsubscribe` header and in both bodies of every message, so a run
    that carries it for real hands the whole list a way out that points somewhere the deployment
    does not serve — and the send log records every one of those as a clean send, because the
    provider accepted the message and returned an id. There is nothing downstream that catches it.
    An operator reruns a line out of shell history exactly once for this to happen to the list.
  */
  if (asked && given !== undefined && given !== '') {
    fail(
      '--origin was given together with --really-send. It is a dry-run option: a real send always ' +
        `points every unsubscribe link at ${DEFAULT_ORIGIN}, because a link anywhere else is a way ` +
        'out that does not work for every recipient at once.\n' +
        'Nothing was sent, nothing was claimed, and the database was not opened. Drop --origin to ' +
        'send, or drop --really-send to read the run.',
    );
  }
  const origin = given === undefined || given === '' ? DEFAULT_ORIGIN : given;

  const template = loadTemplate(templatePath);

  /*
    The signing secret is required even for a dry run. A dry run whose links were fake would prove
    nothing about the links the real run puts in front of people, and this is the one check that
    catches a deployment that cannot honour the unsubscribes it is about to promise.
  */
  const secret = requireSecret(process.env[UNSUBSCRIBE_SECRET_VAR]);

  const approved = process.env[APPROVAL_VAR] === '1';
  if (asked && !approved) {
    fail(
      `--really-send was given but ${APPROVAL_VAR} is not set to 1.\n` +
        'Both are required, and they are set by different acts on purpose. Nothing was sent.',
    );
  }
  const dryRun = !(asked && approved);

  const databaseUrl = (process.env['PROJECTX_DATABASE_URL'] ?? '').trim();
  /*
    A dry run to one named address needs no database: it reads no list and writes no log. Every
    other combination does — the list comes from Postgres, and no real send happens without the row
    that makes it unrepeatable.
  */
  const needsDatabase = wantsList || !dryRun;
  if (needsDatabase && databaseUrl === '') {
    fail('PROJECTX_DATABASE_URL is not set. There is no default.');
  }

  const pool = needsDatabase ? new pg.Pool({ connectionString: databaseUrl, max: 2 }) : null;
  const query = pool === null ? null : (text, params) => pool.query(text, params);

  console.log(`\ntemplate:  ${template.id}  (${resolve(templatePath)})`);
  console.log(`subject:   ${template.subject}`);
  console.log(`from:      ${WEIR_FROM}`);
  console.log(`origin:    ${origin}`);
  console.log(`database:  ${pool === null ? 'not needed for this run' : describeDatabase(databaseUrl)}`);
  console.log(`mode:      ${dryRun ? 'DRY RUN — nothing is sent, nothing is written' : 'SENDING FOR REAL'}\n`);

  let recipients;
  if (wantsList) {
    recipients = await waitlistRecipients(query);
  } else {
    // A single address typed on a command line, lower-cased to match how the column stores one.
    recipients = [single.trim().toLowerCase()];
  }

  if (recipients.length === 0) {
    console.log('No recipients. Nothing to do.\n');
    if (pool !== null) await pool.end();
    return;
  }

  if (pool !== null) {
    /*
      Claims from an earlier run that never came back with a provider id. Each one is an attempt
      whose outcome is unknown, and each one will be skipped below. Printed first so the operator
      learns about them before a run rather than during one.
    */
    const unresolved = await unresolvedClaims(query, template.id);
    if (unresolved.length > 0) {
      console.log(
        `${unresolved.length} address(es) were claimed for this template and never came back with ` +
          'a provider id. They will be skipped. Query the provider for what it holds before ' +
          'clearing any of them by hand:\n',
      );
      for (const address of unresolved) console.log(`  unresolved  ${address}`);
      console.log('');
    }
  }

  const apiKey = dryRun ? undefined : requireResendKey(process.env[RESEND_KEY_VAR]);

  let sent = 0;
  let skipped = 0;
  let refused = 0;

  for (const email of recipients) {
    const url = unsubscribeUrl(origin, email, secret);
    const headers = listUnsubscribeHeaders(url);

    if (dryRun) {
      const outcome = await sendTemplatedEmail({
        template,
        to: email,
        unsubscribeUrl: url,
        headers,
        dryRun: true,
      });
      console.log(`--- would send to ${outcome.to}`);
      console.log(`subject: ${outcome.subject}`);
      for (const [name, value] of Object.entries(headers)) console.log(`${name}: ${value}`);
      console.log(`\n${outcome.html}\n`);
      console.log(`--- plain text\n${outcome.text}\n`);
      continue;
    }

    const claimedAtMs = Date.now();
    const claim = await claimSend(query, { email, templateId: template.id, claimedAtMs });
    if (claim === 'already-sent') {
      skipped += 1;
      console.log(`skipped   ${email}  (already has ${template.id})`);
      continue;
    }

    const outcome = await sendTemplatedEmail({
      template,
      to: email,
      unsubscribeUrl: url,
      headers,
      dryRun: false,
      apiKey,
    });

    if (outcome.kind === 'refused') {
      refused += 1;
      console.log(
        `refused   ${email}  (provider answered ${outcome.status}; the claim stands, so this ` +
          'address will not be retried until it is resolved by hand)',
      );
      continue;
    }

    await confirmSend(query, {
      email,
      templateId: template.id,
      providerMessageId: outcome.providerMessageId,
      sentAtMs: Date.now(),
    });
    sent += 1;
    console.log(`sent      ${email}  ${outcome.providerMessageId}`);
  }

  if (dryRun) {
    console.log(
      `Dry run over ${recipients.length} recipient(s). Nothing was sent and nothing was written.\n` +
        `To send for real: ${APPROVAL_VAR}=1 and --really-send, both.\n`,
    );
  } else {
    console.log(`\n${sent} sent, ${skipped} skipped, ${refused} refused.\n`);
  }

  if (pool !== null) await pool.end();
  if (refused > 0) process.exit(1);
}

/*
  Run only when this file IS the command, not when something imports it — the same rule
  `scripts/migrate.mjs` follows, so the pieces above stay importable by a test.
*/
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
