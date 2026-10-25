// P0-8 / DR32: access to OMA-owned state assumes the state is damaged. A
// caller that creates, mutates or lists an OMA-owned tail with the plain fs
// calls -- or through the pre-P0-8 directory helpers that never repaired a
// stray's mode -- wedges exactly the way the store root, `.engine` and the
// package store did: a mode-000 entry left by a same-UID stray fails the open
// instead of being repaired inside its ownership boundary.
//
// The owned primitives (ensureOwnedDirectory, ensureOwnedDurableDirectory,
// ensureOwnedUserDirectory, openOwnedDirectory*, listOwnedDirectory,
// removeOwnedTree/File, repairOwnedEntryMode, lockedOwnedReplace) repair every
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
//
// What counts as an fs call is resolved by binding, not by spelling: the
// `node:fs` surface (`writeFileSync` and kin, `fs.writeFileSync`, and the
// callback spellings `fs.writeFile`/`writeFile` that answer the same effect
// asynchronously) is trusted only where the callee is actually bound to
// "node:fs", and the async surface (`open`, `readdir`, `rm` -- ordinary
// words a local function may carry) is trusted only where the callee is
// bound to "node:fs/promises": a named or namespace or default import --
// `import { default as fs }` spells the namespace, not a member named
// "default" -- an `fs.promises.*` reach-through, a `promises` named import
// or alias, a destructured binding, an `await import(...)`, an import-equals
// require, or a second local name for any of them (`const f = writeFileSync`,
// `const w = fs.writeFileSync`). A same-named local function is never an fs
// call here.
//
// Observation provenance starts at OWNED_ROOT_NAME bindings and follows
// string aliases, assignments and resolved local callee parameters across
// files. Generic names retain that provenance; distinct symbols do not share
// it. Dynamically computed call targets remain outside this static proof.
// The mutation arm audits the file's whole surface regardless of names.
// An owned tail in new code should travel under
// an owned name, and a rename of one into a generic identifier hides it from
// this arm -- the written answer for that is the exemption table, not the
// rename.
import ts from "typescript";
import path from "node:path";
import { authoredFiles, eachNode, filesUnder, finding } from "./shared.mjs";
import { installWorkspaceSourceResolution } from "../../dependency-graph.mjs";

/** Path-taking fs mutations: a name oma owns is created, changed or removed.
 * The `node:fs` module carries the same effects twice -- the `*Sync` spelling
 * and the callback spelling (`fs.writeFile` is `writeFileSync` whose answer
 * is a callback), and an owned tail named through either is the same raw
 * access -- so this surface holds both. */
const MUTATIONS = new Set([
  "renameSync", "unlinkSync", "rmSync", "rmdirSync", "mkdirSync", "copyFileSync", "cpSync", "symlinkSync", "linkSync",
  "truncateSync", "chmodSync", "chownSync", "utimesSync", "lutimesSync", "mkdtempSync", "createWriteStream",
  "appendFileSync", "writeFileSync", "openSync",
  "appendFile", "chmod", "chown", "copyFile", "cp", "lchmod", "lchown", "link", "lutimes", "mkdir", "mkdtemp",
  "open", "rename", "rm", "rmdir", "symlink", "truncate", "unlink", "utimes", "writeFile",
]);
/** Path-taking fs observations: a name oma owns is read, listed or probed --
 * `*Sync` and callback spellings alike. */
const OBSERVATIONS = new Set([
  "readdirSync", "opendirSync", "lstatSync", "statSync", "statfsSync", "existsSync", "accessSync",
  "readFileSync", "readlinkSync", "realpathSync", "globSync", "watch", "watchFile", "createReadStream", "openSync",
  "access", "exists", "glob", "lstat", "opendir", "readdir", "readFile", "readlink", "realpath", "stat", "statfs", "open",
]);
/** The same two sets for the `node:fs/promises` surface -- the promise of an
 * `open` writes or observes exactly the way `openSync`'s flags spell it. */
const ASYNC_MUTATIONS = new Set([
  "rename", "unlink", "rm", "rmdir", "mkdir", "copyFile", "cp", "symlink", "link", "truncate", "chmod", "chown",
  "lchmod", "lchown", "utimes", "lutimes", "mkdtemp", "appendFile", "writeFile", "open",
]);
const ASYNC_OBSERVATIONS = new Set([
  "readdir", "opendir", "lstat", "stat", "statfs", "access", "readFile", "readlink", "realpath", "glob", "watch", "open",
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
  "packages/storage/src/directory.ts",
  "packages/storage/src/durable-fs.ts",
  "packages/native/src/files.ts",
  "packages/storage/src/socket-name.ts",
  "apps/oma/src/runtime/user-files.ts",
  "apps/oma/src/runtime/locked-files.ts",
  "packages/platform-mac/src/files.ts",
  // The per-store owners: the only modules that may touch their owned tail
  // raw, because their calls are the store's own protocol -- the package
  // store's stage/prune/index walk, the archive's format reads under the
  // store it is handed, the managed tail's generation accounting, and the
  // Mac store's whole-generation publish path (structural twin of the Linux
  // staging owner; executed only on the Mac side).
  "apps/oma/src/runtime/packages/store.ts",
  "apps/oma/src/application/local-packages.ts",
  "apps/oma/src/platform/package-staging.ts",
  "packages/config/src/generations.ts",
  "apps/oma/src/application/packages-apply.ts",
  "apps/oma/src/platform/package-archive.ts",
]);

/** Files whose remaining path-taking calls name a user-owned or otherwise
 * outside-state path, and why -- the audit table P0-8 keeps honest. Every
 * entry says the path the call touches is not an OMA-owned tail, or why the
 * plain call on it is already refused-and-reported. */
export const OWNED_STATE_EXEMPTIONS = Object.freeze({
  "packages/git/src/host-project.ts": "MacGit.run creates its own output-spool scratch with mkdtemp under the OS temp directory and removes that same scratch after the bounded Git command; metadata-only reads inspect the Human repository, never repair or rewrite its ancestors",
  "packages/storage/src/mail-notices.ts": "read-only Human observation of a bounded broker projection; no-follow descriptor reads report missing, malformed or unreadable metadata explicitly and never repair state without broker ownership",
  "packages/storage/src/published-mail.ts": "read-only publication-link inventory for Human mail and broker projection; metadata probes reject links, report unreadable directories and never turn observation into permission repair",

  "packages/config/src/operations.ts": "the Human-authored configuration closure and explicitly selected extension assets: canonical-path and content checks refuse unreadable inputs, never repair or rewrite the Human's source",
  "apps/oma/src/entry/personal-host.ts": "read-only birth/config metadata and the Human's actual cwd; the host owns no project permission repair and a failed probe refuses the launch",
  "packages/git/src/workspace.ts": "a metadata-only .git existence probe after owned staging preparation; the workspace's Git validation supplies the authoritative result, never a false absence on a failed open",
  "apps/oma/src/engine/settings-files.ts": "only Personal's trusted project scope ensures the Human's .pi directory; OMA's global scope uses lockedOwnedReplace and never rewrites project ancestor permissions",
  "packages/platform-mac/src/record.ts": "read-only host-record decoding before a controller's ownership decision; a read failure refuses startup and never creates a replacement identity",
  "packages/storage/src/preaccept-collection.ts": "metadata probes after owned directory repair during lease-authorized collection; lstat needs no leaf read bits, and failures retain artifacts rather than authorizing collection",
  "apps/oma/src/runtime/assets.ts": "installation pin validation and a filesystem-type probe that may ascend into the Human's existing ancestors; unreadable assets refuse, never alter the pinned installation or user directories",
  "apps/oma/src/runtime/personal-settings.ts": "metadata distinguishes an oversized regular settings file after the bounded user-file reader refused it; external configured extension metadata is validated without repairing the Human's files",
  "packages/storage/src/context-snapshot.ts": "immutable revision verification deliberately checks fixed modes rather than repairing them; publication's existence probe names the already prepared owned destination",
  "packages/storage/src/staged-tree.ts": "the held-parent publication primitive's metadata probes; staged/final shape and durability are validated before adoption and unknown observations never authorize replacement",
  "packages/storage/src/store.ts": "read-only SQLite diagnostics and sidecar identity probes deliberately perform no permission repair, writes or owner takeover; unreadable state refuses the diagnostic",
  "apps/oma/src/application/settings.ts": "metadata-only configuration existence probes after source layout validation; an inaccessible existing source propagates an error instead of being treated as absent",
  "apps/oma/src/application/status-observation.ts": "best-effort read-only status view observation: a failed open is displayed as unavailable and never grants broker authority or permits mutation",
  "apps/oma/src/cli/effects/submit.ts": "a fresh mkdtemp under the OS temp directory -- the CLI caller's own scratch, not oma state",
  "apps/oma/src/application/society-transition.ts": "the principal-session listing under the state root whose failure already answers `said` -- it refuses to claim silence, and the runtime probe paths above it are the caller's own",
  "packages/tool-lsp/src/lsp-call-scope.ts": "a fresh mkdtemp under the OS temp directory -- the LSP child's own per-call scratch (HOME/XDG/TMP redirection), removed when the call ends; never an OMA-owned tail and never a user path (PI-001 keeps the extension off the storage imports)",
  "packages/tool-mcp/src/index.ts": "the MCP adapter's own state dir under the engine's agent dir -- ensure/chmod of the state root and scratch it just made, the oauth-file-key write, and the scratch/session rm -- engine-owned tails the adapter owns and rotates (PI-001 keeps the extension off the storage imports)",
  "packages/extension/src/mail-tools.ts": "a fresh mkdtemp under the model's own working directory -- the extension's own scratch (PI-001 keeps it off the storage imports)",
  "packages/tool-runtime/src/contained-search.ts": "the private snapshot's announced-name sweep under the OS temp directory; the complete-result spool is written by the serialized contained writer in contained-tools.ts, not here (PI-001 keeps the extension off the storage imports)",
  "packages/git/src/context-repository.ts": "the context repository's own probes beside its owned ensures -- lstat answers the work tree's shape and a failure refuses loudly",
  "packages/git/src/canonical-command.ts": "fresh mkdtemp directories under the OS temp directory -- the ls-tree and merge-tree output spool scratch, removed in the same call; never an OMA-owned tail",
  "packages/extension/src/index.ts": "the store root's realpath into the sandbox's read admissions -- a failure closes the admission (the store permits nothing), never opens it",
  "packages/native/src/pty.ts": "the pseudo-terminal slave under /dev/pts this process just made -- a kernel path, never repaired",
  "packages/platform-mac/src/archive-crypto.ts": "the archive's own O_EXCL output under the archives directory the service's owned ensure repaired",
  "apps/oma/src/runtime/egress-forwarder.ts": "the forwarder's own socket in the run's run-root directory -- chmod of the name oma just made is the point (DR18, D-10)",
  "apps/oma/src/runtime/connect-proxy.ts": "the delivery proxy's own socket beside the run's lease socket -- chmod of the name oma just made is the point (DR34)",
  "apps/oma/src/runtime/inference-relay.ts": "the relay's own socket in the run's run-root directory -- chmod of the name oma just made is the point",
  "packages/native/src/process-lock.ts": "a lock file beside a directory its caller ensured owned -- the O_EXCL acquire refuses loudly",
  "apps/oma/src/runtime/provision.ts": "probes beside the owned ensures under the state root and the society layout -- a probe failure refuses, never reads as absent",
  "apps/oma/src/application/project-settings.ts": "the `.projects` listing under the data root whose non-ENOENT failure already refuses to the Human",
  "apps/oma/src/application/mail.ts": "the mailbox's journal and message reads under the state root -- an open or listing failure is rendered as the row's `unreadable` marker, never read as absent (arch §23.5)",
  "packages/process/src/async.ts": "the caller-declared spool paths -- absolute paths each caller names under its own scratch or ledger directory; the runner opens what it was told to write",
  "packages/process/src/run.ts": "the same caller-declared spool paths opened for the child's descriptors -- the runner opens what it was told to write",
});


/** Identifiers whose use in a path-taking call's argument names an OMA-owned
 * root rather than a user path -- the owned tails this rule guards. Besides
 * the layout roots the first arm listed, it carries the names the stores and
 * stage code actually hold them under: `store` (the `.packages` store and the
 * snapshot store alike), `generations`, the stage's `local`/`dest`/`staged`,
 * the project `mirror`, the maildir `journal`, a realpath's `real`. The bound
 * stays the header's: a generic `path`/`dir`/`root` cannot be told apart from
 * a user path by name, and is left to the mutation arm and the file's own
 * honesty. */
const OWNED_ROOT_NAME = /^(?:stateRoot|dataRoot|worldDir|runRoot|agentDir|piAgentDir|agentHome|societiesDir|contextGit|projectGit|stagingRoot|stagingDir|archivesDir|snapshotsDir|packagesDir|storeDir|engineDir|sessionsDir|revisionsDir|store|storeRoot|storePath|packageStore|packagesStore|generations|generationsDir|local|localDir|dest|destPath|destDir|staged|staging|mirror|journal|maildir|dataDir|real)$/;

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

/** The fs-module bindings a file spells. The rule trusts a path-taking name
 * only where the callee is actually bound to "node:fs" or
 * "node:fs/promises" -- a same-named local function or an object with an
 * `open` method is never an fs call -- so `bare(x)` resolves through the
 * file's named imports and `through.name(x)` through a namespace binding:
 * `import * as fsp`, a default import, `fs.promises.*`, `import { promises }`
 * or an alias of it, `const { open } = fs.promises` and
 * `const { open } = await import("node:fs/promises")`. */
const collectFsBindings = source => {
  const fsNamespaces = new Set();      // bound to "node:fs" itself
  const asyncNamespaces = new Set();   // bound to "node:fs/promises" or to `x.promises`
  const syncNames = new Map();         // local -> remote, a named node:fs import
  const asyncNames = new Map();        // local -> remote, a named node:fs/promises import
  const isFsSpec = text => text === "node:fs" || text === "fs";
  const isAsyncSpec = text => text === "node:fs/promises" || text === "fs/promises";
  const promisesMember = node => ts.isPropertyAccessExpression(node) && node.name.text === "promises"
    && ts.isIdentifier(node.expression) && fsNamespaces.has(node.expression.text);
  const dynamicImport = node => {
    const inner = ts.isAwaitExpression(node) ? node.expression : node;
    return ts.isCallExpression(inner) && inner.expression.kind === ts.SyntaxKind.ImportKeyword
      && inner.arguments[0] !== undefined && ts.isStringLiteralLike(inner.arguments[0])
      ? inner.arguments[0].text : null;
  };
  const bindNamespace = (name, spec) => {
    if (isAsyncSpec(spec)) asyncNamespaces.add(name);
    else if (isFsSpec(spec)) fsNamespaces.add(name);
  };
  // Pass 1: the import statements -- everything else resolves against them.
  for (const statement of source.statements) {
    // `import fs = require("node:fs")` binds the namespace all the same.
    if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) &&
        ts.isStringLiteralLike(statement.moduleReference.expression) && !statement.isTypeOnly) {
      bindNamespace(statement.name.text, statement.moduleReference.expression.text);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const spec = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    if (clause.name !== undefined) bindNamespace(clause.name.text, spec);
    const bound = clause.namedBindings;
    if (bound === undefined) continue;
    if (ts.isNamespaceImport(bound)) { bindNamespace(bound.name.text, spec); continue; }
    if (!ts.isNamedImports(bound)) continue;
    for (const element of bound.elements) {
      if (element.isTypeOnly) continue;
      const remote = element.propertyName !== undefined ? element.propertyName.text : element.name.text;
      // `import { default as fs }` spells the namespace import: the
      // module's default is the namespace itself, not a member named
      // "default" -- `fs.writeFileSync` still calls the fs surface.
      if (isAsyncSpec(spec)) {
        if (remote === "default") asyncNamespaces.add(element.name.text);
        else asyncNames.set(element.name.text, remote);
      } else if (isFsSpec(spec)) {
        if (remote === "default") fsNamespaces.add(element.name.text);
        else if (remote === "promises") asyncNamespaces.add(element.name.text);
        else syncNames.set(element.name.text, remote);
      }
    }
  }
  // Pass 2, to a fixed point: `const fsp = fs.promises` / `const fsp = promises`,
  // `const { open } = fs.promises` / `await import("node:fs/promises")` and
  // aliases of a namespace or a member already bound -- an alias may name an
  // alias, and `const f = writeFileSync` or `const w = fs.writeFileSync` calls
  // the same fs write under a second local name.
  //
  // Every branch below is first-wins: a name once bound is never rebound.
  // That is what makes the fixed point exist at all -- the maps are keyed by
  // the local name and know no scope, so two scopes binding one alias to
  // different remotes (`const w = writeFileSync` here, `= readFileSync`
  // there) would flip the entry every pass and the check would never answer.
  // A deny rule resolving the alias to either of its remotes is safe: both
  // name the fs surface, so the call is flagged either way. A pass that
  // still grows adds at least one binding no earlier pass had, so the
  // number of passes is bounded by the declarations that can bind; a pass
  // beyond that is this rule's own defect, and it throws rather than hang.
  let sites = 0;
  eachNode(source, node => {
    if (ts.isVariableDeclaration(node))
      sites += ts.isIdentifier(node.name) ? 1 : ts.isObjectBindingPattern(node.name) ? node.name.elements.length : 0;
  });
  let grew = true;
  let passes = 0;
  while (grew) {
    // A declaration binds at most a namespace and a sync and an async name,
    // so `2 * sites` growing passes already spend every binding there is;
    // one more pass is the settling pass, and a pass beyond it is impossible.
    passes += 1;
    if (passes > 2 * sites + 1)
      throw new Error(`owned-state rule: fs alias bindings reached no fixed point after ${passes - 1} passes in ${source.fileName}`);
    grew = false;
    eachNode(source, node => {
      if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return;
      const init = node.initializer;
      const initIsPromises = promisesMember(init) || (ts.isIdentifier(init) && asyncNamespaces.has(init.text));
      const initIsFs = ts.isIdentifier(init) && fsNamespaces.has(init.text);
      const imported = dynamicImport(init);
      if (ts.isIdentifier(node.name)) {
        if ((initIsPromises || imported !== null && isAsyncSpec(imported)) && !asyncNamespaces.has(node.name.text)) {
          asyncNamespaces.add(node.name.text); grew = true;
        } else if ((initIsFs || imported !== null && isFsSpec(imported)) && !fsNamespaces.has(node.name.text)) {
          fsNamespaces.add(node.name.text); grew = true;
        } else {
          // A member of a bound namespace -- or one of its named imports --
          // bound under a second name still resolves to the remote spelling:
          // `const f = writeFileSync`, `const w = fs.writeFileSync`,
          // `const o = fs.promises.open`.
          const memberRemote = namespaces => ts.isPropertyAccessExpression(init) &&
            init.name.text !== "promises" && ts.isIdentifier(init.expression) && namespaces.has(init.expression.text)
            ? init.name.text : undefined;
          const syncRemote = ts.isIdentifier(init) ? syncNames.get(init.text) : memberRemote(fsNamespaces);
          const asyncRemote = ts.isIdentifier(init) ? asyncNames.get(init.text)
            : ts.isPropertyAccessExpression(init) && promisesMember(init.expression) ? init.name.text : memberRemote(asyncNamespaces);
          // First-wins, like the namespace and binding-pattern branches: the
          // name is the key, not the scope, so a second binding of it is a
          // different declaration's answer -- kept for whichever wrote first.
          if (syncRemote !== undefined && !syncNames.has(node.name.text)) {
            syncNames.set(node.name.text, syncRemote); grew = true;
          } else if (asyncRemote !== undefined && !asyncNames.has(node.name.text)) {
            asyncNames.set(node.name.text, asyncRemote); grew = true;
          }
        }
        return;
      }
      if (!ts.isObjectBindingPattern(node.name)) return;
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const remote = element.propertyName !== undefined && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text : element.name.text;
        const local = element.name.text;
        if (initIsPromises || imported !== null && isAsyncSpec(imported)) {
          if (!asyncNames.has(local)) { asyncNames.set(local, remote); grew = true; }
        } else if (initIsFs || imported !== null && isFsSpec(imported)) {
          if (remote === "promises") { if (!asyncNamespaces.has(local)) { asyncNamespaces.add(local); grew = true; } }
          else if (!syncNames.has(local)) { syncNames.set(local, remote); grew = true; }
        }
      }
    });
  }
  return { fsNamespaces, asyncNamespaces, syncNames, asyncNames };
};

/** The fs call a call expression actually is, resolved through the file's
 * bindings: `{ name, isAsync }`, or null when the callee names nothing the
 * fs modules export under that spelling. */
const resolveFsCall = (node, bindings) => {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) {
    const remote = bindings.syncNames.get(expression.text);
    if (remote !== undefined) return { name: remote, isAsync: false };
    const asyncRemote = bindings.asyncNames.get(expression.text);
    if (asyncRemote !== undefined) return { name: asyncRemote, isAsync: true };
    return null;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const through = expression.expression;
    const name = expression.name.text;
    if (ts.isIdentifier(through)) {
      if (bindings.fsNamespaces.has(through.text)) return { name, isAsync: false };
      if (bindings.asyncNamespaces.has(through.text)) return { name, isAsync: true };
      return null;
    }
    // `fs.promises.open(...)` reaches the promise surface through the module.
    if (ts.isPropertyAccessExpression(through) && through.name.text === "promises" &&
        ts.isIdentifier(through.expression) && bindings.fsNamespaces.has(through.expression.text))
      return { name, isAsync: true };
  }
  return null;
};

/** `openSync`/`open` change state only when their flags create, write or
 * truncate; a read-only open is an observation. */
const writingOpen = node => {
  const flags = node.arguments[1];
  if (flags === undefined) return true; // an omitted mode on an omitted flag still names a path
  if (ts.isStringLiteralLike(flags)) return /[wa+]/.test(flags.text);
  return /\bO_(?:CREAT|WRONLY|RDWR|TRUNC|APPEND)\b/.test(flags.getText());
};

/** Does the expression mention an OMA-owned root identifier? */
const namesOwnedRoot = (node, tainted = new Set(), checker) => {
  let owned = false;
  eachNode(node, child => {
    if (owned) return;
    if (ts.isIdentifier(child) && OWNED_ROOT_NAME.test(child.text)) owned = true;
    if (ts.isPropertyAccessExpression(child) && OWNED_ROOT_NAME.test(child.name.text)) owned = true;
    if (checker && ts.isIdentifier(child) && tainted.has(checker.getSymbolAtLocation(child))) owned = true;
  });
  return owned;
};

/** Follow owned arguments into local callees and aliases by symbol, including
 * cross-file imports. Generic root/path/dir names do not erase provenance. */
function ownedProvenance(sources, checker) {
  const tainted = new Set();
  const edges = [];
  const pathSymbol = symbol => {
    if (!symbol) return false;
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) return false;
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const scalar = item => (item.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
    return type.isUnion() ? type.types.some(scalar) : scalar(type);
  };
  const bind = (name, expression) => {
    eachNode(name, child => {
      if (ts.isIdentifier(child)) {
        const symbol = checker.getSymbolAtLocation(child);
        if (pathSymbol(symbol)) edges.push({ symbol, expression });
      }
    });
  };
  const sourceSet = new Set(sources);
  for (const source of sources) eachNode(source, node => {
    if (ts.isIdentifier(node) && OWNED_ROOT_NAME.test(node.text)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (pathSymbol(symbol)) tainted.add(symbol);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) bind(node.name, node.initializer);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) bind(node.left, node.right);
    if (ts.isCallExpression(node)) {
      const declaration = checker.getResolvedSignature(node)?.declaration;
      if (!declaration || !sourceSet.has(declaration.getSourceFile())) return;
      for (const [index, parameter] of (declaration.parameters ?? []).entries())
        if (node.arguments[index]) bind(parameter.name, node.arguments[index]);
    }
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (const { symbol, expression } of edges) if (!tainted.has(symbol) && namesOwnedRoot(expression, tainted, checker)) {
      tainted.add(symbol); changed = true;
    }
  }
  return tainted;
}

/** Calls that touch two paths at once (rename/link/copy name both ends);
 * `symlink`'s first argument is link content, never a path it touches. */
const TWO_PATHS = new Set(["renameSync", "rename", "linkSync", "link", "copyFileSync", "copyFile", "cpSync", "cp"]);
const SYMLINK = new Set(["symlinkSync", "symlink"]);

/** The call's path arguments: every name it touches on the filesystem, less
 * the arguments that name something else -- a held `entryAt`, a descriptor, a
 * URL asset, a `/proc/self/fd` name. A call whose arguments are all of those
 * touches no path. */
const touchedArguments = (node, name) =>
  node.arguments.slice(SYMLINK.has(name) ? 1 : 0, SYMLINK.has(name) || TWO_PATHS.has(name) ? 2 : 1)
    .filter(argument => !(heldEntry(argument) || descriptorLike(argument) || urlAsset(argument) || procDescriptor(argument)));

export function ownedStateFindings(root) {
  const findings = [];
  const files = authoredFiles(root);
  const options = {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true, noEmit: true,
  };
  const program = ts.createProgram({ rootNames: files.map(file => path.resolve(root, file)), options,
    host: installWorkspaceSourceResolution(ts.createCompilerHost(options), options, root) });
  const sources = files.map(file => program.getSourceFile(path.resolve(root, file)));
  const checker = program.getTypeChecker();
  const tainted = ownedProvenance(sources, checker);
  for (const [index, file] of files.entries()) {
    if (OWNED_STATE_OWNERS.includes(file)) continue;
    const exempted = Object.hasOwn(OWNED_STATE_EXEMPTIONS, file);
    const source = sources[index];
    const bindings = collectFsBindings(source);
    let flagged = 0;
    eachNode(source, node => {
      if (!ts.isCallExpression(node)) return;
      const name = calleeName(node);
      if (name === null) return;
      if (PLAIN_HELPERS.has(name) && fsModuleCall(node)) {
        // A plain helper is a path-taking call by definition; its path is the
        // first argument whatever it looks like.
        if (node.arguments[0] === undefined) return;
        flagged += 1;
        if (!exempted)
          findings.push(finding("owned-state-plain-helper", file,
            `${name} ensures without an owner repair; on an OMA-owned tail use the owned variant, or write down which user path this names`));
        return;
      }
      const resolved = resolveFsCall(node, bindings);
      if (resolved === null) return;
      const touched = touchedArguments(node, resolved.name);
      if (touched.length === 0) return;
      const mutations = resolved.isAsync ? ASYNC_MUTATIONS : MUTATIONS;
      const observations = resolved.isAsync ? ASYNC_OBSERVATIONS : OBSERVATIONS;
      if (mutations.has(resolved.name)) {
        if ((resolved.name === "openSync" || resolved.name === "open") && !writingOpen(node)) { /* read opens are observations */ }
        else {
          flagged += 1;
          if (!exempted)
            findings.push(finding("owned-state-raw-access", file,
              `${resolved.name} names a path; OMA-owned tails go through the owned primitives (or the file says whose user path this is)`));
          return;
        }
      }
      if (observations.has(resolved.name) && touched.some(argument => namesOwnedRoot(argument, tainted, checker))) {
        flagged += 1;
        if (!exempted)
          findings.push(finding("owned-state-raw-observation", file,
            `${resolved.name} observes an OMA-owned root; list or probe it through the owned primitives, or write down why this refusal is honest`));
      }
    });
    if (exempted && flagged === 0)
      findings.push(finding("owned-state-exemption-stale", file,
        "exempted from the owned-state rule and nothing in the file needs it -- remove the entry so the file is guarded again"));
  }
  return findings;
}
