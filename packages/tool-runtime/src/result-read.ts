import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isResultReference, readResult } from "@oma/tool-files";
/** Extend whichever read implementation the engine ultimately registers.
 * Ordinary source reads retain their original anchored read implementation. */
export function resultReadSurface(pi: ExtensionAPI, root: string): ExtensionAPI {
  const surface = Object.create(pi) as ExtensionAPI;
  surface.registerTool = ((tool: ToolDefinition) => {
    if (tool.name !== "read") { pi.registerTool(tool); return; }
    const adapted: ToolDefinition = { ...tool,
      description: `${tool.description} For an oma-result reference, use path plus optional byteOffset or line and byteLimit (up to 65536); next continues the same immutable result.`,
      // Vendor schemas may carry plain JSON rather than this TypeBox version's
      // optional-property markers. Rebuilding Type.Object would promote every
      // source property to required and reject valid result-page requests.
      parameters: Type.Unsafe({ ...tool.parameters,
        properties: { ...(tool.parameters as { properties: Record<string, import("typebox").TSchema> }).properties,
          byteOffset: Type.Integer({ minimum: 0 }),
          byteLimit: Type.Integer({ minimum: 4, maximum: 65536 }),
          line: Type.Integer({ minimum: 1 }),
        },
        required: [...((tool.parameters as { required?: string[] }).required ?? [])],
        additionalProperties: false,
      }),
      ...(tool.prepareArguments === undefined ? {} : { prepareArguments: (params: unknown) => isResultReference((params as { path?: unknown } | null)?.path) ? params as never : tool.prepareArguments!(params) }),
      async execute(id, params, signal, update, context) {
        const input = params as { path?: unknown; byteOffset?: number; byteLimit?: number; line?: number };
        if (isResultReference(input.path)) {
          const page = readResult(root, input.path, input);
          return { content: [{ type: "text", text: JSON.stringify(page) }], details: page };
        }
        return tool.execute(id, params, signal, update, context);
      },
    };
    pi.registerTool(adapted);
  }) as ExtensionAPI["registerTool"];
  return surface;
}
