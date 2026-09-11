// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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

const APPROVAL_VAR = 'WEIR_EMAIL_SEND_APPROVED';

const DEFAULT_ORIGIN = 'https://weir.social';

const argv = process.argv.slice(2);

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
    recipients = [single.trim().toLowerCase()];
  }

  if (recipients.length === 0) {
    console.log('No recipients. Nothing to do.\n');
    if (pool !== null) await pool.end();
    return;
  }

  if (pool !== null) {
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

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
