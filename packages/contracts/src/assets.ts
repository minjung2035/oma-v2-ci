/** Recorded asset identities and resolved resource paths; these declarations issue no verification proof. */
export interface VerifiedExtension {
  readonly path: string;
  readonly sha256: string;
}

/** The package resources of one store, resolved to host paths: what an
 * engine's argv names so Pi's loader discovers them (C18). */
export interface PackageResourcePaths {
  readonly skills: readonly string[];
  readonly prompts: readonly string[];
  readonly themes: readonly string[];
}

