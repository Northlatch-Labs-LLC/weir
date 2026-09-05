// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Sending one templated message to one address, through Resend's HTTP API.
 *
 * # Nothing in this repository sent mail before this file
 *
 * There was no sender, no template loader and no provider call anywhere in `packages/web` — the
 * waiting list could be joined and never written to. This is the sending half; `email-token.ts`
 * and `app/unsubscribe/route.ts` are the half that lets a person leave. Neither half is a licence
 * to send: the send itself happens only through `scripts/send-waitlist-email.mjs`, which refuses
 * without both a flag and an environment variable set by hand.
 *
 * # No `server-only` and no local imports, for the reason `email-token.ts` gives
 *
 * The script imports this file directly as a `.ts` path under Node's own type stripping, which
 * works only while the imports are standard-library. The unsubscribe URL arrives as a string
 * argument rather than by importing the module that mints it, which keeps that true.
 *
 * # HTTP, not the SDK
 *
 * Resend publishes a client library. This posts JSON to the documented endpoint instead, because
 * the whole surface used here is one request with four fields, and a dependency that can send mail
 * is a dependency whose next version can send mail differently.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The documented endpoint. One request, one message. */
export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** The environment variable holding the provider key. The NAME lives here; the value never does. */
export const RESEND_KEY_VAR = 'RESEND_API_KEY';

/**
 * The sender.
 *
 * A constant rather than an environment variable on purpose. An address that can be changed by a
 * deployment setting is an address that can be changed by mistake, and the From line is the one
 * field a reader uses to decide whether the message is from us. This is the address the email
 * programme names for the waiting list, and it does not vary by environment because there is one
 * of it.
 *
 * It does not send today. `weir.social` is not a verified domain in Resend and no route for
 * `hello@` exists; `docs/waitlist-email.md` names the DNS records and the mailbox route that make
 * this true, and both are an operator's hand, not this file's.
 */
export const WEIR_FROM = 'Weir <hello@weir.social>';

/**
 * Where a reply goes.
 *
 * The same address, and it must be a mailbox a person reads. A no-reply address on a message that
 * says "we would rather you read that from us now" invites an answer to a wall.
 */
export const WEIR_REPLY_TO = 'hello@weir.social';

/**
 * The one token a template carries that this code fills in.
 *
 * It is the only substitution there is. A template language would be a second place for a claim to
 * be assembled, and every sentence in these messages carries an address it can be checked against —
 * assembling them from parts is how a claim loses the address it was checked at.
 */
export const UNSUBSCRIBE_PLACEHOLDER = '{{unsubscribe_url}}';

/**
 * A message as design hands it over: an identity, a subject, and the two bodies.
 *
 * `id` is what the send log is keyed on, so it is what makes "never twice" mean anything. It names
 * the message, not the file — renaming the file must not let the same message go out again.
 */
export interface EmailTemplate {
  id: string;
  subject: string;
  html: string;
  text: string;
}

/** A rendered message, ready to hand to the provider. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * A template out of its JSON file, or a refusal naming what is wrong with it.
 *
 * Four fields, all required, all non-empty — and both bodies must carry
 * {@link UNSUBSCRIBE_PLACEHOLDER}. That last check is the important one: a message with no way out
 * of the list is the exact thing `weir.social/waitlist` promises will not be sent, and the way that
 * promise gets broken is not malice but a template someone forgot to put the line in. Refusing here
 * means it cannot reach a person at all, rather than being noticed afterwards.
 *
 * The plain-text body is required rather than derived. A generated text alternative says whatever
 * a converter makes of the markup, and the email programme's rule is that it "carries the same
 * words in the same order" — which is a thing a person writes, not a thing a stripper produces.
 */
export function parseTemplate(
  raw: string,
  /**
   * How to reach a body held in a file beside the manifest, when one is.
   *
   * Optional, so the inline form needs nothing. `parseTemplate` with no reader refuses a manifest
   * that points at files rather than pretending it can find them.
   */
  from?: { baseDir: string; read: (path: string) => string },
): EmailTemplate {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('the template file is not JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('the template file must hold one JSON object with id, subject, html and text');
  }

  const record = value as Record<string, unknown>;
  const out: Record<string, string> = {};

  for (const field of ['id', 'subject'] as const) {
    const held = record[field];
    if (typeof held !== 'string' || held.trim() === '') {
      throw new Error(`the template's "${field}" must be a non-empty string`);
    }
    out[field] = held;
  }

  /*
    A body is either written into the manifest or pointed at beside it, never both.

    The second form exists because design hands over an HTML file and a text file, and the only
    other way to get them into a manifest is for somebody to paste an email body into a JSON string
    and escape it by hand. That transcription is where a broken message comes from, and refusing to
    need it is cheaper than checking it afterwards. Both forms end up in the same validation below,
    so a body read from a file is held to every rule an inline one is.
  */
  for (const field of ['html', 'text'] as const) {
    const inline = record[field];
    const pointer = record[`${field}Path`];

    if (typeof inline === 'string' && typeof pointer === 'string') {
      throw new Error(
        `the template gives both "${field}" and "${field}Path". One body, one place it comes from.`,
      );
    }

    if (typeof pointer === 'string') {
      if (pointer.trim() === '') {
        throw new Error(`the template's "${field}Path" must be a non-empty string`);
      }
      if (from === undefined) {
        throw new Error(
          `the template's "${field}Path" points at a file, and this caller cannot read files. ` +
            'Use loadTemplate, which reads the manifest and the bodies beside it.',
        );
      }
      // Relative to the manifest, so a manifest and its bodies move together.
      out[field] = from.read(resolve(from.baseDir, pointer));
      if (out[field].trim() === '') {
        throw new Error(`the file named by "${field}Path" is empty`);
      }
      continue;
    }

    if (typeof inline !== 'string' || inline.trim() === '') {
      throw new Error(`the template's "${field}" must be a non-empty string`);
    }
    out[field] = inline;
  }

  const template: EmailTemplate = {
    id: out['id'] as string,
    subject: out['subject'] as string,
    html: out['html'] as string,
    text: out['text'] as string,
  };

  for (const body of ['html', 'text'] as const) {
    if (!template[body].includes(UNSUBSCRIBE_PLACEHOLDER)) {
      throw new Error(
        `the template's "${body}" does not contain ${UNSUBSCRIBE_PLACEHOLDER}. Every message to ` +
          'the waiting list carries a working way out of it, in both bodies.',
      );
    }
  }

  return template;
}

/**
 * A template off disk: the manifest, and any body it points at beside itself.
 *
 * The one loader the command uses, so "what is a template" has a single answer that a test can
 * exercise and an operator can read.
 */
export function loadTemplate(manifestPath: string): EmailTemplate {
  const full = resolve(manifestPath);
  return parseTemplate(readFileSync(full, 'utf8'), {
    baseDir: dirname(full),
    read: (path) => readFileSync(path, 'utf8'),
  });
}

/**
 * The template with the link in it.
 *
 * Every occurrence is replaced, not the first: a message with the link in the footer and again in
 * the sentence above it is ordinary, and a half-substituted body would ship the placeholder to a
 * reader. The result is checked afterwards for a surviving placeholder anywhere, including the
 * subject, so a mistake is a refusal rather than a delivered `{{unsubscribe_url}}`.
 */
export function renderTemplate(template: EmailTemplate, unsubscribeUrl: string): RenderedEmail {
  if (unsubscribeUrl.trim() === '') {
    throw new Error('rendering needs the unsubscribe URL that will go into the message');
  }

  const fill = (body: string): string => body.split(UNSUBSCRIBE_PLACEHOLDER).join(unsubscribeUrl);
  const rendered: RenderedEmail = {
    subject: fill(template.subject),
    html: fill(template.html),
    text: fill(template.text),
  };

  for (const part of ['subject', 'html', 'text'] as const) {
    if (rendered[part].includes('{{')) {
      throw new Error(
        `the rendered ${part} still contains a "{{" placeholder. ${UNSUBSCRIBE_PLACEHOLDER} is ` +
          'the only substitution this sender performs.',
      );
    }
  }

  return rendered;
}

/**
 * The provider key, or a refusal that names the variable and never its contents.
 *
 * Read at the moment of sending rather than at import, so a dry run needs no key at all — which is
 * what makes the dry run something anybody can run without the pile being open.
 */
export function requireResendKey(value: string | undefined): string {
  const key = (value ?? '').trim();
  if (key === '') {
    throw new Error(
      `${RESEND_KEY_VAR} is not set. It is placed by the operator from the machine-key pile; ` +
        'nothing in this repository holds it.',
    );
  }
  return key;
}

/** What happened to one message. Three outcomes, none of which is mistakable for another. */
export type SendOutcome =
  | {
      /** Rendered and not sent. Nothing left this machine. */
      kind: 'dry-run';
      to: string;
      subject: string;
      html: string;
      text: string;
    }
  | {
      /** The provider accepted it and named it. */
      kind: 'sent';
      to: string;
      subject: string;
      providerMessageId: string;
    }
  | {
      /**
       * The provider answered and refused. `status` is its HTTP status; the body is logged, not
       * carried, because a provider's own words are the provider's and this value is read by the
       * operator's screen and by the send log.
       *
       * A thrown exception is NOT this: a request that never got an answer leaves the question of
       * whether a message was created open, and swallowing that into a value the caller can treat
       * as "not sent" is how one recipient receives three copies. Transport failures propagate.
       */
      kind: 'refused';
      to: string;
      subject: string;
      status: number;
    };

export interface SendInput {
  template: EmailTemplate;
  to: string;
  /** The link for THIS recipient. One address, one token; never a shared link. */
  unsubscribeUrl: string;
  /** `List-Unsubscribe` and `List-Unsubscribe-Post`, from `email-token.ts`. */
  headers: Record<string, string>;
  /** True renders and returns; false is the only value that can put a message on the wire. */
  dryRun: boolean;
  /** Required when `dryRun` is false, ignored when it is true. Never logged, never returned. */
  apiKey?: string | undefined;
  /** The caller's `fetch`, so a test can drive this without a network. */
  fetchImpl?: typeof fetch;
}

/**
 * Render one message, and send it only when told to.
 *
 * The dry run is the default everywhere above this function, and it is a real render: the same
 * substitution, the same refusals, the same headers. A dry run that took a different path would
 * prove nothing about the send.
 */
export async function sendTemplatedEmail(input: SendInput): Promise<SendOutcome> {
  const rendered = renderTemplate(input.template, input.unsubscribeUrl);

  if (input.dryRun) {
    return {
      kind: 'dry-run',
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
  }

  const key = requireResendKey(input.apiKey);
  const send = input.fetchImpl ?? fetch;

  const response = await send(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      // The one place the key is used. It is never put in a log line, a return value or an error.
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: WEIR_FROM,
      to: [input.to],
      reply_to: WEIR_REPLY_TO,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: input.headers,
    }),
  });

  if (!response.ok) {
    // The provider's own words go to the operator's log, and the status is what the caller acts on.
    const body = await response.text().catch(() => '');
    console.error(JSON.stringify({ resendRefused: response.status, body }));
    return { kind: 'refused', to: input.to, subject: rendered.subject, status: response.status };
  }

  const payload = (await response.json()) as { id?: unknown };
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (id === '') {
    /*
      Accepted with no id. The message may well have gone; what is certain is that we cannot name it
      afterwards, which is exactly the state the duplicate rule exists for. Thrown rather than
      returned, so no caller can record this as a clean send.
    */
    throw new Error(
      `${RESEND_ENDPOINT} answered ${response.status} without an id. A message may have been ` +
        'created; query the provider for it before any retry.',
    );
  }

  return { kind: 'sent', to: input.to, subject: rendered.subject, providerMessageId: id };
}
