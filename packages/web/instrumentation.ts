// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/*
  Every server failure in this product ends as a console.error — that is the one convention the whole
  codebase already follows, including the shared opaque helper. Capturing here means capture costs no
  import edge: nothing in the browser graph can reach the recorder, and no route needed editing.

  Two guards that matter: only the node runtime (the edge runtime has no database client), and only
  when a database is configured, so a local build without one stays silent.
*/
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  if ((process.env['PROJECTX_DATABASE_URL'] ?? '') === '') return;

  const original = console.error.bind(console);
  let recording = false;

  console.error = (...args: unknown[]): void => {
    original(...args);
    if (recording) return;

    recording = true;
    const detail = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")
      .slice(0, 4000);

    void import("./lib/error-log")
      .then((m) => m.recordFailure({ source: "console.error", detail }))
      .catch(() => undefined)
      .finally(() => {
        recording = false;
      });
  };
}

/*
  The second hole, and the one the per-route try/catch sweep cannot close: an error thrown before a
  route handler is entered, or from React while a server component streams, never passes through any
  handler's catch. Next calls this hook for exactly those, once per failed request.

  The route is recorded as its path template (`/api/posts/[id]`) rather than the concrete URL, so a
  thousand hits on a thousand ids aggregate into one row instead of a thousand.
*/
export async function onRequestError(
  error: unknown,
  request: Readonly<{ path: string; method: string }>,
  context: Readonly<{ routePath: string; routerKind: string; routeType: string }>,
): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  if ((process.env['PROJECTX_DATABASE_URL'] ?? '') === '') return;

  const detail = error instanceof Error ? error.message : String(error);
  const route = context.routePath || request.path;

  /*
    No console line here: register() has already replaced the console with a recorder, so writing one
    would store the same failure twice. recordFailure logs to the console itself when the database
    write fails, which is the fallback this needs.
  */
  try {
    const m = await import("./lib/error-log");
    await m.recordFailure({
      source: `uncaught ${context.routerKind} ${context.routeType}`,
      detail,
      route,
    });
  } catch {
    // Recording must never become a second failure.
  }
}
