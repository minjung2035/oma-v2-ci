/** P5 measurement result, not an aspirational layer diagram.
 *
 * The order below is the coarse dependency DAG observed on the current source:
 * a runtime edge may point to the same layer or to a more fundamental layer,
 * never upward toward orchestration or entry. Type-only references are erased
 * at runtime and are reported as evidence separately; they only fail when they
 * form an import cycle.
 *
 * Layers were selected from `scripts/dependency-graph.mjs` output, not imposed
 * on the code. Adding a new file outside these prefixes fails the gate instead
 * of silently escaping the lattice.
 *
 * L1-kernel is one mechanism layer: pure definitions, primitives, and the single
 * SQLite owner. A type-only reference may point back into the same layer (the
 * P4 facets derive their shape from Store), so only a cycle that spans two
 * layers is an architecture finding.
 */
const LAYERS = Object.freeze([
  { name: "L0-contracts", prefixes: ["implementation/"] },
  { name: "L1-kernel", prefixes: [
    "src/domain/", "src/ids.ts", "src/hash.ts", "src/leaf.ts", "src/module-ports.ts", "src/validate.ts", "src/frame.ts",
    "src/durable.ts", "src/config.ts", "src/config/", "src/process/", "src/protocol/", "src/storage/", "src/cli/cache-codec.ts",
    "src/mail/addresses.ts", "src/mail/facts.ts", "src/mail/headers.ts", "src/store.ts",
  ] },
  { name: "L2-facts", prefixes: ["src/units/", "src/units.ts", "src/diagnostics/", "src/authority.ts", "src/request-cache.ts"] },
  { name: "L3-workflow", prefixes: [
    "src/mail/", "src/mail.ts", "src/git/", "src/git.ts", "src/lifecycle/", "src/lifecycle.ts",
    "src/inference/", "src/inference.ts", "src/views/", "src/views.ts", "src/reconcile/",
  ] },
  { name: "L4-orchestration", prefixes: [
    "src/reconcile.ts", "src/broker/", "src/broker.ts", "src/runtime/", "src/runner.ts", "src/sandbox.ts",
  ] },
  { name: "L5-entry", prefixes: ["src/entry/", "src/cli/", "src/cli.ts", "src/pi-extension.ts", "src/rpc-client.ts"] },
]);

/** Longest matching prefix wins, so a file-level entry can refine a directory. */
export function layerOf(file, layers = LAYERS) {
  let match = null;
  for (let index = 0; index < layers.length; index++) {
    for (const prefix of layers[index].prefixes) {
      const directory = prefix.endsWith("/");
      const hit = directory ? file.startsWith(prefix) : file === prefix;
      if (!hit) continue;
      if (!match || prefix.length > match.prefix.length) match = { index, prefix, name: layers[index].name };
    }
  }
  return match;
}

/** A runtime dependency may not point toward a higher (less fundamental) layer. */
export function latticeFindings(edges, files, layers = LAYERS) {
  const findings = [];
  for (const file of files) {
    if (!layerOf(file, layers)) findings.push({ rule: "dependency-lattice-unclassified", file, reason: `No measured lattice layer contains ${file}` });
  }
  for (const edge of edges) {
    if (edge.kind !== "runtime" || !edge.included) continue;
    const from = layerOf(edge.from, layers), to = layerOf(edge.to, layers);
    if (!from || !to) continue;
    if (from.index < to.index)
      findings.push({ rule: "dependency-lattice", file: edge.from, reason: `Runtime import ${edge.from} (${from.name}) -> ${edge.to} (${to.name}) reverses the measured lattice` });
  }
  return findings;
}

/** A cycle is only an architecture finding when it spans two layers, i.e. when
 * two ownership units reference each other. A cycle inside one layer is one
 * mechanism referencing itself. */
export function cycleFindings(groups, layers = LAYERS) {
  const findings = [];
  for (const group of groups) {
    const names = new Set(group.map(file => layerOf(file, layers)?.name ?? "unclassified"));
    if (names.size > 1)
      findings.push({ rule: "type-import-cycle", file: group[0],
        reason: `Runtime/type import SCC crosses ${[...names].sort().join(", ")}: ${group.join(" -> ")}` });
  }
  return findings;
}

export const LATTICE = LAYERS;
