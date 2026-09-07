// MUST [FS-003]/[IPC-006]: CLI preaccept cache under <home>/.local/state/oma/requests.
// Model-mutable; the broker always revalidates. Contains only the frozen
// request, body/bundle digest, and the last receipt. Not a queue or replay engine.
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import type { Json, Receipt, RequestKey } from "../implementation/contracts.js";

export interface CachedRequest {
  key: RequestKey;
  method: string;
  /** frozen normalized payload (immutable after first freeze) */
  params: Json;
  /** stream digest when the request carries bytes, else absent */
  digest?: { bytes: number; sha256: string };
  createdAtMs: number;
  lastReceipt: Receipt | null;
}

export class RequestCache {
  constructor(readonly homeDir: string) {}

  private dir(): string {
    return join(this.homeDir, ".local", "state", "oma", "requests");
  }

  private path(key: RequestKey): string {
    return join(this.dir(), `${key}.json`);
  }

  read(key: RequestKey): CachedRequest | null {
    const p = this.path(key);
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Record<
        string,
        unknown
      >;
      if (typeof raw.key !== "string" || raw.key !== key) return null;
      if (
        typeof raw.method !== "string" ||
        typeof raw.params !== "object" ||
        raw.params === null
      )
        return null;
      if (typeof raw.createdAtMs !== "number") return null;
      const digest =
        typeof raw.digest === "object" && raw.digest !== null
          ? {
              bytes: (raw.digest as Record<string, unknown>).bytes as number,
              sha256: (raw.digest as Record<string, unknown>).sha256 as string,
            }
          : undefined;
      const base: CachedRequest = {
        key,
        method: raw.method,
        params: raw.params as Json,
        createdAtMs: raw.createdAtMs as number,
        lastReceipt: raw.lastReceipt as Receipt | null,
      };
      if (digest) base.digest = digest;
      return base;
    } catch {
      return null;
    }
  }

  /** Atomic write: tmp + fsync + rename (FS-003; model-mutable so checksum is on the broker). */
  write(entry: CachedRequest): void {
    const dir = this.dir();
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${entry.key}.tmp`);
    writeFileSync(tmp, JSON.stringify(entry), "utf8");
    renameSync(tmp, this.path(entry.key));
  }
}
