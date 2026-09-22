// Fresh process: no in-memory Store, planner result or killed-child object reused.
import { join } from "node:path";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { observeFile, observeLedger } from "./effect-observation.js";
const root = process.argv[2];
if (!root) throw new Error("owned observation root required");
function names(directory: string): string[] {
  try { return readdirSync(directory).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
const files = Object.fromEntries(names(root).filter(name => lstatSync(join(root, name)).isFile())
  .map(name => [name, observeFile(join(root, name))]));
const pointer = lstatSync(join(root, "pointer"), { throwIfNoEntry: false });
const db = lstatSync(join(root, "runtime.sqlite"), { throwIfNoEntry: false });
const mail = Object.fromEntries(["objects", "archive/cur", "inboxes/a/new", "inboxes/b/new", "inboxes/c/new"]
  .map(dir => [dir, names(join(root, "mail", dir)).map(name => ({ name, ...observeFile(join(root, "mail", dir, name)) }))]));
console.log(JSON.stringify({ pid: process.pid, files, mail,
  pointer: pointer ? readFileSync(join(root, "pointer"), "utf8") : null,
  ledger: db ? observeLedger(join(root, "runtime.sqlite")) : null,
}));
