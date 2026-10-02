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
