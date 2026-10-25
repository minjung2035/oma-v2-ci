// R01: run the synchronous ancestry walk in a child so a cycle cannot hang the suite.
// This checks lineage integrity; no unit or broker is involved.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { LineageSnapshot } from "@oma/domain/lineage";
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
  // The ancestry walk must terminate or reject the corrupt graph.
  const graph = new LineageSnapshot(store.listAgents()
    .map(agent => ({ name: agent.name, createdBy: agent.createdBy, role: agent.role })));
  graph.ancestors("c");
  process.stdout.write("OK\n");
} catch (error) {
  if (!(error instanceof StoreError) || error.code !== "STORE_CORRUPT") throw error;
  process.stdout.write("STORE_CORRUPT\n");
  process.exitCode = 42;
} finally { store.close(); }
