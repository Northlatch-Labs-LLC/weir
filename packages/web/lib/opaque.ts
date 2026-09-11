// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export function opaqueDetail(source: string, error: unknown): string {
  const real = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ failure: source, detail: real }));
  return `${source} failed. The reason is in this deployment's logs, not in this response.`;
}
