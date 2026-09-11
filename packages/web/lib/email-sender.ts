// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const RESEND_KEY_VAR = 'RESEND_API_KEY';

export const WEIR_FROM = 'Weir <hello@weir.social>';

export const WEIR_REPLY_TO = 'hello@weir.social';

export const UNSUBSCRIBE_PLACEHOLDER = '{{unsubscribe_url}}';

export interface EmailTemplate {
  id: string;
  subject: string;
  html: string;
  text: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function parseTemplate(
  raw: string,
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

export function loadTemplate(manifestPath: string): EmailTemplate {
  const full = resolve(manifestPath);
  return parseTemplate(readFileSync(full, 'utf8'), {
    baseDir: dirname(full),
    read: (path) => readFileSync(path, 'utf8'),
  });
}

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

export type SendOutcome =
  | {
      kind: 'dry-run';
      to: string;
      subject: string;
      html: string;
      text: string;
    }
  | {
      kind: 'sent';
      to: string;
      subject: string;
      providerMessageId: string;
    }
  | {
      kind: 'refused';
      to: string;
      subject: string;
      status: number;
    };

export interface SendInput {
  template: EmailTemplate;
  to: string;
  unsubscribeUrl: string;
  headers: Record<string, string>;
  dryRun: boolean;
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch;
}

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
    const body = await response.text().catch(() => '');
    console.error(JSON.stringify({ resendRefused: response.status, body }));
    return { kind: 'refused', to: input.to, subject: rendered.subject, status: response.status };
  }

  const payload = (await response.json()) as { id?: unknown };
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (id === '') {
    throw new Error(
      `${RESEND_ENDPOINT} answered ${response.status} without an id. A message may have been ` +
        'created; query the provider for it before any retry.',
    );
  }

  return { kind: 'sent', to: input.to, subject: rendered.subject, providerMessageId: id };
}
