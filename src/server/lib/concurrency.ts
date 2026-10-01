/**
 * Worker-pool map: runs `fn` over `items` with at most `limit` in flight,
 * preserving result order. A rejection from `fn` propagates after in-flight
 * workers settle (no dangling writes continue past the caller's await).
 *
 * `stop` (optional) is a cooperative flag: once `stop.stopped` is true no NEW
 * item starts; items already in flight finish normally and their results are
 * kept. Skipped slots stay `undefined` — callers that use `stop` must treat
 * the result array as sparse.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  stop?: { stopped: boolean },
): Promise<Array<R | undefined>> {
  const results = Array.from<R | undefined>({ length: items.length });
  let next = 0;
  let firstError: unknown;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        if (stop?.stopped || firstError !== undefined) return;
        const index = next;
        next += 1;
        if (index >= items.length) return;
        try {
          results[index] = await fn(items[index], index);
        } catch (error) {
          firstError ??= error;
          return;
        }
      }
    }),
  );
  if (firstError !== undefined) throw firstError;
  return results;
}
