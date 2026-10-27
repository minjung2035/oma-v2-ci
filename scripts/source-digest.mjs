// The identity of every authored or generated input whose bytes determine the
// local verification result.
//
// A commit says which revision was intended; it does not say which working-tree
// bytes were measured. Hashing only executable source is also insufficient:
// package scripts choose the gates, TypeScript options choose what they mean,
// normative/owner inventories choose what must be proven, and the production
// manifests and LOC records determine whether measurements describe this source.
//
// `docs/implementation/validation.md` is both a verification input and the output that
// records this digest. Its one digest field is normalized before hashing to
// break that self-reference; every other byte remains an input. Runtime logs
// and the generated adversarial report are outputs. The generated dependency
// graph is included because the architecture gate reads and compares its bytes.
// Importing this module measures nothing and writes nothing.
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { digest, sourceFiles } from "./traceability.mjs";
import { projectDocuments } from "./document-integrity.mjs";

export const VERIFICATION_INPUT_ROOTS = Object.freeze([
  "apps",
  "packages",
  "test",
  "scripts",
  "implementation",
  "docs",
  ".github/workflows",
  ".gitignore",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "tsconfig.architecture.json",
  "production-manifest.json",
  "production-files.txt",
  "production-loc-hashes.json",
]);

export const VERIFICATION_OUTPUT_EXCLUSIONS = Object.freeze([
  "implementation/evidence/runtime-tests.log",
  "docs/archive/adversarial-review.md",
]);
const EXCLUDED = new Set(VERIFICATION_OUTPUT_EXCLUSIONS);
const VALIDATION_DIGEST = /verification input digest `[0-9a-f]{64}` \(\d+ files\)/g;

function verificationBytes(root, file) {
  const bytes = readFileSync(join(root, file));
  if (file !== "docs/implementation/validation.md") return bytes;
  return Buffer.from(bytes.toString("utf8").replace(
    VALIDATION_DIGEST,
    "verification input digest `<self>` (<files> files)",
  ));
}

function implementationFiles(root) {
  const relative = "implementation";
  const path = join(root, relative);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("implementation verification root must be a directory, not a symlink");
  // `sourceFiles(root, "implementation")` intentionally omits evidence for the
  // compliance checker. Verification has a different closure: descend from
  // each child so the dependency graph is included, then remove only named
  // outputs. A new implementation input is included without editing this list.
  return readdirSync(path).sort()
    .flatMap(name => sourceFiles(root, `${relative}/${name}`))
    .filter(file => !EXCLUDED.has(file));
}

/** Real traversal, not a generated manifest: adding an input beneath a root
 * changes the closure without editing another list. `sourceFiles` rejects
 * symlinks, and duplicate paths are rejected instead of counted twice.
 */
export function verificationInputFiles(root = ".") {
  const files = VERIFICATION_INPUT_ROOTS
    .flatMap(relative => relative === "implementation"
      ? implementationFiles(root)
      : sourceFiles(root, relative))
    .filter(file => !EXCLUDED.has(file))
    .sort();
  if (new Set(files).size !== files.length)
    throw new Error("duplicate verification input path");
  // The document gate also discovers misplaced/untracked Markdown outside
  // these roots. Its findings are inputs too: adding a broken guide must not
  // leave the evidence bound to the previous tree. Use that gate's discovery
  // owner and the same symlink refusal as every other source input.
  const listed = new Set(files);
  for (const file of projectDocuments(root)) {
    if (!file.startsWith("docs/archive/") && !EXCLUDED.has(file) && !listed.has(file))
      files.push(...sourceFiles(root, file));
  }
  return files.sort();
}

export function verificationInputDigest(root = ".") {
  const files = verificationInputFiles(root);
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(`${file} ${digest(verificationBytes(root, file))}\n`);
  return { files: files.length, digest: hash.digest("hex") };
}

/** The same closure as a per-file digest map, for lane evidence that must say
 * which bytes it bound. Raw file bytes, not `verificationBytes`: a checker
 * re-reads the file as it stands and must get this digest (compliance.mjs).
 * A declared input that does not exist throws inside `verificationInputFiles`
 * rather than binding vacuously. */
export function verificationSourceDigests(root = ".") {
  const digests = {};
  for (const file of verificationInputFiles(root))
    digests[file] = digest(readFileSync(join(root, file)));
  return digests;
}
