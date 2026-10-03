/** P13 semantic ownership, reviewed independently of directory names.
 * Exact membership: a new kernel file needs an ownership decision, not a prefix exemption.
 * Runtime DAG: K3 ledger -> K2 mechanisms -> K1 representations -> K0 values.
 * Same-zone runtime SCCs are still forbidden by the project cycle gate.
 */
import { layerOf, isInternalPort } from "./dependency-lattice.mjs";

export const KERNEL_ZONES = Object.freeze([
  {
    name: "K0-values",
    files: [
      "src/client/errors.ts",
      "src/client/limits.ts",
      "src/cli/request-intent.ts",
      "src/domain/admission.ts",
      "src/domain/attestation-relations.ts",
      "src/domain/canonical-json.ts",
      "src/config/defaults.ts",
      "src/config/role-prompts.ts",
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
      "src/domain/review-evaluation.ts",
      "src/domain/session-mode.ts",
      "src/domain/spec-identity.ts",
      "src/domain/tier-evaluation.ts",
      "src/domain/tool-surface.ts",
      "src/domain/usage-budget.ts",
      "src/domain/utf8.ts",
      "src/domain/unseen-text.ts",
      "src/hash.ts",
      "src/process/command.ts",
      "src/process/host-loss.ts",
      "src/resident-paths.ts",
      "src/storage/paths.ts",
    ],
  },
  {
    name: "K1-codecs",
    files: [
      "src/client/codecs.ts",
      "src/cli/cache-codec.ts",
      "src/domain/attestation.ts",
      "src/domain/integration-policy.ts",
      "src/domain/persisted-formats.ts",
      "src/domain/tier-snapshot.ts",
      "src/durable.ts",
      "src/frame.ts",
      "src/mail/addresses.ts",
      "src/mail/facts.ts",
      "src/mail/headers.ts",
      "src/mail/review-bounds.ts",
      "src/validate.ts",
      "src/protocol/batch-view.ts",
      "src/protocol/status-view.ts",
      "src/protocol/byte-queue.ts",
      "src/protocol/jsonl.ts",
      "src/protocol/log-response.ts",
      "src/protocol/methods.ts",
      "src/protocol/principal-credential.ts",
      "src/protocol/host-channel.ts",
      "src/protocol/host-guest.ts",
      "src/protocol/host-api.ts",
      "src/protocol/guest-history.ts",
      "src/protocol/host-history.ts",
      "src/protocol/operation-results.ts",
      "src/protocol/receipt-codec.ts",
      "src/protocol/receipt-chunks.ts",
      "src/protocol/status-page.ts",
      "src/protocol/receipts.ts",
      "src/protocol/request-codec.ts",
      "src/protocol/response-codec.ts",
      "src/protocol/run-lease.ts",
    ],
  },
  {
    name: "K2-mechanisms",
    files: [
      "src/client/context.ts",
      "src/client/fence.ts",
      "src/client/index.ts",
      "src/client/receipts.ts",
      "src/client/request-service.ts",
      "src/client/runtime.ts",
      "src/client/settings.ts",
      "src/client/transport.ts",
      "src/config.ts",
      "src/config/policy.ts",
      "src/config/operations.ts",
      "src/config/generations.ts",
      "src/ids.ts",
      "src/leaf.ts",
      "src/process/async.ts",
      "src/process/cleanup.ts",
      "src/process/policies.ts",
      "src/process/preparation.ts",
      "src/process/run.ts",
      "src/protocol/channel.ts",
      "src/protocol/connection.ts",
      "src/storage/batch-view.ts",
      "src/storage/contained-fs.ts",
      "src/storage/tree-lease.ts",
      "src/storage/context-files.ts",
      "src/storage/context-snapshot.ts",
      "src/storage/context-stream.ts",
      "src/storage/directory.ts",
      "src/storage/socket-name.ts",
      "src/storage/durable-fs.ts",
      "src/storage/delivery-receipt.ts",
      "src/storage/quota.ts",
      "src/storage/immutable-file.ts",
      "src/storage/file-digest.ts",
      "src/storage/preaccept-artifact.ts",
      "src/storage/project-preparation.ts",
      "src/storage/snapshot-reader.ts",
      "src/storage/staged-tree.ts",
      "src/storage/submit-spool.ts",
    ],
  },
  {
    name: "K3-ledger",
    files: [
      "src/store.ts",
      "src/storage/diagnostic-snapshot.ts",
      "src/storage/facets.ts",
      "src/storage/ledger-reader.ts",
      "src/storage/operation-codec.ts",
      "src/storage/operation-journal.ts",
      "src/storage/operation-transitions.ts",
      "src/storage/rows.ts",
      "src/storage/receipt-projector.ts",
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
    crossZoneEdges = [], typeReviewEdges = [];
  for (const edge of graph.edges) {
    if (!edge.included) continue;
    const from = kernelZoneOf(edge.from),
      to = kernelZoneOf(edge.to);
    const fromLayer = layerOf(edge.from), toLayer = layerOf(edge.to);
    const kernelUpward = Boolean(from && to && from.index < to.index);
    const coarseUpward = Boolean(fromLayer && toLayer && fromLayer.index < toLayer.index);
    const portContract = isInternalPort(edge.from) || isInternalPort(edge.to);
    const conformance = edge.from === "src/entry/module-conformance.ts";
    if (edge.kind === "type" && (kernelUpward || coarseUpward || portContract || conformance)) {
      // Structural context, never a per-edge whitelist or automatic semantic approval.
      const classification = conformance ? "port-conformance"
        : edge.from === "src/module-ports.ts" || edge.from.startsWith("implementation/") ? "compatibility-facade"
        : portContract ? "internal-port-contract"
        : from && to ? "representation-relation" : "implementation-knowledge-review";
      typeReviewEdges.push({ from: edge.from, to: edge.to, classification, kernelUpward, coarseUpward });
    }
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
    internalPortContracts: graph.files.filter(isInternalPort),
    typeOnlyReview: { mode: "report-only", classificationsAreApproval: false, edges: typeReviewEdges },
    runtimeCycles: cycles.runtime.filter((group) =>
      group.some((file) => kernelZoneOf(file)),
    ),
    unionCycles: cycles.union.filter((group) =>
      group.some((file) => kernelZoneOf(file)),
    ),
  };
}
