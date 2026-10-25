export interface ProjectPreparation {
  readonly path: string;
  readonly descriptor: number;
  openContent(index?: number): number;
  dispose(): void;
}

/** Private spool names, independent of untrusted project filenames. */
export function projectContentName(index = 0): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError("invalid snapshot content index");
  return index === 0 ? "content" : `content-${index}`;
}

/** P0-4: attempt both ownership releases; a secondary error never replaces
 * the first. Releasing our hold is not proof that a child's hold ended. */
export function disposeProjectPreparation(release: () => void, collect: () => void): void {
  const failures: unknown[] = [];
  try { release(); } catch (error) { failures.push(error); }
  try { collect(); } catch (error) { failures.push(error); }
  if (failures.length > 1) throw new AggregateError(failures, "snapshot lease release and collection failed");
  if (failures.length === 1) throw failures[0];
}
