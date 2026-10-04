// P0-8 / DR32: access to OMA-owned state assumes the state is damaged. A
// caller that creates, mutates or lists an OMA-owned tail with the plain fs
// calls -- or through the pre-P0-8 directory helpers that never repaired a
// stray's mode -- wedges exactly the way the store root, `.engine` and the
// package store did: a mode-000 entry left by a same-UID stray fails the open
// instead of being repaired inside its ownership boundary.
//
// The owned primitives (ensureOwnedDirectory, ensureOwnedDurableDirectory,
// ensureOwnedUserDirectory, openOwnedDirectory*, listOwnedDirectory,
// removeOwnedTree/File, repairOwnedEntryMode, ensureHostOwnedDirectory,
// removeHostStaged, listHostStaged, lockedOwnedReplace) repair every
// component from the caller's boundary down and refuse when repair or
// observation stays uncertain. This rule keeps new call sites on them:
//
//  - a path-taking filesystem mutation or a plain directory helper is allowed
//    only in the primitive owners, or in a file whose exemption says which
//    user-owned or outside-state path its calls name;
//  - a path-taking observation is flagged the same way when its argument
//    names an OMA-owned root (the state root, a data or run root, an agent or
//    engine directory, a store): an observation of OMA's own tree belongs to
//    the owned listing/probe primitives or carries a written reason its
//    refusal is honest.
//
// A descriptor argument, an `entryAt(...)` of a held parent, or a `new
// URL(...)` asset is not a path-taking call.
import ts from "typescript";
import { eachNode, filesUnder, finding, sourceOf } from "./shared.mjs";

/** Path-taking fs mutations: a name oma owns is created, changed or removed. */
const MUTATIONS = new Set([
  "renameSync", "unlinkSync", "rmSync", "rmdirSync", "mkdirSync", "copyFileSync", "cpSync", "symlinkSync", "linkSync",
  "truncateSync", "chmodSync", "chownSync", "utimesSync", "lutimesSync", "mkdtempSync", "createWriteStream",
  "appendFileSync", "writeFileSync", "openSync",
]);
/** Path-taking fs observations: a name oma owns is read, listed or probed. */
const OBSERVATIONS = new Set([
  "readdirSync", "opendirSync", "lstatSync", "statSync", "statfsSync", "existsSync", "accessSync",
  "readFileSync", "readlinkSync", "realpathSync", "globSync", "watch", "watchFile", "createReadStream", "openSync",
]);
/** The pre-P0-8 helpers that ensured or replaced without an owner repair. */
const PLAIN_HELPERS = new Set([
  "ensureDirectory", "ensureDurableDirectory", "ensureUserDirectory", "ensureContextDirectory", "lockedUserReplace",
]);

/** The designated owners of raw filesystem access -- the modules whose whole
 * job is being the primitive every other caller composes: the held-parent and
 * owned-repair layer, the durable write layer, the socket-name owner, the
 * user-file layer and the host's own publication layer. Anything they keep
 * raw is the primitive itself; anywhere else a path-taking call must be
 * answered by these modules or carry an exemption. */
export const OWNED_STATE_OWNERS = Object.freeze([
  "src/storage/directory.ts",
  "src/storage/durable-fs.ts",
  "src/storage/contained-fs.ts",
  "src/storage/socket-name.ts",
  "src/runtime/user-files.ts",
  "src/runtime/locked-files.ts",
  "src/platform/host/files.ts",
]);

/** Files whose remaining path-taking calls name a user-owned or otherwise
 * outside-state path, and why -- the audit table P0-8 keeps honest. Every
 * entry says the path the call touches is not an OMA-owned tail, or why the
 * plain call on it is already refused-and-reported. */
export const OWNED_STATE_EXEMPTIONS = Object.freeze({
  "src/broker/internal-dispatcher.ts": "the maildir `new` listing under the state root -- a failure refuses the request, never reads as empty; the directories are repaired by the broker's owned ensures",
  "src/cli/effects/submit.ts": "a fresh mkdtemp under the OS temp directory -- the CLI caller's own scratch, not oma state",
  "src/entry/guest-provision.ts": "the guest's own /proc/cmdline read and the chown of its data parts to the oma user -- deliberate ownership assignment, kernel paths are never repaired",
  "src/entry/guest-session.ts": "the session holder's own listening socket in the oma user's runtime directory -- chmod of the name oma just made is the point",
  "src/entry/oma-society.ts": "the principal-session listing under the state root whose failure already answers `said` -- it refuses to claim silence, and the runtime probe paths above it are the caller's own",
  "src/entry/omahostd.ts": "the support directory's chmod -- the leaf's mode is set outright after the owned ensure -- and the state disk's O_EXCL create under it",
  "src/extension/mail-tools.ts": "a fresh mkdtemp under the model's own working directory -- the extension's own scratch (PI-001 keeps it off the storage imports)",
  "src/git/context-repository.ts": "the context repository's own probes beside its owned ensures -- lstat answers the work tree's shape and a failure refuses loudly",
  "src/platform/guest/archive.ts": "the archive scratch mkdtemp inside the request ledger the guest owns -- ensured owned by the ledger's constructor",
  "src/platform/guest/egress.ts": "guesthost's own egress socket in the oma runtime directory -- chmod of the name oma just made is the point",
  "src/platform/guest/host.ts": "the guest's societies listing whose failure propagates as the request's refusal -- never read as empty",
  "src/platform/guest/linux-system.ts": "the guest's own /proc and /sys names and its societies listing -- kernel paths are never repaired; a listing failure refuses",
  "src/platform/guest/pty.ts": "the pseudo-terminal slave under /dev/pts this process just made -- a kernel path, never repaired",
  "src/platform/guest/server.ts": "the guest service's own listening socket in its systemd RuntimeDirectory -- chmod/chown of the name oma just made is the point",
  "src/platform/host/archive-crypto.ts": "the archive's own O_EXCL output under the archives directory the service's owned ensure repaired",
  "src/platform/host/guest-histories.ts": "the run token under the oma home read after the service's owned ensures, and the Human's own bookmarks -- resolved, never repaired",
  "src/platform/host/host-api.ts": "omahostd's own Host API socket under its run directory -- chmod of the name oma just made is the point",
  "src/platform/host/personal-seed.ts": "the run token under the oma home read after the service's owned ensures, and the Human's own bookmarks -- resolved, never repaired",
  "src/platform/host/project.ts": "the transfer file sink under the run directory the service's owned ensure repaired",
  "src/platform/host/service.ts": "the login token under the run directory and the socket chmod -- writes under directories the owned ensures already repaired",
  "src/platform/host/snapshot.ts": "the APFS clone between snapshot names under the directory the service's owned ensure repaired",
  "src/runtime/egress-forwarder.ts": "the forwarder's own socket in the run's run-root directory -- chmod of the name oma just made is the point (DR18, D-10)",
  "src/runtime/inference-relay.ts": "the relay's own socket in the run's run-root directory -- chmod of the name oma just made is the point",
  "src/runtime/process-lock.ts": "a lock file beside a directory its caller ensured owned -- the O_EXCL acquire refuses loudly",
  "src/runtime/provision.ts": "probes beside the owned ensures under the state root and the society layout -- a probe failure refuses, never reads as absent",
  "src/tui/project-settings.ts": "the `.projects` listing under the data root whose non-ENOENT failure already refuses to the Human",
  "src/units.ts": "the caller's own systemd user directory -- ~/.config/systemd/user is the user's, never repaired",
});


/** Identifiers whose use in a path-taking call's argument names an OMA-owned
 * root rather than a user path -- the owned tails this rule guards. */
const OWNED_ROOT_NAME = /^(?:stateRoot|dataRoot|worldDir|runRoot|agentDir|piAgentDir|agentHome|societiesDir|contextGit|projectGit|stagingRoot|stagingDir|archivesDir|snapshotsDir|packagesDir|storeDir|engineDir|sessionsDir|revisionsDir)$/;

/** A descriptor, not a path: `fd`, `this.fd`, `active.fd`, `temporaryFd`. */
const descriptorLike = node => {
  const text = ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : null;
  return text !== null && /(?:^|[a-z])fd$/i.test(text);
};
const heldEntry = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "entryAt";
const urlAsset = node => ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL";
const procDescriptor = node => ts.isTemplateExpression(node) && node.head.text.startsWith("/proc/self/fd/")
  || ts.isStringLiteralLike(node) && /^\/proc\/self\/fd\//.test(node.text);

const calleeName = node => ts.isIdentifier(node.expression) ? node.expression.text
  : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
const fsModuleCall = node => !ts.isPropertyAccessExpression(node.expression)
  || ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "fs";

/** `openSync` changes state only when its flags create, write or truncate. */
const writingOpen = node => {
  const flags = node.arguments[1];
  if (flags === undefined) return true; // an omitted mode on an omitted flag still names a path
  if (ts.isStringLiteralLike(flags)) return /[wa+]/.test(flags.text);
  return /\bO_(?:CREAT|WRONLY|RDWR|TRUNC|APPEND)\b/.test(flags.getText());
};

/** Does the expression mention an OMA-owned root identifier? */
const namesOwnedRoot = node => {
  let owned = false;
  eachNode(node, child => {
    if (owned) return;
    if (ts.isIdentifier(child) && OWNED_ROOT_NAME.test(child.text)) owned = true;
    if (ts.isPropertyAccessExpression(child) && OWNED_ROOT_NAME.test(child.name.text)) owned = true;
  });
  return owned;
};

/** `symlinkSync(target, path)` -- the first argument is link content, never a
 * path it touches; the created name is the second, held through `entryAt`. */
const touchedArgument = node => node.expression.text === "symlinkSync" ||
  ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "symlinkSync"
  ? node.arguments[1] ?? null : node.arguments[0] ?? null;

export function ownedStateFindings(root) {
  const findings = [];
  for (const file of filesUnder(root, "src")) {
    if (OWNED_STATE_OWNERS.includes(file)) continue;
    const exempted = Object.hasOwn(OWNED_STATE_EXEMPTIONS, file);
    let flagged = 0;
    eachNode(sourceOf(root, file), node => {
      if (!ts.isCallExpression(node)) return;
      const name = calleeName(node);
      if (name === null || !fsModuleCall(node)) return;
      if (PLAIN_HELPERS.has(name)) {
        // A plain helper is a path-taking call by definition; its path is the
        // first argument whatever it looks like.
        if (node.arguments[0] === undefined) return;
        flagged += 1;
        if (!exempted)
          findings.push(finding("owned-state-plain-helper", file,
            `${name} ensures without an owner repair; on an OMA-owned tail use the owned variant, or write down which user path this names`));
        return;
      }
      const touched = touchedArgument(node);
      const first = touched === null ? null : heldEntry(touched) || descriptorLike(touched) || urlAsset(touched) || procDescriptor(touched) ? null : touched;
      if (first === null) return;
      if (MUTATIONS.has(name)) {
        if (name === "openSync" && !writingOpen(node)) { /* read probes are observations */ }
        else {
          flagged += 1;
          if (!exempted)
            findings.push(finding("owned-state-raw-access", file,
              `${name} names a path; OMA-owned tails go through the owned primitives (or the file says whose user path this is)`));
          return;
        }
      }
      if (OBSERVATIONS.has(name) && namesOwnedRoot(first)) {
        flagged += 1;
        if (!exempted)
          findings.push(finding("owned-state-raw-observation", file,
            `${name} observes an OMA-owned root; list or probe it through the owned primitives, or write down why this refusal is honest`));
      }
    });
    if (exempted && flagged === 0)
      findings.push(finding("owned-state-exemption-stale", file,
        "exempted from the owned-state rule and nothing in the file needs it -- remove the entry so the file is guarded again"));
  }
  return findings;
}
