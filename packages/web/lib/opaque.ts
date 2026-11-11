// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

/*
  Every opaque failure in the product passes through here. It used to write a console line and stop,
  which is why an outage was invisible: the reason existed in a log nobody was reading, and nowhere
  else. It now also records the failure, without ever making the log the reason a request fails.
*/
export function opaqueDetail(source: string, error: unknown, route?: string): string {
  const real = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ failure: source, detail: real }));
  /*
    Dynamic, not static. error-log carries `server-only`, and a static import put that guard into the
    import graph of every module that imports this one — which broke the agent package tests that
    resolve the same helper outside a server component.
  */
  void import('./error-log')
    .then((m) => m.recordFailure({ source, detail: real, ...(route === undefined ? {} : { route }) }))
    .catch(() => undefined);
  return `${source} failed. The reason is in this deployment's logs, not in this response.`;
}
