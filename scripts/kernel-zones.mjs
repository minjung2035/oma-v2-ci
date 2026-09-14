/** P13 semantic ownership, reviewed independently of directory names.
 * Exact membership: a new kernel file needs an ownership decision, not a prefix exemption.
 * Runtime DAG: K3 ledger -> K2 mechanisms -> K1 representations -> K0 values.
 * Same-zone runtime SCCs are still forbidden by the project cycle gate.
 */
import { layerOf } from "./dependency-lattice.mjs";

export const KERNEL_ZONES = Object.freeze([
  {
    name: "K0-values",
    files: [
      "src/domain/admission.ts",
      "src/domain/canonical-json.ts",
      "src/domain/capabilities.ts",
      "src/domain/child-policy.ts",
      "src/domain/context-policy.ts",
      "src/domain/deployment.ts",
      "src/domain/derived.ts",
      "src/domain/errors.ts",
      "src/domain/exhaustive.ts",
      "src/domain/identifiers.ts",
      "src/domain/integer-fields.ts",
      "src/domain/limits.ts",
      "src/domain/lineage.ts",
      "src/domain/mail-values.ts",
      "src/domain/request-identity.ts",
      "src/domain/resources.ts",
      "src/domain/spec-identity.ts",
      "src/domain/usage-budget.ts",
      "src/hash.ts",
      "src/process/command.ts",
      "src/storage/paths.ts",
    ],
  },
  {
    name: "K1-codecs",
    files: [
      "src/cli/cache-codec.ts",
      "src/domain/persisted-formats.ts",
      "src/durable.ts",
      "src/frame.ts",
      "src/mail/addresses.ts",
      "src/mail/facts.ts",
      "src/mail/headers.ts",
      "src/validate.ts",
      "src/protocol/batch-view.ts",
      "src/protocol/byte-queue.ts",
      "src/protocol/jsonl.ts",
      "src/protocol/methods.ts",
      "src/protocol/operation-results.ts",
      "src/protocol/receipt-codec.ts",
      "src/protocol/receipts.ts",
      "src/protocol/request-codec.ts",
      "src/protocol/response-codec.ts",
      "src/protocol/run-lease.ts",
    ],
  },
  {
    name: "K2-mechanisms",
    files: [
      "src/config.ts",
      "src/config/policy.ts",
      "src/ids.ts",
      "src/leaf.ts",
      "src/process/async.ts",
      "src/process/policies.ts",
      "src/process/preparation.ts",
      "src/process/run.ts",
      "src/protocol/channel.ts",
      "src/storage/batch-view.ts",
      "src/storage/context-files.ts",
      "src/storage/context-snapshot.ts",
      "src/storage/context-stream.ts",
      "src/storage/directory.ts",
      "src/storage/durable-fs.ts",
      "src/storage/immutable-file.ts",
      "src/storage/staged-tree.ts",
      "src/storage/submit-spool.ts",
    ],
  },
  {
    name: "K3-ledger",
    files: [
      "src/module-ports.ts",
      "src/store.ts",
      "src/storage/diagnostic-snapshot.ts",
      "src/storage/facets.ts",
      "src/storage/ledger-reader.ts",
      "src/storage/operation-codec.ts",
      "src/storage/operation-journal.ts",
      "src/storage/operation-transitions.ts",
      "src/storage/rows.ts",
      "src/storage/transaction.ts",
      "src/storage/transitions.ts",
    ],
  },
]);

export function kernelZoneOf(file, zones = KERNEL_ZONES) {
  const matches = zones.flatMap((zone, index) =>
    zone.files.includes(file) ? [{ name: zone.name, index }] : [],
  );
  return matches.length === 1 ? matches[0] : null;
}

export function kernelFindings(graph, zones = KERNEL_ZONES) {
  const findings = [];
  for (const file of graph.files) {
    if (layerOf(file)?.name === "L1-kernel" && !kernelZoneOf(file, zones))
      findings.push({
        rule: "kernel-zone-unclassified",
        file,
        reason: `${file} must belong to exactly one semantic kernel zone`,
      });
  }
  for (const edge of graph.edges) {
    if (!edge.included || edge.kind !== "runtime") continue;
    const from = kernelZoneOf(edge.from, zones),
      to = kernelZoneOf(edge.to, zones);
    if (from && to && from.index < to.index)
      findings.push({
        rule: "kernel-dependency",
        file: edge.from,
        reason: `${edge.from} (${from.name}) -> ${edge.to} (${to.name}) imports a higher semantic owner`,
      });
  }
  return findings;
}

// Pure native algorithms only, never blanket permission for a Node module in all codecs.
const PURE_NATIVE_IMPORTS = Object.freeze({
  "src/domain/canonical-json.ts": ["node:crypto"],
  "src/domain/derived.ts": ["node:crypto"],
  "src/domain/spec-identity.ts": ["node:crypto"],
  "src/storage/paths.ts": ["node:path"],
  "src/durable.ts": ["node:path"],
  "src/protocol/run-lease.ts": ["node:path"],
  "src/frame.ts": ["node:util"],
});
export function kernelExternalViolation(file, specifier, importedNames = []) {
  const zone = kernelZoneOf(file);
  if (!zone || zone.index > 1) return false;
  if (!PURE_NATIVE_IMPORTS[file]?.includes(specifier)) return true;
  // Hashing is deterministic; randomUUID/randomBytes/key generation are mechanisms.
  return (
    specifier === "node:crypto" &&
    (importedNames.length === 0 ||
      importedNames.some((name) => name !== "createHash"))
  );
}

export function kernelEvidence(graph, cycles) {
  const matrices = { runtime: {}, type: {} },
    crossZoneEdges = [];
  for (const edge of graph.edges) {
    if (!edge.included) continue;
    const from = kernelZoneOf(edge.from),
      to = kernelZoneOf(edge.to);
    if (!from || !to) continue;
    const key = `${from.name} -> ${to.name}`;
    matrices[edge.kind][key] = (matrices[edge.kind][key] ?? 0) + 1;
    if (from.index !== to.index)
      crossZoneEdges.push({ from: edge.from, to: edge.to, kind: edge.kind });
  }
  const sorted = (table) =>
    Object.fromEntries(
      Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  return {
    zones: KERNEL_ZONES.map((zone) => ({
      name: zone.name,
      files: graph.files.filter((file) => zone.files.includes(file)),
    })),
    runtimeEdgeMatrix: sorted(matrices.runtime),
    typeOnlyEdgeMatrix: sorted(matrices.type),
    crossZoneEdges,
    runtimeCycles: cycles.runtime.filter((group) =>
      group.some((file) => kernelZoneOf(file)),
    ),
    unionCycles: cycles.union.filter((group) =>
      group.some((file) => kernelZoneOf(file)),
    ),
  };
}
