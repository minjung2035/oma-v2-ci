/** Read capability consumed by canonical publication observers. */
import type { GitObservation } from "@oma/contracts/git";
export interface GitReadPort {
  ref(repository: string, ref: string): GitObservation<string>;
  commit(repository: string, oid: string): GitObservation<true>;
  ancestry(repository: string, base: string, candidate: string): GitObservation<boolean>;
}
