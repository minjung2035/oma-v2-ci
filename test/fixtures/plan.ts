/** Test-only serializer. Invalid intents remain invalid; no fixture repairs them.
 * The explicit literal is independent of the production serializer/version constant. */
export function serializePlanIntent(intent: unknown, _replacer?: null, space?: number): string {
  return JSON.stringify({ version: 2, intent }, null, space);
}
