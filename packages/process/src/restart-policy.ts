/** Memory-only restart window. It carries no run authority or death proof. */
export class RestartPolicy {
  private readonly starts: number[] = [];
  constructor(private readonly maximum = 5, private readonly windowMs = 60_000,
    private readonly now: () => number = () => performance.now()) {
    if (!Number.isSafeInteger(maximum) || maximum < 0 || !Number.isFinite(windowMs) || windowMs <= 0)
      throw new TypeError("invalid restart policy");
  }
  next(): { readonly kind: "restart"; readonly delayMs: number } | { readonly kind: "exhausted"; readonly count: number } {
    const now = this.now();
    while (this.starts.length > 0 && now - this.starts[0]! > this.windowMs) this.starts.shift();
    if (this.starts.length >= this.maximum) return { kind: "exhausted", count: this.starts.length };
    this.starts.push(now);
    return { kind: "restart", delayMs: Math.min(250 * 2 ** (this.starts.length - 1), 8000) };
  }
}
