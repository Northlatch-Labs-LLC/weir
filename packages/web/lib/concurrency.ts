// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isFinite(limit)) {
    throw new RangeError(`mapWithLimit needs a finite limit, got ${String(limit)}`);
  }

  if (items.length === 0) return [];

  const width = Math.max(1, Math.min(Math.floor(limit), items.length));
  const out = new Array<R>(items.length);
  let next = 0;

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
