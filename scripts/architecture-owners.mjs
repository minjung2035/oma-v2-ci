/** Concrete responsibilities, not a baseline of violations. A moved owner must
 * update its imports and these negative-policy tests in the same change.
 */
export const subprocessResponsibilities = Object.freeze({
  "src/process/run.ts": "bounded synchronous command mechanism and final no-await observations",
  "src/process/async.ts": "bounded asynchronous child and pipe lifecycle mechanism",
  "src/process/policies.ts": "explicit host editor with inherited terminal I/O via runProcessSync",
  "src/rpc-client.ts": "long-lived Pi JSONL session with bounded framing, writes, drain and close",
  // PI-001: the trusted extension cannot import src/process, and the engine's
  // exec cannot pass a private descriptor, so the extension owns this one child.
  "src/extension/cli-process.ts": "model-facing CLI child with an explicit environment and a private credential socket",
});
export const DEFAULT_POLICY = Object.freeze({
  capabilityOwner: "src/domain/capabilities.ts",
  resourceOwner: "src/domain/resources.ts",
  limitOwner: "src/domain/limits.ts",
  identifierOwner: "src/domain/identifiers.ts",
  methodOwner: "src/protocol/methods.ts",
  identityOwner: "src/domain/request-identity.ts",
  sqliteOwners: Object.freeze(["src/store.ts"]),
  subprocessOwners: Object.freeze(Object.keys(subprocessResponsibilities)),
  // PI-001/002: the trusted extension cannot import host runtime at all (the
  // extension-closure rule holds that), so its batch-view identity grammar is an
  // exact mirror, and the equivalence of both decoders is pinned by
  // test/id-contracts.test.ts. This is not a general permission to restate
  // identifier grammars.
  identifierMirrors: Object.freeze({
    "src/extension/batch-view.ts": "trusted Pi extension mirroring the batch-view identity grammar",
    "src/extension/principal-channel.ts": "trusted Pi extension mirroring the host channel's credential line",
  }),
  // The framed transport is intentionally I/O, unlike the codecs next to it.
  // This does not allow fs, process, SQLite, Store or entrypoint imports here.
  protocolIoModules: Object.freeze({ "src/protocol/channel.ts": Object.freeze(["node:net"]) }),
});
export function pureBoundaryViolation(file, specifier, target, effectModules, policy = DEFAULT_POLICY) {
  if (!/^src\/(?:domain|protocol)\//.test(file)) return false;
  if (target === "src/store.ts" || target?.startsWith("src/entry/")) return true;
  if (!effectModules.has(specifier)) return false;
  return !(policy.protocolIoModules?.[file] ?? []).includes(specifier);
}
