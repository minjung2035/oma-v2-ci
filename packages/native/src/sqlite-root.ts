/** Package-owned public VFS image. SQLite connections belong to Storage. */
import { fileURLToPath } from "node:url";
import { StoreError } from "@oma/domain/errors";
export function bundledSqliteRootLibrary(): string {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "SQLite root adapter requires qualified Darwin Unix POSIX VFS");
  return fileURLToPath(new URL("./sqlite-root/oma-sqlite-root.dylib", import.meta.url));
}
