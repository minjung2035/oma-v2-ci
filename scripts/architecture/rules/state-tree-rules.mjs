// FS-005 / architecture §4: every change under the state tree resolves its parent
// directory once and names the entry through that resolution. A path-taking fs
// mutation is therefore allowed only in the primitives that do the resolving,
// through `entryAt(...)` of a held directory, on a descriptor, or in a file
// whose effects are outside the state tree -- each such file says why.
import ts from "typescript";
import { eachNode, filesUnder, finding, sourceOf } from "./shared.mjs";

const MUTATIONS = new Set([
  "renameSync", "unlinkSync", "rmSync", "rmdirSync", "mkdirSync", "copyFileSync", "symlinkSync", "linkSync",
  "truncateSync", "chmodSync", "cpSync", "mkdtempSync", "createWriteStream", "appendFileSync", "writeFileSync", "openSync",
]);
/** The resolving primitives themselves. */
export const STATE_TREE_PRIMITIVES = Object.freeze([
  "src/storage/contained-fs.ts", "src/storage/directory.ts", "src/storage/durable-fs.ts",
]);
/** Files whose path-taking mutations are outside the state tree, and why. */
export const OUTSIDE_STATE_TREE = Object.freeze({
  "src/broker.ts": "the run root (XDG_RUNTIME_DIR): its directory and the listening sockets",
  "src/entry/broker.ts": "the run root (XDG_RUNTIME_DIR) the broker listens in",
  "src/runtime/inference-relay.ts": "the relay's socket in the run's own run-root directory",
  "src/runtime/egress-forwarder.ts": "the egress forwarder's socket beside the relay's, in the run's run-root directory (DR18, D-10)",
  "src/platform/guest/server.ts": "a guest service's listening socket in its own systemd RuntimeDirectory, which the vsock bridge connects to",
  "src/platform/guest/pty.ts": "the slave device of a pseudo-terminal this process just made (/dev/pts), opened to hand to the session's program",
  "src/platform/guest/egress.ts": "guesthost's egress socket in the oma user's runtime directory, which the guest's own processes connect to",
  "src/platform/host/host-api.ts": "omahostd's Host API socket in its own run directory under the app's support directory",
  "src/platform/host/record.ts": "the Mac host's own record in the app's support directory, outside any society's state tree",
  "src/platform/host/service.ts": "omahostd's login token in its own run directory under the app's support directory",
  "src/entry/omahostd.ts": "the Mac host's support directory and its sparse state disk image, outside any society's state tree",
  "src/platform/guest/provision.ts": "the guest's data disk mount point, before any society's state tree exists on it",
  "src/entry/guest-provision.ts": "the guest's data disk mount point and its top-level parts, made once at the first boot",
  "src/platform/host/project.ts": "the Mac host's transfer files in its own run directory, outside any society's state tree",
  "src/platform/host/snapshot.ts": "the Mac host's snapshots directory beside the state disk image, outside any society's state tree",
  "src/platform/guest/archive.ts": "a scratch directory in guesthost's request ledger for an archive's manifest, removed when the archive is made; no society's tree is written",
  "src/platform/host/archive-crypto.ts": "the Mac host's archive files in its own support directory, outside any society's state tree",
  "src/entry/guest-session.ts": "a society session holder's listening socket in the oma user's runtime directory, which guesthost connects to",
  "src/cli/effects/submit.ts": "the CLI caller's own temporary directory",
  "src/extension/mail-tools.ts": "a fresh mkdtemp directory under the model's own working directory (a Resident's sandbox home; the Principal's scratch, in the state tree but the model's own), written once and removed; the extension cannot import the storage primitives (PI-001)",
  "src/extension/principal-tools.ts": "the same fresh mkdtemp directory under the Principal's scratch for an agent brief, written once and removed (PI-001)",
  "src/runtime/process-lock.ts": "the broker's lock file, which both callers keep in the run root",
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
  for (const file of filesUnder(root, "src")) {
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
