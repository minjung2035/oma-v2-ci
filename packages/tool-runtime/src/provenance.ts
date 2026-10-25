/** D25: tool authorization by provenance, never by name.
 *
 * A name says nothing about what runs under it: Pi's registry lets a later
 * registration replace an earlier one, so an extension tool can shadow a
 * builtin and inherit whatever a name list meant. What a tool *is* is its
 * `sourceInfo`: builtins carry `source: "builtin"`; tools an extension
 * registered carry the extension path the host pinned and digest-verified.
 * Authorization is therefore: builtin, or a path the runner said it verified.
 *
 * The registry is read on every call rather than held, so a reload, a
 * post-bind registration or a shadowing is judged on what would execute now.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

/** The verified `-e` extension paths this engine was spawned with, as a JSON
 * array. OMA sets it where it sets the rest of the extension's environment. */
export const VERIFIED_EXTENSIONS_ENV = "OMA_VERIFIED_EXTENSIONS";

/** The one spelling of a path this comparison uses: the real path when the
 * filesystem answers, the normalized path otherwise. Extension paths are
 * compared after the loader's own resolution, so both spellings collapse. */
function canonical(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

/** The paths this engine's environment says were digest-verified. Absent or
 * empty means none; a malformed value is no paths at all (fail closed), and
 * the caller reports the state it was handed. */
export function verifiedExtensionPaths(raw: string | undefined): { readonly paths: readonly string[]; readonly malformed: boolean } {
  if (raw === undefined || raw.trim().length === 0) return Object.freeze({ paths: Object.freeze([]), malformed: false });
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return Object.freeze({ paths: Object.freeze([]), malformed: true }); }
  if (!Array.isArray(value) || value.some(entry => typeof entry !== "string" || entry.length === 0))
    return Object.freeze({ paths: Object.freeze([]), malformed: true });
  return Object.freeze({ paths: Object.freeze(value as readonly string[]), malformed: false });
}

export interface ToolProvenance {
  /** Whether the tool the registry would dispatch under `name` may run here.
   * A name the registry does not know, or a registry that cannot be read, is
   * not permitted: an authorization check that cannot see its subject closes. */
  readonly permitted: (name: string) => boolean;
  /** Whether the tool the registry would dispatch under `name` is one this
   * extension itself registered -- the protection OMA's own tools get. */
  readonly own: (name: string) => boolean;
}

export function createToolProvenance(
  getAllTools: () => readonly ToolInfo[],
  ownPath: string,
  verifiedPaths: readonly string[],
): ToolProvenance {
  const own = canonical(ownPath);
  const verified = new Set(verifiedPaths.map(canonical));
  const effective = (name: string): ToolInfo | undefined => {
    let tools: readonly ToolInfo[];
    try { tools = getAllTools(); } catch { return undefined; }
    // The registry holds one effective registration per name; a shadowed name
    // resolves to the shadow, which is what a call would execute.
    return tools.find(tool => tool.name === name);
  };
  return {
    permitted(name) {
      const tool = effective(name);
      if (tool === undefined) return false;
      const info = tool.sourceInfo;
      if (info === undefined || info === null || typeof info !== "object") return false;
      if (info.source === "builtin") return true;
      if (typeof info.path !== "string" || info.path.length === 0) return false;
      const where = canonical(info.path);
      return where === own || verified.has(where);
    },
    own(name) {
      const tool = effective(name);
      return tool !== undefined && typeof tool.sourceInfo?.path === "string" && canonical(tool.sourceInfo.path) === own;
    },
  };
}
