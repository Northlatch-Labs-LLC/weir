// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
 * An earlier draft of this note cited `agent/src/seal-node.ts` as precedent for going slowly. It is
 * not. That file sequences a Walrus read before a key-server request because the first is "public,
 * free and unmetered" and the second "carries an API key and is rate-limited", so a blob with an
 * expired lease is discovered before a metered request is spent — `Promise.all` "would spend the
 * request anyway". That is about not paying for something you may not need. It is correct about its
 * own subject and says nothing about this one, and the citation is left here as a correction rather
 * than removed, because it is the third time in this audit that a true statement about one thing
 * has been read as covering its neighbour.
 *
 * # WHAT THIS DOES NOT BOUND, and it is the more important half
 *
 * Eight is eight PER CALL. Ten simultaneous renders of the same page is eighty requests in flight,
 * and nothing in the request path knows that — this helper bounds a loop, not an endpoint. The
 * fullnode it is being polite to is a PUBLIC one this deployment does not operate and cannot raise,
 * and the estate's own capacity work already names it as the binding constraint on active users.
 *
 * So a reader who finds a bounded helper here and concludes the endpoint is protected has made
 * exactly the mistake this audit found on `/explore` itself: a guard that answers yes to the
 * obvious question while bounding the wrong thing. Bounding total in-flight fullnode calls across
 * renders is separate work, and it belongs beside the durable per-caller ceiling rather than inside
 * a concurrency helper.
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
  /*
    A non-finite limit REFUSES rather than doing nothing.

    Without this, `NaN` produced `Array.from({length: NaN})`, which is empty — so no worker was
    started, `Promise.all([])` resolved immediately, and the function returned an array of holes
    with `fn` never called once. No throw, no rejection, no signal. A caller zipping that back
    against its input attributes empty data to every row: "a failed read is never a value", with
    the failure arriving through the parameter instead of through the work.

    Not reachable from this codebase today, because the only caller passes a constant. It is
    reachable from the next one — this is a shared helper precisely so the bound is not reinvented,
    and the next caller is the one who writes `Number(process.env.SOMETHING)` and gets `NaN` from a
    typo or an unset variable. Refusing is the same decision as not catching a rejection below: a
    programming error should not become a silent `undefined` in the middle of an array.

    An out-of-range but finite limit is clamped rather than refused. Zero and negative numbers are
    a caller asking for less than one at a time, which has an obvious correct answer; `NaN` is a
    caller who does not know what they asked for, which does not.
  */
  if (!Number.isFinite(limit)) {
    throw new RangeError(`mapWithLimit needs a finite limit, got ${String(limit)}`);
  }

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
