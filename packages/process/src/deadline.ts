import { performance } from "node:perf_hooks";

/** A cancellable monotonic timer. Long deadlines are rearmed within Node's
 * timer range; callbacks always run after the caller receives its canceller. */
export function deadline(ms: number | null, callback: () => void): () => void {
  if (ms === null) return () => {};
  if (!Number.isFinite(ms) || ms <= 0) throw new RangeError("invalid deadline");
  const end = performance.now() + ms;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const arm = (): void => {
    if (cancelled) return;
    const left = end - performance.now();
    if (left <= 0) { cancelled = true; callback(); return; }
    timer = setTimeout(arm, Math.max(1, Math.min(0x7fffffff, Math.ceil(left))));
  };
  timer = setTimeout(arm, Math.max(1, Math.min(0x7fffffff, Math.ceil(ms))));
  return () => { cancelled = true; clearTimeout(timer); };
}
