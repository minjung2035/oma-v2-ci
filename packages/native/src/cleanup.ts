/** P0-4: an owned cleanup runs once, after the effect ends. A second failure
 * is retained beside the first, never substituted for it (primaryFailure). */
export function withCleanup<T>(run: () => T, cleanup: () => void): T {
  let failed = false, primary: unknown;
  try { return run(); }
  catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { cleanup(); }
    catch (error) {
      if (failed) throw new AggregateError([primary, error], "Owned effect and cleanup failed");
      throw error;
    }
  }
}

/** Return every registered owner once, even when an earlier return fails. */
export function cleanupAll(cleanups: readonly (() => void)[]): void {
  const failures: unknown[] = [];
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Owned cleanups failed");
}

/** The asynchronous effect must settle before its owner is returned. */
export async function withAsyncCleanup<T>(run: () => Promise<T>, cleanup: () => void | Promise<void>): Promise<T> {
  let failed = false, primary: unknown;
  try { return await run(); }
  catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { await cleanup(); }
    catch (error) {
      if (failed) throw new AggregateError([primary, error], "Owned effect and cleanup failed");
      throw error;
    }
  }
}
