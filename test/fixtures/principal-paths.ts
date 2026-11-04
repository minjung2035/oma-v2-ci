/** Explicit current admission data for launch recipe tests; creates no state. */
import { collaborationSurface } from "@oma/domain/collaboration-surface";
import { principalWorkspace, principalSessionDir } from "@oma/engine/principal-session";
export function principalPaths(root = "/state") {
  return { collaborationStateRoot: root, toolSurface: JSON.stringify(collaborationSurface("principal")),
    workspace: principalWorkspace(root), sessionDir: principalSessionDir(root) };
}
export const principalBounds = { OMA_SUBJECT_BYTES: "512", OMA_BODY_BYTES: "262144", OMA_FRAME_BYTES: "262144", OMA_CONTEXT_BYTES: "8388608" };
