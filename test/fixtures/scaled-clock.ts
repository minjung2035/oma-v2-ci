import { performance } from "node:perf_hooks";
import type { TestContext } from "node:test";

/** Test-only monotonic time. Startup stays real; start() accelerates the
 * synthetic protocol's delays and its watchdogs together. Child lifetime and
 * filesystem effects still have to finish. Never loaded by product code. */
export function scaledClock(t: TestContext, factor: number) {
  const realNow = performance.now.bind(performance);
  const schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout;
  const wall = Date.now(), initial = realNow();
  let anchor = initial, elapsed = initial, rate = 1;
  const now = () => elapsed + (realNow() - anchor) * rate;
  const pending = new Set<Entry>();
  type Entry = { at: number; callback: () => void; native?: ReturnType<typeof setTimeout>;
    referenced: boolean; ref(): Entry; unref(): Entry; hasRef(): boolean };
  const arm = (entry: Entry) => {
    if (entry.native) cancel(entry.native);
    entry.native = schedule(() => { pending.delete(entry); entry.callback(); }, Math.max(0, entry.at - now()) / rate);
    if (!entry.referenced) entry.native.unref();
  };
  const timerMock = t.mock.method(globalThis, "setTimeout", (callback: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const entry: Entry = { at: now() + ms, callback: () => callback(...args), referenced: true,
      ref() { this.referenced = true; this.native?.ref(); return this; },
      unref() { this.referenced = false; this.native?.unref(); return this; },
      hasRef() { return this.referenced; } };
    pending.add(entry); arm(entry);
    return entry as unknown as ReturnType<typeof setTimeout>;
  });
  const cancelMock = t.mock.method(globalThis, "clearTimeout", (handle: ReturnType<typeof setTimeout> | undefined) => {
    const entry = handle as unknown as Entry;
    if (pending.delete(entry)) cancel(entry.native);
    else cancel(handle);
  });
  const nowMock = t.mock.method(performance, "now", now);
  const dateMock = t.mock.method(Date, "now", () => wall + now() - initial);
  return {
    start() {
      if (rate !== 1) return;
      elapsed = now(); anchor = realNow(); rate = factor;
      for (const entry of pending) arm(entry);
    },
    restore() {
      for (const entry of pending) cancel(entry.native);
      pending.clear();
      timerMock.mock.restore(); cancelMock.mock.restore(); nowMock.mock.restore(); dateMock.mock.restore();
    },
  };
}
