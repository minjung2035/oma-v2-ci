/** AUTH-003/CREATE-003/INF-003: pure created_by semantics over a validated snapshot.
 * No database, host observations, implicit reparenting or invented depth limit.
 */
import { StoreError } from "./errors.js";
import { isValidActor } from "./identifiers.js";
export interface LineageNode { readonly name: string; readonly createdBy: string | null }
function corrupt(message: string): never { throw new StoreError("STORE_CORRUPT", message); }
export class LineageSnapshot<N extends LineageNode = LineageNode> {
  private readonly nodes: ReadonlyMap<string, Readonly<N>>;
  private readonly children: ReadonlyMap<string, readonly string[]>;
  constructor(input: readonly N[]) {
    const nodes = new Map<string, Readonly<N>>();
    const children = new Map<string, string[]>();
    for (const node of input) {
      if (!isValidActor(node.name) || (node.createdBy !== null && !isValidActor(node.createdBy))) corrupt("invalid lineage identity");
      if (nodes.has(node.name)) corrupt("duplicate lineage identity");
      nodes.set(node.name, Object.freeze({ ...node }));
    }
    for (const node of nodes.values()) {
      if (node.createdBy === null) continue;
      if (!nodes.has(node.createdBy)) corrupt(`missing lineage parent ${node.createdBy}`);
      const siblings = children.get(node.createdBy) ?? [];
      siblings.push(node.name); children.set(node.createdBy, siblings);
    }
    const complete = new Set<string>();
    for (const node of nodes.values()) {
      const visiting = new Set<string>();
      let current: Readonly<N> | undefined = node;
      while (current !== undefined && !complete.has(current.name)) {
        if (visiting.has(current.name)) corrupt(`created_by cycle at ${current.name}`);
        visiting.add(current.name);
        current = current.createdBy === null ? undefined : nodes.get(current.createdBy);
      }
      for (const name of visiting) complete.add(name);
    }
    this.nodes = nodes;
    this.children = new Map([...children].map(([name, values]) => [name, Object.freeze([...values])]));
  }
  node(name: string): Readonly<N> { return this.nodes.get(name) ?? corrupt(`unknown lineage actor ${name}`); }
  all(): readonly Readonly<N>[] { return [...this.nodes.values()]; }
  ancestors(name: string, includeSelf = true): readonly Readonly<N>[] {
    const out: Readonly<N>[] = [];
    let node: Readonly<N> | null = this.node(name);
    if (!includeSelf) node = node.createdBy === null ? null : this.node(node.createdBy);
    while (node !== null) { out.push(node); node = node.createdBy === null ? null : this.node(node.createdBy); }
    return out;
  }
  descendants(name: string, includeSelf = true): readonly Readonly<N>[] {
    this.node(name);
    const queue = includeSelf ? [name] : [...(this.children.get(name) ?? [])];
    const out: Readonly<N>[] = [];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]!;
      out.push(this.node(current));
      for (const child of this.children.get(current) ?? []) queue.push(child);
    }
    return out;
  }
  isDescendant(name: string, ancestor: string, includeSelf = false): boolean {
    this.node(ancestor);
    return this.ancestors(name, includeSelf).some(node => node.name === ancestor);
  }
}
