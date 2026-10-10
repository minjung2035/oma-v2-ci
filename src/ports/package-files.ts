

/** What staging a local package needs of the filesystem beneath the store: a
 * scratch directory to fill, then one rename into `local/`. The two platforms
 * implement it their own way (the file's header says why); the readers of the
 * staged tree use `path`, which is never written through. */
export interface StageArea {
  /** The staging root's own path -- for reading it back, not writing it. */
  readonly path: string;
  /** `rel` is a directory beneath the staging root, its parents made too. */
  make(rel: string): void;
  /** `bytes` is the file `rel` beneath the staging root, its parents made. */
  write(rel: string, bytes: Buffer, executable: boolean): void;
  /** `size` bytes of `source` from `position` on are the file `rel` beneath the
   * staging root, its parents made -- the copy is chunked, so a staged file
   * is never a whole buffer in memory. */
  writeFrom(rel: string, source: number, position: number, size: number, executable: boolean): void;
  /** `made` -- a leaf name under the staging root, "" for the root itself --
   * becomes `local/<name>` whole, replacing a dead copy. */
  publish(made: string, name: string): void;
  /** The staging root is given back; a published name is unaffected. */
  close(): void;
}
export interface PackageDirectoryEntry { readonly name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
export interface PackageDirectories {
  list(path: string): readonly PackageDirectoryEntry[] | null;
  /** Whether the owned entry could be repaired; the caller corroborates absence. */
  repair(path: string): boolean;
}
