// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving input order in the result.
 *
 * # Why bounded rather than `Promise.all`
 *
 * The work these callers do is a request to a shared, rate-limited fullnode. `Promise.all` over
 * twenty creators is twenty simultaneous requests, which is not obviously better than twenty
 * sequential ones: it trades a slow page for a burst against an endpoint this deployment shares
 * with everybody else on it, and the failure it buys is a throttle rather than a wait.
 *
 * `packages/daemon` reaches the same conclusion from the other side — `agent/src/seal-node.ts`
 * chose sequential over `Promise.all` deliberately — so the choice here is a middle value rather
 * than a reversal: enough concurrency that a page is not the sum of its round trips, few enough
 * that one render is not a burst.
 *
 * # Order is preserved, and that is load-bearing
 *
 * Callers zip these results back against the list they passed in. Returning them in completion
 * order would silently attribute one creator's figures to another, which is the kind of defect that
 * looks like a data problem for a week.
 *
 * # A rejection is not caught here
 *
 * Deliberately. Callers of this in the codebase pass functions that already return a `Reading` and
 * cannot reject; a swallow here would turn a real programming error into a silent `undefined` in
 * the middle of an array, which is worse than the throw.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const width = Math.max(1, Math.min(Math.floor(limit), items.length));
  const out = new Array<R>(items.length);
  let next = 0;

  /*
    Workers pull from a shared cursor rather than being handed a slice each. A slice would make the
    whole batch wait on whichever worker drew the slowest items, which is the behaviour this exists
    to remove.
  */
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
  return out;
}
