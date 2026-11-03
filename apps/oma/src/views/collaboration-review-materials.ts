/** Immutable, role-gated review material projection. This is not an acceptance,
 * publication or artifact-retention owner; Git owns its scoped source exports. */
import { dirname, join } from "node:path";
import type { GitModule } from "@oma/git";
import type { Store } from "@oma/storage";
import type { ReviewRecordFile } from "@oma/contracts/files";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";
import { sha256Hex } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { publishImmutableFile, readImmutableBytes } from "@oma/storage/immutable-file";

interface Dependency { readonly path: string; readonly bytes: number; readonly sha256: string }
interface MaterialCache { readonly identity: string; readonly manifestSha256: string; readonly dependencies: readonly Dependency[] }
export class CollaborationReviewMaterials {
  /** Descriptors only: no patch, blob or decoded source bodies survive a call. */
  private readonly cache = new Map<string, MaterialCache>();
  constructor(private readonly store: Pick<Store, "inTransaction">, private readonly git: Partial<Pick<GitModule, "withReviewSourceRecord">>, private readonly stateRoot: string,
    private readonly immutable: (path: string, bytes: string | Uint8Array) => void,
    private readonly exact: (path: string, sha256: string, bytes: number) => boolean) {}

  publish(directory: string, base: string, candidate: string, identity: object): string {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "review materials cannot publish in T");
    const key = canonicalCollaborationJson({ renderer: "git-binary-myers-v1", base, candidate, identity });
    const previous = this.cache.get(directory);
    if (previous && previous.identity !== key)
      throw new StoreError("BROKER_UNAVAILABLE", "review materials changed identity under an immutable directory");
    if (previous && previous.dependencies.every(file => this.exact(file.path, file.sha256, file.bytes))) return previous.manifestSha256;
    if (!this.git.withReviewSourceRecord) throw new StoreError("BROKER_UNAVAILABLE", "recorded review source exports are unavailable");
    const dependencies: Dependency[] = [];
    const text = (relative: string, value: string): void => {
      const path = join(directory, relative); this.immutable(path, value);
      dependencies.push({ path, bytes: Buffer.byteLength(value), sha256: sha256Hex(value) });
    };
    const copy = (relative: string, file: ReviewRecordFile): void => {
      const path = join(directory, relative);
      ensureOwnedDirectory(dirname(path), this.stateRoot);
      if (!this.exact(path, file.sha256, file.bytes)) {
        publishImmutableFile(file.path, path, file.sha256);
        if (!this.exact(path, file.sha256, file.bytes))
          throw new StoreError("BROKER_UNAVAILABLE", "complete review material was not published");
      }
      dependencies.push({ path, bytes: file.bytes, sha256: file.sha256 });
    };
    let manifestSha256: string | null = null;
    this.git.withReviewSourceRecord(base, candidate, source => {
      if (source.base !== base || source.candidate !== candidate || source.objectFormat !== (base.length === 40 ? "sha1" : "sha256"))
        throw new StoreError("REF_STATE_UNKNOWN", "review materials differ from their recorded endpoint relationship");
      // Preserve arbitrary original bytes; a text pointer is not a lossy patch.
      let utf8 = true;
      const patch = readImmutableBytes(source.patch.path, source.patch.sha256, source.patch.bytes);
      try { decodeUtf8(patch); } catch { utf8 = false; }
      const exactPatch = utf8 ? "proposal.patch" : "proposal.patch.bin";
      copy(exactPatch, source.patch);
      if (!utf8) text("proposal.patch", ["# Exact patch requires binary-safe reading",
        `Exact bytes: ${exactPatch}`, `Bytes: ${source.patch.bytes}; SHA-256: ${source.patch.sha256}`,
        "Coverage: this is a pointer, not a text transcription or complete text diff. No replacement decoding was performed.", ""].join("\n"));
      const objects = new Map<string, { oid: string; bytes: number; sha256: string; reference: string }>();
      for (const path of source.paths) for (const leaf of [path.before, path.after]) {
        if (!leaf || leaf.kind !== "blob" || objects.has(leaf.oid)) continue;
        source.withBlob(leaf.oid, file => {
          const reference = `objects/${leaf.oid}.bin`; copy(reference, file);
          objects.set(leaf.oid, { oid: leaf.oid, bytes: file.bytes, sha256: file.sha256, reference });
          return undefined;
        });
      }
      const manifest = canonicalCollaborationJson({ version: "collaboration-v1", kind: "recorded-oid-materials",
        renderer: "git-binary-myers-v1", identity, repository: "project", objectFormat: source.objectFormat,
        base, candidate, patch: { reference: exactPatch, textReference: "proposal.patch", bytes: source.patch.bytes,
          sha256: source.patch.sha256, textEncoding: utf8 ? "exact-utf8" : "authored-pointer-only",
          origin: "new-observation-from-recorded-immutable-oids; not an originally stored patch" },
        paths: source.paths, objects: [...objects.values()],
        coverage: "complete changed-path endpoint blob bytes, including binary and symlink bytes; gitlinks are references only, never fetched",
        authority: "observation only; no publication, approval, integration, acceptance or current availability is established" });
      text("manifest.json", manifest); manifestSha256 = sha256Hex(manifest);
      return undefined;
    });
    if (manifestSha256 === null) throw new StoreError("BROKER_UNAVAILABLE", "review source owner did not complete its synchronous observation");
    if (previous && previous.manifestSha256 !== manifestSha256)
      throw new StoreError("BROKER_UNAVAILABLE", "review materials conflict with their original observed bytes");
    this.cache.set(directory, { identity: key, manifestSha256, dependencies: Object.freeze(dependencies) });
    return manifestSha256;
  }
}
