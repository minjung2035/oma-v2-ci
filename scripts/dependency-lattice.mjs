/** P5 coarse dependency DAG, refined inside L1 by kernel-zones.mjs (P13).
 * Runtime imports may stay in a layer or point downward; all runtime cycles fail.
 * Erased type cycles are reported separately and only fail across coarse layers.
 * Store/facet type-only relations deliberately retain their authoritative owner.
 * New files outside these prefixes fail rather than escaping the lattice.
 */
const INTERNAL_PORT_PREFIXES = ["src/ports/", "src/module-ports.ts"];
export function isInternalPort(file) {
  return INTERNAL_PORT_PREFIXES.some(prefix => prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix);
}

// Contract owners are exact declaration surfaces; do not exempt broad implementation/ prefixes.
const CONTRACT_OWNER_PREFIXES = Object.freeze(["implementation/contracts/", "implementation/contracts.ts", ...INTERNAL_PORT_PREFIXES]);
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
  { name: "L0-contracts", prefixes: ["implementation/", ...INTERNAL_PORT_PREFIXES] },
  {
    name: "L1-kernel",
    prefixes: [
      "src/domain/",
      "src/ids.ts",
      "src/hash.ts",
      "src/leaf.ts",
      "src/validate.ts",
      "src/frame.ts",
      "src/durable.ts",
      "src/config.ts",
      "src/config/",
      "src/process/",
      "src/protocol/",
      "src/storage/",
      "src/cli/cache-codec.ts",
      "src/cli/request-intent.ts",
      "src/client/",
      "src/mail/addresses.ts",
      "src/mail/facts.ts",
      "src/mail/headers.ts",
      // Bound floors and thread-body measurements: pure leaf policy the
      // config schema validates against, like the mail leaves above.
      "src/mail/review-bounds.ts",
      // The confined Resident's path tables and host/inside translations:
      // pure policy the config schema and lifecycle mounts both read.
      "src/resident-paths.ts",
      "src/store.ts",
    ],
  },
  {
    name: "L2-facts",
    prefixes: [
      "src/units/",
      "src/units.ts",
      "src/diagnostics/",
      "src/authority.ts",
      "src/request-cache.ts",
    ],
  },
  {
    name: "L3-workflow",
    prefixes: [
      "src/attestation.ts",
      "src/mail/",
      "src/mail.ts",
      "src/git/",
      "src/git.ts",
      "src/lifecycle/",
      "src/lifecycle.ts",
      "src/inference/",
      "src/inference.ts",
      "src/views/",
      "src/views.ts",
      "src/reconcile/",
      "src/review.ts",
    ],
  },
  {
    name: "L4-orchestration",
    prefixes: [
      "src/reconcile.ts",
      "src/broker/",
      "src/broker.ts",
      "src/runtime/",
      // Pi-version-sensitive integration points (A7): the wire union, the
      // settings bridge and the ambient surface the engine gives OMA.
      "src/pi-compat/",
      "src/cli/effects.ts",
      "src/cli/effects/",
      "src/runner.ts",
      "src/sandbox.ts",
      // macOS host and hidden-VM guest services (docs/macos-platform.md):
      // they compose runtime pieces the way the entries do, below the entries.
      "src/platform/",
    ],
  },
  {
    name: "L5-entry",
    prefixes: [
      "src/entry/",
      "src/cli/",
      "src/cli.ts",
      // The product surface is an entry surface, like the model-facing CLI: it
      // consumes lower layers and nothing below it imports the TUI.
      "src/tui/",
      "src/pi-extension.ts",
      // The trusted extension's parts; the entry above composes them and the
      // extension-closure rule keeps them free of OMA runtime imports.
      "src/extension/",
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

/** A cycle is only an architecture finding when it spans two layers, i.e. when
 * two ownership units reference each other. A cycle inside one layer is one
 * mechanism referencing itself. */
export function cycleFindings(groups, layers = LAYERS) {
  const findings = [];
  for (const group of groups) {
    const names = new Set(
      group.map((file) => layerOf(file, layers)?.name ?? "unclassified"),
    );
    if (names.size > 1)
      findings.push({
        rule: "type-import-cycle",
        file: group[0],
        reason: `Runtime/type import SCC crosses ${[...names].sort().join(", ")}: ${group.join(" -> ")}`,
      });
  }
  return findings;
}

export const LATTICE = LAYERS;
