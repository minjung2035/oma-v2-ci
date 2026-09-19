/** Declared bounds for the product surface.
 *
 * Core states its limits once in a frozen descriptor (RESOURCE_FIELDS,
 * PROTOCOL_LIMIT_FIELDS, SURFACE_LIMITS) rather than spreading numbers through
 * the code that uses them. The product surface follows the same rule: every
 * bound a screen relies on is named here, so what the UI will and will not grow
 * to is readable in one place and testable without rendering anything.
 *
 * They never relax a wire, durable or quota limit, and nothing here is
 * authority. Column widths are layout and live with the view
 * (`view/layout.ts`), so a layout rewrite does not touch this file.
 */

export interface SurfaceBound {
  readonly value: number;
  readonly unit: "cells" | "lines" | "bytes" | "count";
  readonly why: string;
}

export const bound = (value: number, unit: SurfaceBound["unit"], why: string): SurfaceBound =>
  Object.freeze({ value, unit, why });

export const TERMINAL_BOUNDS = Object.freeze({
  minColumns: bound(20, "cells", "narrower than this cannot show a label and a value"),
  minRows: bound(6, "lines", "conversation, divider, prompt and hint need this many"),
  assumedColumns: bound(80, "cells", "used when the stream reports no width"),
  assumedRows: bound(24, "lines", "used when the stream reports no height"),
});

export const CONVERSATION_BOUNDS = Object.freeze({
  transcriptLines: bound(500, "lines", "a long session must not grow without limit"),
});

export const CONFIG_BOUNDS = Object.freeze({
  numberDraftDigits: bound(9, "count", "a settings number never needs more digits"),
  revisionDigestHex: bound(32, "count", "hex digits of the content digest a policy revision carries"),
  maxWorkerLimit: bound(4096, "count", "an editable cap the quota validator still has to accept"),
  maxInitialWorkers: bound(64, "count", "bootstrap seeds a population, not a fleet"),
  seedNameAttempts: bound(4096, "count", "bounds the search for a free seed name"),
});

export const READ_BOUNDS = Object.freeze({
  mailHeaderBytes: bound(64 * 1024, "bytes", "headers are read, not whole attachments"),
  mailBodyBytes: bound(256 * 1024, "bytes", "matches the wire mail body limit"),
  extensionScanDepth: bound(3, "count", "installed extensions are not nested deeper"),
  roleExtensions: bound(16, "count", "the operations contract's per-role maximum"),
});

/** Every declared bound, for tests that assert the surface stays bounded. */
export const SURFACE_BOUNDS = Object.freeze({
  ...TERMINAL_BOUNDS,
  ...CONVERSATION_BOUNDS,
  ...CONFIG_BOUNDS,
  ...READ_BOUNDS,
});
