// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    // eslint-disable-next-line react/no-danger -- the only way to emit a script tag's raw text content.
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }} />
  );
}
