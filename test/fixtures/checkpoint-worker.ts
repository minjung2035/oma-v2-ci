// A local-only worker over the real durable leaf seam. No manager or provider.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { replaceDerivedFile } from "@oma/storage/durable-fs";

const [root, mode, requested] = process.argv.slice(2);
if (!root || !mode || !requested)
  throw new Error("checkpoint fixture arguments required");
function stop(point: string): never {
  if (!process.send) throw new Error("checkpoint IPC required");
  process.send({ point });
  process.kill(process.pid, "SIGSTOP");
  throw new Error("stopped checkpoint unexpectedly resumed");
}
if (mode === "missing") process.exit(0);
if (mode === "wrong") stop("wrong-point");
if (mode === "false-checkpoint") stop(requested);
if (mode === "silent") {
  setInterval(() => {}, 1000);
} else if (mode === "throw-only") {
  try {
    replaceDerivedFile(join(root, "pointer"), "new", 0o600, (fault) => {
      if (fault.point === "file-write" && fault.phase === "before")
        throw new Error("ordinary failure");
    });
    process.exitCode = 3;
  } catch {
    writeFileSync(
      join(root, "cleanup-ran"),
      "ordinary exception completed cleanup",
    );
    process.exitCode = 2;
  }
} else if (mode === "replace") {
  let renamed = false;
  replaceDerivedFile(join(root, "pointer"), "new", 0o600, (fault) => {
    if (fault.point === "derived-rename" && fault.phase === "after-visible")
      renamed = true;
    if (
      requested === "pre-effect" &&
      fault.point === "file-create" &&
      fault.phase === "before"
    )
      stop(requested);
    if (
      requested === "after-visible" &&
      renamed &&
      fault.point === "derived-rename"
    )
      stop(requested);
    if (
      requested === "after-durable" &&
      renamed &&
      fault.point === "directory-fsync" &&
      fault.phase === "after-visible"
    )
      stop(requested);
    if (
      requested === "temporary-created" &&
      fault.point === "file-write" &&
      fault.phase === "before"
    )
      stop(requested);
  });
  throw new Error(`checkpoint not hit: ${requested}`);
} else if (mode !== "silent")
  throw new Error(`unknown checkpoint mode: ${mode}`);
