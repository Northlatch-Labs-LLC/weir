// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

/**
 * The text of an internal failure, kept out of the response and put in the log.
 *
 * # What was leaking
 *
 * Twenty-four of twenty-five routes return `failure.detail` verbatim to the caller, which is right
 * for the details this codebase writes — "that is not a Sui address", "this signature has expired —
 * sign again" — and wrong for the ones a library writes. A `pg` exception names tables, columns and
 * constraints; a driver exception names hosts and ports; a crypto library names its own internals.
 * All of it reached anonymous callers, on routes that need no account, and it is a free map of the
 * schema and the topology to anybody probing.
 *
 * # Why this is at the source rather than at the exit
 *
 * The exit is twenty-four route handlers and every one added after them. Filtering there means
 * remembering, and the next route is written by somebody who has not read this note. Here, there
 * is nothing to remember: a `Reading` built from a caught error carries a sentence written by us,
 * so a handler that returns `failure.detail` is safe by construction rather than by discipline.
 *
 * # Nothing is lost
 *
 * The real message goes to stderr with its source, which is where an operator looks and where a
 * caller cannot. The two audiences want different things and had been given the same string: the
 * caller needs to know whether to retry, and the operator needs to know what broke.
 */
export function opaqueDetail(source: string, error: unknown): string {
  const real = error instanceof Error ? error.message : String(error);
  /*
    One line, structured, so it can be found. Not `console.log`: this is a failure, and stdout in a
    serverless runtime is where informational noise goes.
  */
  console.error(JSON.stringify({ failure: source, detail: real }));
  return `${source} failed. The reason is in this deployment's logs, not in this response.`;
}
