// IPC-004: shared envelope construction only; no authentication or effect policy.
export function errorAnswer(id: string, error: { code: string; message: string; retry: "never" | "same-key" | "after-repair"; details?: unknown }): object {
  return { v: 1, id, ok: false, error };
}
export function okAnswer(id: string, result: unknown): object { return { v: 1, id, ok: true, result }; }
