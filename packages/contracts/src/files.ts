/** Results of checking immutable file bytes. Observation does not grant effect authority. */
export type ImmutableObservation =
  | { readonly kind: "present"; readonly bytes: Buffer }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable" | "corrupt"; readonly error: unknown };

/** Preaccept resources are retained on acceptance or uncertainty, released only
 * after observing that no accepted operation owns them. No physical implementation. */
export interface PreacceptOwner {
  retainForOperation(): void;
  discardUnaccepted(): void;
}
export interface PreacceptArtifactOwner extends PreacceptOwner {
  readonly path: string;
}


/** Ephemeral transport bytes; never acceptance or publication evidence. */
export interface RawDescriptor { readonly bytes: number; readonly sha256: string }
export interface ExecutionBody { readonly chunks: AsyncIterable<Uint8Array>; release(): void }
export interface ConnectionSpool {
  append(bytes: Buffer): void;
  seal(): void;
  handoff(): ExecutionBody;
  releaseConnection(): void;
}


/** Exact broker-produced patch stored before integration acceptance. */
export interface ReviewDiffArtifact { readonly version: 1; readonly base: string; readonly candidate: string;
  readonly reference: string; readonly bytes: number; readonly sha256: string }

/** Ephemeral, host-private Git observation. The pathname is valid only during
 * its synchronous consumer; it is never an accepted artifact or a model path. */
export interface ReviewRecordFile { readonly path: string; readonly bytes: number; readonly sha256: string }
export interface ReviewSourceLeaf {
  readonly mode: "100644" | "100755" | "120000" | "160000";
  readonly oid: string;
  readonly kind: "blob" | "gitlink";
}
export interface ReviewSourcePath {
  readonly status: "A" | "M" | "D" | "T";
  readonly path: string;
  readonly before: ReviewSourceLeaf | null;
  readonly after: ReviewSourceLeaf | null;
}
/** A new observation from recorded immutable OIDs, not a reconstruction of an
 * originally stored patch. Exact blob bytes include symlink contents, never
 * dereferenced targets. Gitlinks are references only; no fetch is performed. */
export interface ReviewSourceRecord {
  readonly base: string;
  readonly candidate: string;
  readonly objectFormat: "sha1" | "sha256";
  readonly patch: ReviewRecordFile;
  readonly paths: readonly ReviewSourcePath[];
  withBlob(oid: string, consume: (file: ReviewRecordFile) => undefined): void;
}
