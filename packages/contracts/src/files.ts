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

