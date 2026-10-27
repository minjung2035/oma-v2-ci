/** P5 coarse dependency DAG, refined inside L1 by kernel-zones.mjs (P13).
 * Runtime imports may stay in a layer or point downward; all runtime cycles fail.
 * Erased type cycles fail too: capability declarations do not refer back to their composition.
 * Store capabilities point toward decoded values, never back to SQLite composition.
 * New files outside these prefixes fail rather than escaping the lattice.
 */
const INTERNAL_PORT_PREFIXES = ["apps/oma/src/ports/"];
export function isInternalPort(file) {
  return INTERNAL_PORT_PREFIXES.some(prefix => prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix);
}

// Contract owners are exact declaration surfaces; do not exempt broad implementation/ prefixes.
const CONTRACT_OWNER_PREFIXES = Object.freeze(["packages/contracts/src/", "packages/contracts/src/index.ts", ...INTERNAL_PORT_PREFIXES]);
export function isContractOwner(file) {
  return CONTRACT_OWNER_PREFIXES.some(prefix => prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix);
}
export function contractOwnershipFindings(edges) {
  return edges
    .filter(edge => edge.included && isContractOwner(edge.from) && !isContractOwner(edge.to))
    .map(edge => ({
      rule: "contract-ownership",
      file: edge.from,
      target: edge.to,
      kind: edge.kind,
      specifier: edge.specifier,
      reason: `Contract owner ${edge.from} must not directly reference implementation ${edge.to} (${edge.kind} edge)`,
    }));
}

const LAYERS = Object.freeze([
  { name: "L0-contracts", prefixes: ["packages/contracts/src/", "implementation/", ...INTERNAL_PORT_PREFIXES] },
  {
    name: "L1-kernel",
    prefixes: [
      "packages/domain/src/",
      "packages/native/src/identity.ts",
      "packages/native/src/linux.ts",
      "packages/domain/src/validation.ts",
      "packages/protocol/src/frame.ts",
      "packages/domain/src/durable.ts",
      "packages/config/src/index.ts",
      "packages/config/src/",
      "packages/process/src/",
      "packages/native/src/",
      "packages/tool-files/src/",
      "packages/protocol/src/",
      "packages/storage/src/",
      "apps/oma/src/cli/cache-codec.ts",
      "apps/oma/src/cli/request-intent.ts",
      "packages/client/src/",
      "packages/mail/src/addresses.ts",
      "packages/mail/src/facts.ts",
      "packages/mail/src/headers.ts",
      // Bound floors and thread-body measurements: pure leaf policy the
      // config schema validates against, like the mail leaves above.
      "packages/domain/src/review-bounds.ts",
      // The confined Resident's path tables and host/inside translations:
      // pure policy the config schema and lifecycle mounts both read.
      "packages/domain/src/resident-paths.ts",
      "packages/storage/src/store.ts",
    ],
  },
  {
    name: "L2-facts",
    prefixes: [
      "packages/tool-runtime/src/",
      "apps/oma/src/diagnostics/",
      "apps/oma/src/request-cache.ts",
    ],
  },
  {
    name: "L3-workflow",
    prefixes: [
      "packages/mail/src/",
      "packages/mail/src/index.ts",
      "packages/git/src/",
      "packages/git/src/index.ts",
      "packages/lifecycle/src/",
      "packages/lifecycle/src/index.ts",
      "apps/oma/src/inference/",
      "apps/oma/src/inference.ts",
      "apps/oma/src/views/",
      "apps/oma/src/views.ts",
      "packages/reconcile/src/",
      "packages/review/src/index.ts",
      "packages/review/src/",
    ],
  },
  {
    name: "L4-orchestration",
    prefixes: [
      "packages/reconcile/src/index.ts",
      "packages/broker/src/",
      "apps/oma/src/broker/",
      "packages/broker/src/index.ts",
      "apps/oma/src/runtime/",
      // Pi-version-sensitive integration points (A7): the wire union, the
      // settings bridge and the ambient surface the engine gives OMA.
      "packages/engine/src/",
      "packages/platform-linux/src/",
      "packages/platform-mac/src/",
      "apps/oma/src/engine/",
      "apps/oma/src/cli/effects.ts",
      "apps/oma/src/cli/effects/",
      "apps/oma/src/runner.ts",
      "packages/platform-linux/src/sandbox.ts",
      // macOS host and hidden-VM guest services (docs/macos-platform.md):
      // they compose runtime pieces the way the entries do, below the entries.
      "apps/oma/src/platform/",
    ],
  },
  {
    name: "L5-entry",
    prefixes: [
      "apps/oma/src/entry/",
      "apps/oma/src/application/",
      "apps/oma/src/engine/presentation.ts",
      "apps/oma/src/engine/personal-composition.ts",
      "apps/oma/src/engine/personal-entry.ts",
      "apps/oma/src/cli/",
      "apps/oma/src/cli.ts",
      // The product surface is an entry surface, like the model-facing CLI: it
      // consumes lower layers and nothing below it imports the TUI.
      "packages/tui/src/",
      // The trusted extension's parts; the entry above composes them and the
      // extension-closure rule keeps them free of OMA runtime imports.
      "packages/extension/src/",
      "packages/tool-lsp/src/",
      "packages/tool-mcp/src/",
      "packages/tool-web/src/",
      "packages/tool-hashline/src/",
    ],
  },
]);

/** Longest matching prefix wins, so a file-level entry can refine a directory. */
export function layerOf(file, layers = LAYERS) {
  let match = null;
  for (let index = 0; index < layers.length; index++) {
    for (const prefix of layers[index].prefixes) {
      const directory = prefix.endsWith("/");
      const hit = directory ? file.startsWith(prefix) : file === prefix;
      if (!hit) continue;
      if (!match || prefix.length > match.prefix.length)
        match = { index, prefix, name: layers[index].name };
    }
  }
  return match;
}

/** A runtime dependency may not point toward a higher (less fundamental) layer. */
export function latticeFindings(edges, files, layers = LAYERS) {
  const findings = [];
  for (const file of files) {
    if (!layerOf(file, layers))
      findings.push({
        rule: "dependency-lattice-unclassified",
        file,
        reason: `No measured lattice layer contains ${file}`,
      });
  }
  for (const edge of edges) {
    if (edge.kind !== "runtime" || !edge.included) continue;
    const from = layerOf(edge.from, layers),
      to = layerOf(edge.to, layers);
    if (!from || !to) continue;
    if (from.index < to.index)
      findings.push({
        rule: "dependency-lattice",
        file: edge.from,
        reason: `Runtime import ${edge.from} (${from.name}) -> ${edge.to} (${to.name}) reverses the measured lattice`,
      });
  }
  return findings;
}

/** Both runtime and erased type cycles obscure ownership, including within a layer. */
export function cycleFindings(groups, layers = LAYERS) {
  const findings = [];
  for (const group of groups) {
    const names = new Set(
      group.map((file) => layerOf(file, layers)?.name ?? "unclassified"),
    );
    findings.push({
      rule: "type-import-cycle",
      file: group[0],
      reason: `Runtime/type import SCC in ${[...names].sort().join(", ")}: ${group.join(" -> ")}`,
    });
  }
  return findings;
}

export const LATTICE = LAYERS;
