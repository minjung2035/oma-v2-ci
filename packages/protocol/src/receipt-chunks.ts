/** IPC-006/008: a frame limit changes transport, never a recorded outcome. */
import type { PublicMethods, Receipt } from "@oma/contracts";
import { sha256Hex } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";
import { decodeReceipt } from "./receipt-codec.js";
import { parseJsonObject } from "./frame.js";

/** Client reassembly budget, separate from the per-frame transport budget. */
export const MAX_RECEIPT_BYTES = 64 * 1024 * 1024;
type Chunk = PublicMethods["operation.read"]["result"];
type Params = PublicMethods["operation.read"]["params"];
export function receiptChunk(id: string, receipt: Receipt, params: Params, frameBytes: number) {
  const bytes = Buffer.from(JSON.stringify(receipt));
  const sha256 = sha256Hex(bytes);
  if ((params.offset > 0 && params.sha256 === undefined) || params.offset >= bytes.length ||
      (params.sha256 !== undefined && params.sha256 !== sha256))
    throw new StoreError("INVALID_REQUEST", "receipt observation changed or continuation is invalid; restart operation.read at offset zero");
  const result: Chunk = { sha256, bytes: bytes.length, offset: params.offset, data: "", next: params.offset };
  const answer = { v: 1 as const, id, ok: true as const, result };
  // Reserve the longest continuation spelling before selecting complete base64 quanta.
  result.next = bytes.length;
  const available = frameBytes - Buffer.byteLength(JSON.stringify(answer)) - 4;
  const count = Math.min(bytes.length - params.offset, Math.floor(available / 4) * 3);
  if (count < 1) throw new StoreError("FRAME_TOO_LARGE", "frame or request id leaves no room for a receipt chunk");
  result.data = bytes.subarray(params.offset, params.offset + count).toString("base64");
  result.next = params.offset + count === bytes.length ? null : params.offset + count;
  // null can be longer than a small numeric offset.
  if (Buffer.byteLength(JSON.stringify(answer)) > frameBytes)
    throw new StoreError("FRAME_TOO_LARGE", "frame leaves no room for a receipt continuation");
  return answer;
}

/** A changed version or any incomplete stream is not evidence for resending. */
export async function collectReceipt(key: string, maximum: number, read: (params: Params) => Promise<Chunk>): Promise<Receipt> {
  const chunks: Buffer[] = [];
  let offset = 0; let sha256: string | undefined; let total: number | undefined;
  for (;;) {
    const part = await read({ key, offset, ...(sha256 === undefined ? {} : { sha256 }) });
    if (!Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > maximum ||
        part.offset !== offset || (sha256 !== undefined && part.sha256 !== sha256) ||
        (total !== undefined && part.bytes !== total))
      throw new StoreError("BROKER_UNAVAILABLE", "invalid or changed receipt chunk identity");
    const bytes = Buffer.from(part.data, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== part.data || offset + bytes.length > part.bytes ||
        part.next !== (offset + bytes.length === part.bytes ? null : offset + bytes.length))
      throw new StoreError("BROKER_UNAVAILABLE", "invalid receipt chunk extent");
    sha256 = part.sha256; total = part.bytes; chunks.push(bytes); offset += bytes.length;
    if (part.next === null) break;
  }
  const bytes = Buffer.concat(chunks, offset);
  if (sha256Hex(bytes) !== sha256) throw new StoreError("BROKER_UNAVAILABLE", "receipt chunk digest mismatch");
  const decoded = decodeReceipt(parseJsonObject(bytes).raw, { allowNotFound: true });
  if (!decoded.ok) throw new StoreError("BROKER_UNAVAILABLE", `invalid reassembled receipt: ${decoded.reason}`);
  return decoded.value;
}
