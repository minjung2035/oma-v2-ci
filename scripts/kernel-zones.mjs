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
      "packages/tool-files/src/errors.ts",
      "packages/domain/src/recovery-policy.ts",
      "packages/domain/src/batch-settlement.ts",
      "packages/domain/src/protocol-limits.ts",
      "packages/domain/src/extension-paths.ts",
      "packages/domain/src/actor-address.ts",
      "packages/protocol/src/session-handoff.ts",
      "packages/domain/src/host-signals.ts",
      "packages/domain/src/config-format.ts",
      "packages/domain/src/display-address.ts",
      "packages/client/src/errors.ts",
      "packages/protocol/src/log-limits.ts",
      "packages/protocol/src/delivery-boundary.ts",
      // BL2: the ask_user_question contract — bounds, question/answer/result
      // shapes, reserved labels, normalizer and the fail-closed validator.
      "packages/domain/src/ask-user-question/questionnaire.ts",
      "apps/oma/src/cli/request-intent.ts",
      "packages/domain/src/admission.ts",
      "packages/domain/src/attestation-relations.ts",
      "packages/domain/src/canonical-json.ts",
      "packages/config/src/defaults.ts",
      "packages/domain/src/role-prompts.ts",
      "packages/domain/src/capabilities.ts",
      "packages/domain/src/child-policy.ts",
      "packages/domain/src/context-policy.ts",
      "packages/domain/src/deployment.ts",
      "packages/domain/src/derived.ts",
      "packages/domain/src/egress.ts",
      "packages/domain/src/errors.ts",
      "packages/domain/src/exhaustive.ts",
      "packages/domain/src/identifiers.ts",
      "packages/domain/src/integer-fields.ts",
      "packages/domain/src/limits.ts",
      "packages/domain/src/lineage.ts",
      "packages/domain/src/mail-values.ts",
      "packages/domain/src/request-identity.ts",
      "packages/domain/src/review-evaluation.ts",
      "packages/domain/src/session-mode.ts",
      "packages/domain/src/settings-policy.ts",
      "packages/domain/src/settings.ts",
      "packages/domain/src/surface-bounds.ts",
      "packages/domain/src/package-policy.ts",
      "packages/domain/src/spec-identity.ts",
      "packages/domain/src/risk-tier.ts",
      "packages/domain/src/turn-admission.ts",
      "packages/domain/src/tool-surface.ts",
      "packages/domain/src/utf8.ts",
      "packages/domain/src/unseen-text.ts",
      "packages/process/src/command.ts",
      "packages/domain/src/resident-paths.ts",
      "packages/domain/src/paths.ts",
    ],
  },
  {
    name: "K1-codecs",
    files: [
      "packages/native/src/metadata-observation.ts",
      "packages/protocol/src/client-codecs.ts",
      "apps/oma/src/cli/cache-codec.ts",
      "packages/domain/src/attestation.ts",
      "packages/domain/src/agent-spec.ts",
      "packages/domain/src/integration-policy.ts",
      "packages/domain/src/git-facts.ts",
      "packages/protocol/src/persisted-formats.ts",
      "packages/domain/src/durable.ts",
      "packages/protocol/src/frame.ts",
      "packages/mail/src/addresses.ts",
      "packages/mail/src/facts.ts",
      "packages/mail/src/headers.ts",
      "packages/domain/src/review-bounds.ts",
      "packages/domain/src/validation.ts",
      "packages/protocol/src/batch-view.ts",
      "packages/protocol/src/status-view.ts",
      "packages/protocol/src/byte-queue.ts",
      "packages/protocol/src/jsonl.ts",
      "packages/protocol/src/log-response.ts",
      "packages/protocol/src/methods.ts",
      "packages/protocol/src/principal-credential.ts",
      "packages/protocol/src/host-channel.ts",
      "packages/protocol/src/operation-results.ts",
      "packages/protocol/src/receipt-codec.ts",
      "packages/protocol/src/receipt-chunks.ts",
      "packages/protocol/src/status-page.ts",
      // BL2: the oma.ask.* event-channel payload shapes and guards, and the
      // model-facing envelope representation (text + details) of a result.
      "packages/protocol/src/ask-user-question.ts",
      "packages/domain/src/ask-user-question/envelope.ts",
      "packages/protocol/src/receipts.ts",
      "packages/protocol/src/request-codec.ts",
      "packages/protocol/src/response-codec.ts",
      "packages/protocol/src/run-lease.ts",
      "packages/protocol/src/resident-context.ts",
      "packages/protocol/src/mac-developer-tools.ts",
      "packages/protocol/src/git-execution-view.ts",
      "packages/process/src/execution-witness.ts",
    ],
  },
  {
    name: "K2-mechanisms",
    files: [
      "packages/native/src/audit-session.ts",
      "packages/file-descriptors/src/index.ts",
      "packages/tool-files/src/descriptor-files.ts",
      "packages/tool-files/src/index.ts",
      "packages/domain/src/authority.ts",
      "packages/client/src/context.ts",
      "packages/process/src/fence.ts",
      "packages/process/src/host-loss.ts",
      // BL2: the questionnaire interaction state machine — tab/row focus,
      // checkbox set, input buffer, committed answers; pure, no I/O.
      "packages/domain/src/ask-user-question/model.ts",
      "packages/client/src/index.ts",
      "packages/client/src/receipts.ts",
      "packages/client/src/request-service.ts",
      "packages/client/src/runtime.ts",
      "packages/client/src/settings.ts",
      "packages/client/src/transport.ts",
      "packages/config/src/index.ts",
      "packages/config/src/policy.ts",
      "packages/config/src/operations.ts",
      "packages/config/src/state-format.ts",
      "packages/config/src/generations.ts",
      "packages/native/src/identity.ts",
      "packages/native/src/process-lock.ts",
      "packages/native/src/linux.ts",
      "packages/native/src/peer-uid.ts",
      "packages/process/src/async.ts",
      "packages/native/src/cleanup.ts",
      // DR36: cancellable native timer scheduling is an execution mechanism.
      "packages/process/src/deadline.ts",
      "packages/process/src/policies.ts",
      "packages/process/src/preparation.ts",
      "packages/process/src/run.ts",
      "packages/protocol/src/alarm.ts",
      "packages/client/src/channel.ts",
      "packages/client/src/connection.ts",
      "packages/storage/src/batch-view.ts",
      "packages/storage/src/arrival-journal.ts",
      "packages/storage/src/mailbox.ts",
      "packages/storage/src/mail-notices.ts",
      "packages/storage/src/published-mail.ts",
      "packages/native/src/directory-layout.ts",
      "packages/process/src/writer.ts",
      "packages/native/src/files.ts",
      "packages/native/src/posix-files.ts",
      "packages/native/src/darwin-metadata.ts",
      "packages/native/src/process-observation.ts",
      "packages/native/src/pid-namespace.ts",
      "packages/native/src/control-socket.ts",
      "packages/native/src/descriptor-path.ts",
      "packages/native/src/unix-message.ts",
      "packages/native/src/mach-message.ts",
      "packages/native/src/process-event.ts",
      "packages/native/src/audit-origin.ts",
      "packages/native/src/audit-token.ts",
      "packages/process/src/restart-policy.ts",
      "packages/process/src/coalesced-wake.ts",
      "packages/process/src/resident-supervisor.ts",
      "packages/process/src/resident-runtime.ts",
      "packages/process/src/resident-logs.ts",
      "packages/process/src/observed-stream.ts",
      "packages/process/src/packet-stream.ts",
      "packages/process/src/replace.ts",
      "packages/storage/src/resident-logs.ts",
      "packages/process/src/owned-execution.ts",
      "packages/process/src/restic.ts",
      "packages/storage/src/package-staging.ts",
      "packages/storage/src/package-tar.ts",
      "packages/storage/src/restic-tool.ts",
      "packages/storage/src/restic-tar.ts",
      "packages/storage/src/restic-verification.ts",
      "packages/storage/src/tree-lease.ts",
      "packages/storage/src/execution-staging.ts",
      "packages/storage/src/installation-surface.ts",
      "packages/storage/src/cache-trees.ts",
      "packages/storage/src/context-files.ts",
      "packages/storage/src/context-snapshot.ts",
      "packages/storage/src/context-stream.ts",
      "packages/storage/src/directory.ts",
      "packages/storage/src/socket-name.ts",
      "packages/storage/src/durable-fs.ts",
      "packages/storage/src/delivery-receipt.ts",
      "packages/storage/src/immutable-file.ts",
      "packages/storage/src/file-digest.ts",
      "packages/storage/src/preaccept-artifact.ts",
      "packages/storage/src/preaccept-collection.ts",
      "packages/git/src/project-preparation.ts",
      "packages/git/src/quarantine-worker.ts",
      "packages/git/src/candidate-check.ts",
      "packages/native/src/snapshot-reader.ts",
      "packages/storage/src/staged-tree.ts",
      "packages/storage/src/submit-spool.ts",
      "packages/storage/src/transport-spool.ts",
      // P0: the oversized-answer spool -- a durable publish of complete bytes
      // under the caller's state directory; delivery mechanism, no ledger facts.
      "packages/storage/src/output-spool.ts",
      "packages/storage/src/execution-journal.ts",
    ],
  },
  {
    name: "K3-ledger",
    files: [
      "packages/storage/src/store.ts",
      "packages/storage/src/diagnostic-snapshot.ts",
      "packages/storage/src/facets.ts",
      "packages/storage/src/store-access.ts",
      "packages/storage/src/ledger-reader.ts",
      "packages/protocol/src/operation-codec.ts",
      "packages/storage/src/operation-journal.ts",
      "packages/storage/src/operation-transitions.ts",
      "packages/storage/src/rows.ts",
      "packages/protocol/src/receipt-projector.ts",
      "packages/storage/src/transaction.ts",
      "packages/storage/src/transitions.ts",
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
  "packages/domain/src/canonical-json.ts": ["node:crypto"],
  "packages/domain/src/derived.ts": ["node:crypto"],
  "packages/domain/src/spec-identity.ts": ["node:crypto"],
  "packages/domain/src/paths.ts": ["node:path"],
  "packages/domain/src/durable.ts": ["node:path"],
  "packages/protocol/src/run-lease.ts": ["node:path"],
  // Actor/root grammar only: join trusted paths; no filesystem observation.
  "packages/protocol/src/resident-context.ts": ["node:path"],
  "packages/protocol/src/frame.ts": ["node:util"],
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
    const conformance = edge.from === "apps/oma/src/entry/module-conformance.ts";
    if (edge.kind === "type" && (kernelUpward || coarseUpward || portContract || conformance)) {
      // Structural context, never a per-edge whitelist or automatic semantic approval.
      const classification = conformance ? "port-conformance"
        : edge.from.startsWith("packages/contracts/src/") ? "contract-definition"
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
