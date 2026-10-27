import { posix } from "node:path";

/** Select only declared dependencies from the product's one resolved lock.
 * Preserve nested placements and integrity; no fresh registry resolution and
 * no copy of the root's unrelated dependency declarations. */
export function isolatedLock({ manifest, closure, archives, byName, productLock }) {
  const packages = { "": manifest };
  const selectExternal = (name, from = "", optional = false) => {
    let cursor = from;
    let located;
    for (;;) {
      const candidate = posix.join(cursor, "node_modules", name);
      if (productLock.packages[candidate] && !productLock.packages[candidate].link) { located = candidate; break; }
      if (!cursor) break;
      const parent = posix.dirname(cursor); cursor = parent === "." ? "" : parent;
    }
    if (!located) {
      if (optional) return;
      throw new Error(`declared dependency ${name} from ${from || "root"} is absent from the product lock`);
    }
    if (packages[located]) return;
    const entry = productLock.packages[located];
    packages[located] = entry;
    for (const dependency of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) {
      const optional = Object.hasOwn(entry.optionalDependencies ?? {}, dependency) ||
        !Object.hasOwn(entry.dependencies ?? {}, dependency) && entry.peerDependenciesMeta?.[dependency]?.optional === true;
      selectExternal(dependency, located, optional);
    }
  };
  for (const name of closure) {
    const workspace = byName.get(name), archive = archives.get(name);
    if (!workspace || !archive) throw new Error(`missing packed workspace ${name}`);
    packages[`node_modules/${name}`] = { version: workspace.manifest.version, resolved: `file:${archive.path}`,
      integrity: archive.integrity, dependencies: workspace.manifest.dependencies,
      ...(workspace.manifest.bin ? { bin: workspace.manifest.bin } : {}),
      ...(workspace.manifest.peerDependencies ? { peerDependencies: workspace.manifest.peerDependencies } : {}) };
    for (const dependency of Object.keys({ ...workspace.manifest.dependencies, ...workspace.manifest.peerDependencies }))
      if (!byName.has(dependency)) selectExternal(dependency);
      else if (!closure.has(dependency)) throw new Error(`missing declared workspace ${dependency}`);
  }
  for (const name of Object.keys(manifest.devDependencies ?? {})) selectExternal(name);
  return { name: manifest.name, lockfileVersion: 3, requires: true, packages };
}
