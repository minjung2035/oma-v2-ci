/** Derived, process-local author index. Authenticated submission rows plus
 * freshly observed immutable refs are the only authority. */
import { StoreError } from "@oma/domain/errors";
import type { OperationOf } from "@oma/protocol/operation-codec";
export interface ProvenanceObservations {
  refs(): ReadonlyMap<string,string>;
  graph(candidates: readonly string[]): ReadonlyMap<string,readonly string[]>;
  range(base: string,candidate: string): readonly string[];
}
export class ProvenanceIndex {
  private generation = "";
  private contributors = new Map<string,Set<string>>();
  readonly metrics = { queries:0, rebuilds:0, refRecords:0, graphCommits:0, actorCommitPairs:0, gitCalls:0 };
  constructor(private readonly observations: ProvenanceObservations) {}
  authors(base: string,candidate: string, rows: readonly OperationOf<"git.submit">[]): readonly string[] {
    this.metrics.queries++;this.metrics.gitCalls++;
    // Never skip actual ref observation because the DB generation was unchanged.
    const refs=this.observations.refs();this.metrics.refRecords=refs.size;
    const active=[];
    for(const row of rows) {
      if(row.state === "failed") continue;
      const oid=refs.get(row.plan.publishedRef);
      if(oid === undefined && row.state !== "succeeded") continue;
      if(oid !== row.plan.candidate) throw new StoreError("STORE_CORRUPT","authenticated published submission changed identity");
      active.push({id:row.id,state:row.state,actor:row.actor,candidate:row.plan.candidate,ref:row.plan.publishedRef});
    }
    const generation=JSON.stringify(active);
    if(generation !== this.generation) {
      this.metrics.gitCalls++;
      const graph=this.observations.graph([...new Set(active.map(r=>r.candidate))]);
      const next=new Map<string,Set<string>>();
      for(const row of active) {
        const todo=[row.candidate];
        while(todo.length) {
          const oid=todo.pop()!, authors=next.get(oid) ?? new Set<string>();
          if(authors.has(row.actor)) continue;
          const parents=graph.get(oid);if(parents === undefined) throw new StoreError("REF_STATE_UNKNOWN","authenticated commit graph is incomplete");
          authors.add(row.actor);next.set(oid,authors);todo.push(...parents);
        }
      }
      // Publish only a complete rebuild; a failed observation cannot erase authors.
      this.contributors=next;this.generation=generation;this.metrics.rebuilds++;
      this.metrics.graphCommits=graph.size;this.metrics.actorCommitPairs=[...next.values()].reduce((n,s)=>n+s.size,0);
    }
    this.metrics.gitCalls++;
    const actors=new Set<string>();
    for(const oid of this.observations.range(base,candidate)) for(const actor of this.contributors.get(oid) ?? []) actors.add(actor);
    for(const row of active) if(row.candidate === candidate) actors.add(row.actor);
    return [...actors].sort();
  }
}
