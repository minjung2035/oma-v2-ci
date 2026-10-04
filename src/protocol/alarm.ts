/** WP10.02/B5: the one deadline primitive. Measured on the monotonic clock
 * and re-armed in native-sized steps, so a budget longer than the platform
 * timer limit neither fires early nor overflows. Cancel is final; `unref`
 * keeps the wait from holding the process open. */
import { performance } from "node:perf_hooks";

export interface Timer {
  cancel(): void;
}

export function alarm(seconds: number, action: () => void, unref = false): Timer {
  const deadline = performance.now() + seconds * 1000;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = (): void => {
    if (!active) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      active = false;
      action();
      return;
    }
    timer = setTimeout(tick, Math.max(1, Math.min(0x7fffffff, remaining)));
    if (unref) timer.unref();
  };
  tick();
  return {
    cancel() {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
