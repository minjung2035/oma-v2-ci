/** Independent physical observations, not production decision/planning helpers.
 * Only explicitly named files/DBs owned by the test are observed. Failures throw:
 * an unavailable observation must never be turned into an absent artifact. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function observeFile(path: string) {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile()) throw new Error(`expected regular fixture file: ${path}`);
  const bytes = readFileSync(path);
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    links: String(stat.nlink),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mode: Number(stat.mode & 0o777n),
  };
}

/** Read committed relations through a separate, read-only SQLite connection.
 * Return actual SQL rows, not Store projections or expected production plans. */
export function observeLedger(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      agents: db
        .prepare("SELECT name, incarnation, desired FROM agents ORDER BY name")
        .all(),
      operations: db
        .prepare(
          "SELECT id, actor, request_key, state, plan_json FROM operations ORDER BY id",
        )
        .all(),
      batches: db
        .prepare(
          "SELECT id, agent, incarnation, message_ids_json, state, session_path FROM batches ORDER BY id",
        )
        .all(),
      deliveries: db
        .prepare(
          "SELECT message_id, recipient, operation_id, materialized, batch_id, presented, acknowledged FROM deliveries ORDER BY message_id, recipient",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}
