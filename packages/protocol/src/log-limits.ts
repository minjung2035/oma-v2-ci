export const MIN_LOG_FRAME_BYTES = Buffer.byteLength(JSON.stringify({ v: 1, id: "", ok: true,
  result: { text: "", truncated: false, observedAtMs: Number.MAX_SAFE_INTEGER } }));
