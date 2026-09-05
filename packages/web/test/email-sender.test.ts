// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// Nothing in this repository had ever sent a message. The first one must carry a working way out of
// the list, must go from the address the email programme names, and must be provable without
// sending — because the only honest way to review an email nobody has seen is to render it.
import { describe, expect, it, vi } from 'vitest';
import {
  RESEND_ENDPOINT,
  RESEND_KEY_VAR,
  UNSUBSCRIBE_PLACEHOLDER,
  WEIR_FROM,
  WEIR_REPLY_TO,
  parseTemplate,
  renderTemplate,
  requireResendKey,
  sendTemplatedEmail,
  type EmailTemplate,
} from '@/lib/email-sender';
import { listUnsubscribeHeaders } from '@/lib/email-token';

const LINK = 'https://weir.social/unsubscribe?token=abc.def';

const template: EmailTemplate = {
  id: 'waitlist-where-we-are-1',
  subject: 'You asked to be told. Here is where the doors are.',
  html: `<p>Weir is in closed alpha.</p><p><a href="${UNSUBSCRIBE_PLACEHOLDER}">Unsubscribe</a></p>`,
  text: `Weir is in closed alpha.\n\nUnsubscribe: ${UNSUBSCRIBE_PLACEHOLDER}\n`,
};

const json = (value: unknown): string => JSON.stringify(value);

describe('a template is refused unless it can be sent lawfully', () => {
  it('accepts a complete one', () => {
    const parsed = parseTemplate(json(template));
    expect(parsed).toEqual(template);
  });

  it('refuses a file that is not JSON, or is not one object', () => {
    for (const raw of ['', 'not json', '[]', '"a string"', 'null']) {
      expect(() => parseTemplate(raw), JSON.stringify(raw)).toThrow();
    }
  });

  it('refuses a missing or empty field, naming which', () => {
    for (const field of ['id', 'subject', 'html', 'text'] as const) {
      const without = { ...template, [field]: '' };
      expect(() => parseTemplate(json(without)), field).toThrow(new RegExp(`"${field}"`));
      const absent: Record<string, unknown> = { ...template };
      delete absent[field];
      expect(() => parseTemplate(json(absent)), field).toThrow(new RegExp(`"${field}"`));
    }
  });

  it('refuses a body with no way out of the list, in either half', () => {
    /*
      The guard that matters most in this file. `weir.social/waitlist` promises one click
      unsubscribes; a template that forgot the line would break that promise for every recipient at
      once, and nobody would find out until somebody tried to leave.
    */
    const noHtml = { ...template, html: '<p>Weir is in closed alpha.</p>' };
    expect(() => parseTemplate(json(noHtml))).toThrow(/"html"/);
    const noText = { ...template, text: 'Weir is in closed alpha.' };
    expect(() => parseTemplate(json(noText))).toThrow(/"text"/);
  });
});

describe('a body may live in the file design wrote it in', () => {
  /*
    Design hands over an HTML file and a text file. The only other way into a manifest is for
    somebody to paste an email body into a JSON string and escape it by hand, and that
    transcription is where a broken message comes from.
  */
  const manifest = {
    id: 'waitlist-where-we-are-1',
    subject: template.subject,
    htmlPath: 'body.html',
    textPath: 'body.txt',
  };

  const reader = (files: Record<string, string>) => ({
    baseDir: '/somewhere',
    read: (path: string) => {
      const held = files[path];
      if (held === undefined) throw new Error(`no such file: ${path}`);
      return held;
    },
  });

  it('reads each body from the path beside the manifest', () => {
    const parsed = parseTemplate(
      json(manifest),
      reader({ '/somewhere/body.html': template.html, '/somewhere/body.txt': template.text }),
    );
    expect(parsed).toEqual(template);
  });

  it('holds a body read from a file to the same rules as an inline one', () => {
    expect(() =>
      parseTemplate(
        json(manifest),
        reader({ '/somewhere/body.html': '<p>no way out</p>', '/somewhere/body.txt': template.text }),
      ),
    ).toThrow(/"html"/);
  });

  it('refuses a body given twice', () => {
    expect(() =>
      parseTemplate(json({ ...manifest, html: template.html }), reader({})),
    ).toThrow(/both "html" and "htmlPath"/);
  });

  it('refuses to guess when the caller cannot read files', () => {
    expect(() => parseTemplate(json(manifest))).toThrow(/cannot read files/);
  });

  it('loads a manifest and its bodies off disk', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const dir = mkdtempSync(join(tmpdir(), 'weir-email-'));
    try {
      writeFileSync(join(dir, 'body.html'), template.html);
      writeFileSync(join(dir, 'body.txt'), template.text);
      writeFileSync(join(dir, 'message.json'), json(manifest));

      const { loadTemplate } = await import('@/lib/email-sender');
      expect(loadTemplate(join(dir, 'message.json'))).toEqual(template);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rendering puts the reader’s own link in, everywhere', () => {
  it('substitutes in both bodies', () => {
    const rendered = renderTemplate(template, LINK);
    expect(rendered.html).toContain(`href="${LINK}"`);
    expect(rendered.text).toContain(LINK);
    expect(rendered.html).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(rendered.text).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
  });

  it('substitutes every occurrence, not the first', () => {
    const twice: EmailTemplate = {
      ...template,
      html: `<a href="${UNSUBSCRIBE_PLACEHOLDER}">out</a> or <a href="${UNSUBSCRIBE_PLACEHOLDER}">out</a>`,
    };
    const rendered = renderTemplate(twice, LINK);
    expect(rendered.html.split(LINK).length - 1).toBe(2);
    expect(rendered.html).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
  });

  it('refuses to render a placeholder it does not fill', () => {
    const stray: EmailTemplate = { ...template, subject: 'Hello {{first_name}}' };
    expect(() => renderTemplate(stray, LINK)).toThrow(/subject/);
  });

  it('refuses to render without a link', () => {
    expect(() => renderTemplate(template, '  ')).toThrow();
  });
});

describe('the dry run renders and sends nothing', () => {
  it('returns the substituted HTML and never reaches the network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('the dry run must not call the provider');
    });

    const outcome = await sendTemplatedEmail({
      template,
      to: 'someone@example.com',
      unsubscribeUrl: LINK,
      headers: listUnsubscribeHeaders(LINK),
      dryRun: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('dry-run');
    if (outcome.kind !== 'dry-run') return;
    expect(outcome.to).toBe('someone@example.com');
    expect(outcome.subject).toBe(template.subject);
    expect(outcome.html).toContain(`href="${LINK}"`);
    expect(outcome.html).not.toContain(UNSUBSCRIBE_PLACEHOLDER);
    expect(outcome.text).toContain(LINK);
  });

  it('needs no provider key, which is what makes it runnable by anyone', async () => {
    const outcome = await sendTemplatedEmail({
      template,
      to: 'someone@example.com',
      unsubscribeUrl: LINK,
      headers: listUnsubscribeHeaders(LINK),
      dryRun: true,
    });
    expect(outcome.kind).toBe('dry-run');
  });
});

describe('a real send is one documented request', () => {
  function accept(body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  }

  it('posts to the documented endpoint with the sender the programme names', async () => {
    const fetchImpl = accept({ id: 'msg_123' });

    const outcome = await sendTemplatedEmail({
      template,
      to: 'someone@example.com',
      unsubscribeUrl: LINK,
      headers: listUnsubscribeHeaders(LINK),
      dryRun: false,
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(RESEND_ENDPOINT);
    expect(call[1].method).toBe('POST');

    const sentBody = JSON.parse(String(call[1].body)) as Record<string, unknown>;
    expect(sentBody['from']).toBe(WEIR_FROM);
    expect(sentBody['reply_to']).toBe(WEIR_REPLY_TO);
    expect(sentBody['to']).toEqual(['someone@example.com']);
    expect(String(sentBody['html'])).toContain(LINK);
    expect(String(sentBody['text'])).toContain(LINK);
    expect(sentBody['headers']).toEqual(listUnsubscribeHeaders(LINK));

    expect(outcome.kind).toBe('sent');
    if (outcome.kind !== 'sent') return;
    expect(outcome.providerMessageId).toBe('msg_123');
  });

  it('does not put the key anywhere but the request it authorises', async () => {
    const fetchImpl = accept({ id: 'msg_123' });
    const outcome = await sendTemplatedEmail({
      template,
      to: 'someone@example.com',
      unsubscribeUrl: LINK,
      headers: listUnsubscribeHeaders(LINK),
      dryRun: false,
      apiKey: 'a-secret-value',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(JSON.stringify(outcome)).not.toContain('a-secret-value');
  });

  it('reports a refusal by status rather than by the provider’s words', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"domain is not verified"}', {
      status: 403,
    }));

    const outcome = await sendTemplatedEmail({
      template,
      to: 'someone@example.com',
      unsubscribeUrl: LINK,
      headers: listUnsubscribeHeaders(LINK),
      dryRun: false,
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;
    expect(outcome.status).toBe(403);
    expect(JSON.stringify(outcome)).not.toContain('domain is not verified');
  });

  it('throws rather than returning a send it cannot name', async () => {
    /*
      Accepted, with no id. The message may well have gone, and the one thing that must not happen
      is a caller writing it down as a clean send it can later distinguish from a duplicate.
    */
    const fetchImpl = accept({});
    await expect(
      sendTemplatedEmail({
        template,
        to: 'someone@example.com',
        unsubscribeUrl: LINK,
        headers: listUnsubscribeHeaders(LINK),
        dryRun: false,
        apiKey: 'test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/without an id/);
  });

  it('refuses to send with no key, naming the variable and not a value', () => {
    for (const value of [undefined, '', '  ']) {
      expect(() => requireResendKey(value)).toThrow(new RegExp(RESEND_KEY_VAR));
    }
    expect(requireResendKey(' k ')).toBe('k');
  });
});
