// IPC-002/003: a cursor over caller-owned chunks; frame-sized copies only.
export class ByteQueue {
  private chunks: Buffer[] = [];
  private head = 0;
  private count = 0;
  get length(): number { return this.count; }
  append(chunk: Buffer): void { if (chunk.length) { this.chunks.push(chunk); this.count += chunk.length; } }
  clear(): void { this.chunks = []; this.head = 0; this.count = 0; }
  private compact(): void {
    if (this.count === 0) this.clear();
    else if (this.head >= 128 && this.head * 2 >= this.chunks.length) { this.chunks = this.chunks.slice(this.head); this.head = 0; }
  }
  shift(maximum: number): Buffer {
    if (!Number.isSafeInteger(maximum) || maximum < 0) throw new RangeError("invalid byte queue read");
    if (this.count === 0 || maximum === 0) return Buffer.alloc(0);
    const first = this.chunks[this.head]!;
    const count = Math.min(first.length, maximum);
    const value = first.subarray(0, count);
    if (count === first.length) this.head++; else this.chunks[this.head] = first.subarray(count);
    this.count -= count; this.compact();
    return value;
  }
  peek(count: number): Buffer {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.count) throw new RangeError("invalid byte queue peek");
    const value = Buffer.allocUnsafe(count);
    let offset = 0;
    for (let index = this.head; offset < count; index++) {
      const chunk = this.chunks[index]!;
      const take = Math.min(chunk.length, count - offset);
      chunk.copy(value, offset, 0, take); offset += take;
    }
    return value;
  }
  take(count: number): Buffer {
    const value = this.peek(count);
    let remaining = count;
    while (remaining > 0) remaining -= this.shift(remaining).length;
    return value;
  }
  uint32BE(): number {
    if (this.count < 4) throw new RangeError("incomplete frame header");
    const first = this.chunks[this.head]!;
    return first.length >= 4 ? first.readUInt32BE(0) : this.peek(4).readUInt32BE(0);
  }
  /** Do not retain a huge raw-body backing allocation for a tiny next-frame tail. */
  ownRemainder(maxRetainedBytes: number): void {
    if (this.count === 0) return;
    if (this.count > maxRetainedBytes) throw new RangeError("byte queue exceeds its retained budget");
    if (this.chunks.slice(this.head).some(chunk => chunk.buffer.byteLength > maxRetainedBytes)) {
      const value = this.peek(this.count);
      this.chunks = [value]; this.head = 0;
    }
  }
}
