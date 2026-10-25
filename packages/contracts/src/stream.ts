export interface StreamSink {
  /** Takes the next bytes. May throw; the receive then fails. */
  write(chunk: Buffer): void;
  /** All bytes arrived and hashed as declared: make them durable. */
  complete(): void;
  /** The receive failed: leave nothing behind. Must not throw. */
  abandon(): void;
}

export interface Declared { readonly bytes: number; readonly sha256: string }

