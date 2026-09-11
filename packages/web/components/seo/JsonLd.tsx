// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * One `<script type="application/ld+json">`, escaped the way Next.js escapes its own.
 *
 * `JSON.stringify` does not escape `<`, so a value containing the literal string `</script>`
 * would close the tag early and let whatever followed it run as markup rather than sit inert as
 * data. None of the values this repo feeds in today contain that sequence — they are constants and
 * facts already published elsewhere on the site — but the component does not get to assume that
 * stays true forever, so the escape happens here once rather than at every call site that remembers
 * to add it.
 */
function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** A single JSON-LD document, rendered inert until a search engine or agent parses it as data. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    // eslint-disable-next-line react/no-danger -- the only way to emit a script tag's raw text content.
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }} />
  );
}
