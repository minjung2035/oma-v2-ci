// FS-005 / architecture §4: every change under the state tree resolves its parent
// directory once and names the entry through that resolution. A path-taking fs
// mutation is therefore allowed only in the primitives that do the resolving,
// through `entryAt(...)` of a held directory, on a descriptor, or in a file
// whose effects are outside the state tree -- each such file says why.
import ts from "typescript";
import { authoredFiles, eachNode, filesUnder, finding, sourceOf } from "./shared.mjs";

const MUTATIONS = new Set([
  "renameSync", "unlinkSync", "rmSync", "rmdirSync", "mkdirSync", "copyFileSync", "symlinkSync", "linkSync",
  "truncateSync", "chmodSync", "cpSync", "mkdtempSync", "createWriteStream", "appendFileSync", "writeFileSync", "openSync",
]);
/** The resolving primitives themselves. */
export const STATE_TREE_PRIMITIVES = Object.freeze([
  "packages/native/src/files.ts", "packages/storage/src/directory.ts", "packages/storage/src/durable-fs.ts",
]);
/** Files whose path-taking mutations are outside the state tree, and why. */
export const OUTSIDE_STATE_TREE = Object.freeze({
  "packages/git/src/host-project.ts": "MacGit.run creates its own output-spool scratch with mkdtemp under the OS temp directory and removes that same scratch after the bounded Git command; metadata-only reads inspect the Human repository, never repair or rewrite its ancestors",
  "apps/oma/src/entry/broker.ts": "the run root (XDG_RUNTIME_DIR) the broker listens in",
  "apps/oma/src/runtime/inference-relay.ts": "the relay's socket in the run's own run-root directory",
  "packages/storage/src/socket-name.ts": "the one owner of a listening socket's name, which every caller keeps in a run directory (run root, guest and host service directories), never in a state tree",
  "apps/oma/src/runtime/egress-forwarder.ts": "the egress forwarder's socket beside the relay's, in the run's run-root directory (DR18, D-10)",
  "apps/oma/src/runtime/connect-proxy.ts": "the delivery's CONNECT proxy socket beside the run's lease socket, in the run's run-root directory (DR34)",
  "packages/native/src/pty.ts": "the slave device of a pseudo-terminal this process just made (/dev/pts), opened to hand to the session's program",
  "packages/platform-mac/src/files.ts": "the Mac host's one publication owner, for its own files in the app's support directory (record, archives, snapshots), outside any society's state tree",
  "packages/platform-mac/src/archive-crypto.ts": "the Mac host's archive files in its own support directory, outside any society's state tree",
  "apps/oma/src/cli/effects/submit.ts": "the CLI caller's own temporary directory",
  "packages/tool-lsp/src/lsp-call-scope.ts": "a fresh mkdtemp directory under the OS temp directory -- the LSP child's own per-call HOME/XDG/TMP scratch, removed when the call ends; no society's tree is written (PI-001)",
  "packages/tool-mcp/src/index.ts": "the MCP adapter's own state directory under the engine's agent dir (the credential key, the OAuth root, the per-session child-env scratch), or a fresh ephemeral tmp dir when no agent dir was provisioned -- engine-owned, rotated and removed by the adapter; the extension cannot import the storage primitives (PI-001)",
  "packages/extension/src/mail-tools.ts": "a fresh mkdtemp directory under the model's own working directory (a Resident's sandbox home; the Principal's scratch, in the state tree but the model's own), written once and removed; the extension cannot import the storage primitives (PI-001)",
  "packages/tool-files/src/descriptor-files.ts": "the search snapshot's private copy -- a fresh `oma-search-*` directory under the OS temp directory this call names before it exists and removes itself, written and removed by the same holder; source and destination are both written through held per-level descriptors (a same-uid racer cannot swap a component out from under either), so depth stays unbounded by anything but the OS descriptor table; the extension cannot import the storage primitives (PI-001)",
  "packages/tool-runtime/src/contained-search.ts": "the same private snapshot's sweep of an announced name under the OS temp directory; the complete-result spool is not written here -- it goes through the serialized contained writer in contained-tools.ts (PI-001)",
  "packages/extension/src/principal-tools.ts": "the same fresh mkdtemp directory under the Principal's scratch for an agent brief, written once and removed (PI-001)",
  "packages/extension/src/review-tools.ts": "the same fresh mkdtemp directory under the caller's own working directory for a vote/review/open body file, written once and removed (PI-001)",
  "packages/native/src/process-lock.ts": "the broker's lock file, which both callers keep in the run root",
  "packages/process/src/async.ts": "the caller-declared output spool paths -- absolute paths each caller names under its own scratch or ledger directory, never paths this runner chooses",
  "packages/process/src/run.ts": "the same caller-declared spool paths, opened descriptor-direct for the child -- never paths this runner chooses",
  "packages/git/src/canonical-command.ts": "fresh mkdtemp directories under the OS temp directory -- the ls-tree and merge-tree spool scratch each call names and removes itself; no society's tree is written",
  "apps/oma/src/platform/package-staging.ts": "the extracted filesystem staging owner: Mac paths are beneath the app support store; Linux mutations retain held parents through publication",
  "apps/oma/src/application/local-packages.ts": "the Mac host staging writes -- the store lives in the app's support directory outside any state tree on the hostStaging path; the Linux staging and archive spool name every entry through held store/staging parents",
});
/** A descriptor, not a path: `fd`, `this.fd`, `active.fd`, `temporaryFd`. */
const descriptorLike = node => {
  const text = ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : null;
  return text !== null && /(?:^|[a-z])fd$/i.test(text);
};
const heldEntry = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "entryAt";
/** `openSync` changes the tree only when its flags create, write or truncate. */
const writingOpen = node => {
  const flags = node.arguments[1];
  if (flags === undefined) return false;
  if (ts.isStringLiteralLike(flags)) return /[wa+]/.test(flags.text);
  return /\bO_(?:CREAT|WRONLY|RDWR|TRUNC|APPEND)\b/.test(flags.getText());
};
const calleeName = node => ts.isIdentifier(node.expression) ? node.expression.text
  : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;

export function stateTreeFindings(root) {
  const findings = [];
  for (const file of authoredFiles(root)) {
    if (STATE_TREE_PRIMITIVES.includes(file) || Object.hasOwn(OUTSIDE_STATE_TREE, file)) continue;
    eachNode(sourceOf(root, file), node => {
      if (!ts.isCallExpression(node)) return;
      const name = calleeName(node);
      if (name === null || !MUTATIONS.has(name)) return;
      // A method of something that is not the fs module (a socket's end, a spool's write) is not a filesystem call.
      if (ts.isPropertyAccessExpression(node.expression) && !(ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "fs")) return;
      if (name === "openSync" && !writingOpen(node)) return;
      const first = node.arguments[0];
      if (first === undefined || heldEntry(first) || descriptorLike(first)) return;
      if (name === "symlinkSync" && node.arguments[1] !== undefined && heldEntry(node.arguments[1])) return;
      findings.push(finding("state-tree-held-parent", file,
        `${name} names a path; under the state tree resolve the parent once (withinDirectory/entryAt, or a storage primitive)`));
    });
  }
  return findings;
}

/** DR18 (S-06): a state root is judged by one function, which adds to the
 * layout check (VAL-002, FS-005) that the tree is on a local file system. A
 * process that judged a state root by its layout alone would open a store and
 * take locks on a file system that keeps neither. */
const STATE_ROOT_OWNER = "apps/oma/src/runtime/assets.ts";
export function stateRootFindings(root) {
  const findings = [];
  for (const file of authoredFiles(root)) {
    if (file === STATE_ROOT_OWNER) continue;
    eachNode(sourceOf(root, file), node => {
      if (!ts.isCallExpression(node) || calleeName(node) !== "assertHostDirectoryLayout") return;
      const first = node.arguments[0];
      const named = first === undefined ? "" : ts.isIdentifier(first) ? first.text : ts.isPropertyAccessExpression(first) ? first.name.text : "";
      if (/stateRoot/i.test(named))
        findings.push(finding("state-root-judgement", file, `judges ${named} by its layout alone; a state root is judged by assertStateRoot`));
    });
  }
  return findings;
}
