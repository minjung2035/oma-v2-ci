// Deliberate boundary violations only. Normal factories never accept allowInvalid flags.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { writeFileSync } from "node:fs";

/** Caller must close the normal Store first; never mutate behind an active production connection. */
export function mutateRawRowAfterClose(path: string, mutate: (raw: DatabaseSync) => void): void {
  const raw = new DatabaseSync(path);
  try { mutate(raw); } finally { raw.close(); }
}

export function corruptOperationForTest(
  databasePath: string, id: string,
  field: "plan_json" | "payload_json" | "request_hash" | "result_json" | "error_code" | "state",
  value: SQLInputValue,
): void {
  mutateRawRowAfterClose(databasePath, raw => {
    const changed = raw.prepare(`UPDATE operations SET ${field}=? WHERE id=?`).run(value, id);
    if (Number(changed.changes) !== 1) throw new Error("corruption fixture must mutate exactly one existing operation");
  });
}

/** Type escape is localized here, never part of a normal fixture's input API. */
export function corruptValueForTest<T>(valid: T, field: string, value: unknown): T {
  if (valid === null || typeof valid !== "object" || Array.isArray(valid)) throw new Error("corruption requires a valid object control");
  return { ...valid, [field]: value } as T;
}

export function replaceArtifactBytes(path: string, bytes: string | Uint8Array): void {
  writeFileSync(path, bytes);
}
