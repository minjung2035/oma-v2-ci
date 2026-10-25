export interface PackageDirectoryEntry { readonly name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
export interface PackageDirectories {
  list(path: string): readonly PackageDirectoryEntry[] | null;
  /** Whether the owned entry could be repaired; the caller corroborates absence. */
  repair(path: string): boolean;
}
