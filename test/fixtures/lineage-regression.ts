// R01: run the synchronous ancestry walk in a child so a cycle cannot hang the suite.
// This is a lifecycle quota boundary test, not a kernel or broker E2E test.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { Store, StoreError } from "../../src/store.js";
import { assertCreateCapacity, LineageSnapshot } from "../../src/domain/lineage.js";
import { makeValidAgent } from "./spec.js";

const root = process.argv[2];
if (!root) throw new Error("temporary root required");
const path = join(root, "runtime.sqlite");
const store = new Store(path);
try {
  store.transaction(() => {
    for (const name of ["principal", "a", "b", "c"]) {
      store.insertAgent(makeValidAgent(name, { createdBy: name === "principal" ? null : "principal" }));
    }
  });
  if (process.argv[3] === "cycle") {
    const raw = new DatabaseSync(path);
    try {
      raw.prepare("UPDATE agents SET created_by=? WHERE name=?").run("b", "a");
      raw.prepare("UPDATE agents SET created_by=? WHERE name=?").run("a", "b");
    } finally { raw.close(); }
  }
  // No unit operation is involved in this pure quota walk.
  const graph = new LineageSnapshot(store.listAgents()
    .map(agent => ({ name: agent.name, createdBy: agent.createdBy, role: agent.role })));
  assertCreateCapacity(graph, "c", { societyAgents: 10, lineageAgents: 10 });
  process.stdout.write("OK\n");
} catch (error) {
  if (!(error instanceof StoreError) || error.code !== "STORE_CORRUPT") throw error;
  process.stdout.write("STORE_CORRUPT\n");
  process.exitCode = 42;
} finally { store.close(); }
