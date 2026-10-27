/** Bundled-extension integrity: the vendored payload under
 * `src/extension/vendor/<pkg>/` is verified against its own
 * `manifest.json` before any of it is offered as a tool.
 *
 * The manifest is the bundle's self-description: the upstream package
 * identity (name, version, source commit, npm tarball integrity/shasum)
 * and a sorted list of every file with its byte count and SHA-256, bound
 * by a whole-bundle digest over the (path, sha256) pairs. Verification is
 * exact-set: a missing file, a changed byte, an unlisted file, a symlink,
 * or a digest mismatch are all the same refusal — the bundle does not
 * degrade, it fails closed.
 *
 * This module is OMA-authored and PI-001-clean: Node built-ins only, no
 * OMA runtime import, no network, no package manager. The same check runs
 * identically on the host and inside a Resident's sandbox. A second,
 * coarser pin is the deployment digest over all of dist/, asserted by the
 * broker before it grants Society authority; this one is the per-bundle check the
 * extension itself can make where no broker armed a digest.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export class VendorIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "VendorIntegrityError"; }
}

export interface VendorManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface VendorVerification {
  readonly package: string;
  readonly version: string;
  readonly commit: string;
  readonly files: number;
  readonly bundleSha256: string;
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Every regular file under the bundle root except the manifest, sorted;
 * the manifest indexes this set and is never a member of it. */
function bundleFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const relative = absolute.slice(root.length + 1).split("\\").join("/");
      if (entry.isDirectory()) walk(absolute);
      else if (relative !== "manifest.json") {
        if (!entry.isFile()) throw new VendorIntegrityError(`vendored bundle has a linked or special entry: ${relative}`);
        out.push(relative);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Parse and shape-check the manifest. Anything that is not exactly the
 * v1 shape is a verification failure, never a degraded read. */
function readManifest(root: string): { files: VendorManifestFile[]; bundleSha256: string; pkg: { name: string; version: string; commit: string } } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  } catch (error) {
    throw new VendorIntegrityError(`vendored bundle manifest is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new VendorIntegrityError("vendored bundle manifest is not an object");
  const manifest = parsed as Record<string, unknown>;
  if (manifest.kind !== "oma-vendored-bundle-v1")
    throw new VendorIntegrityError("vendored bundle manifest kind is not oma-vendored-bundle-v1");
  const pkg = manifest.package as Record<string, unknown> | undefined;
  if (pkg === undefined || typeof pkg.name !== "string" || typeof pkg.version !== "string" || typeof pkg.commit !== "string")
    throw new VendorIntegrityError("vendored bundle manifest lacks package identity");
  if (!Array.isArray(manifest.files) || typeof manifest.bundleSha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.bundleSha256))
    throw new VendorIntegrityError("vendored bundle manifest has no file list or bundle digest");
  const files: VendorManifestFile[] = manifest.files.map((entry: unknown) => {
    if (entry === null || typeof entry !== "object") throw new VendorIntegrityError("vendored bundle manifest file entry is malformed");
    const record = entry as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.bytes !== "number" ||
        typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256))
      throw new VendorIntegrityError("vendored bundle manifest file entry is malformed");
    return { path: record.path, bytes: record.bytes, sha256: record.sha256 };
  });
  return { files, bundleSha256: manifest.bundleSha256, pkg: { name: pkg.name, version: pkg.version, commit: pkg.commit } };
}

/** Verify one vendored bundle directory. Throws VendorIntegrityError on
 * any deviation — callers treat a throw as fail-closed, never as a hint. */
export function verifyVendorBundle(bundleDir: string): VendorVerification {
  // Callers arrive with URL-style roots (vendoredBundleDir ends in "/");
  // the relative slicing below assumes no trailing separator.
  const root = bundleDir.replace(/[\\/]+$/, "");
  const manifest = readManifest(root);
  const listed = new Map(manifest.files.map(entry => [entry.path, entry]));
  const actual = bundleFiles(root);
  const present = new Set(actual);
  const records = actual.map(path => {
    const bytes = readFileSync(join(root, path));
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
  for (const record of records) {
    const entry = listed.get(record.path);
    if (entry === undefined) throw new VendorIntegrityError(`vendored bundle has an unlisted file: ${record.path}`);
    if (entry.bytes !== record.bytes || entry.sha256 !== record.sha256)
      throw new VendorIntegrityError(`vendored bundle file changed: ${record.path}`);
  }
  for (const path of listed.keys())
    if (!present.has(path))
      throw new VendorIntegrityError(`vendored bundle file is missing: ${path}`);
  const digest = createHash("sha256");
  for (const { path, sha256: file } of records) digest.update(`${path}\0${file}\n`);
  const bundleSha256 = digest.digest("hex");
  if (bundleSha256 !== manifest.bundleSha256)
    throw new VendorIntegrityError("vendored bundle digest does not cover the files on disk");
  return Object.freeze({
    package: manifest.pkg.name,
    version: manifest.pkg.version,
    commit: manifest.pkg.commit,
    files: records.length,
    bundleSha256,
  });
}

/** The tool owns its asset root. The shared verifier never derives another
 * workspace's payload from its own installation directory. */
export function vendoredBundleDir(name: string, ownerDirectory: URL): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !ownerDirectory.pathname.endsWith("/"))
    throw new VendorIntegrityError("a vendor bundle requires a literal name and its owner's directory");
  return fileURLToPath(new URL(`vendor/${name}/`, ownerDirectory));
}
