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
