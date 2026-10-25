import { Type } from "typebox";
// OMP remaps `typebox` to a host shim that historically lacked Type.Unsafe.
// Prefer Unsafe when present (real TypeBox / fixed OMP shim); otherwise pass
// the normalized JSON Schema through as a plain object so toolWireSchema and
// validateToolArguments still treat it as JSON Schema.
export function toToolParameters(schema) {
    return typeof Type.Unsafe === "function"
        ? Type.Unsafe(schema)
        : schema;
}
