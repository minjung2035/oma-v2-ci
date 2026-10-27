/** Darwin's public BSM accessors interpret the opaque kernel audit token.
 * Decoding a copied token is not receive evidence, a live pin or authority.
 * XNU kern_prot.c explicitly warns against depending on field positions.
 */
import { array, load, sizeof, struct } from "koffi";
import { StoreError } from "@oma/domain/errors";

interface TokenValue { readonly val: readonly number[] }
interface AuditTokenCalls {
  pid(token: TokenValue): number; uid(token: TokenValue): number; gid(token: TokenValue): number;
  session(token: TokenValue): number; version(token: TokenValue): number;
}
let calls: AuditTokenCalls | undefined;
function native(): AuditTokenCalls {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "audit-token accessors require Darwin 64-bit BSM");
  if (calls !== undefined) return calls;
  const library = load("/usr/lib/libbsm.dylib");
  // audit_token_t is eight uint32 words passed by value, not a pointer to a
  // Buffer. Koffi applies the arm64/x86_64 aggregate calling convention.
  const token = struct({ val: array("uint32_t", 8) });
  if (sizeof(token) !== 32) throw new Error("unsupported audit-token ABI");
  calls = {
    pid: library.func("audit_token_to_pid", "int", [token]),
    uid: library.func("audit_token_to_euid", "unsigned int", [token]),
    gid: library.func("audit_token_to_egid", "unsigned int", [token]),
    session: library.func("audit_token_to_asid", "int", [token]),
    version: library.func("audit_token_to_pidversion", "int", [token]),
  };
  return calls;
}
export interface DecodedAuditToken {
  readonly pid: number; readonly uid: number; readonly gid: number;
  readonly auditSession: number; readonly pidVersion: number;
}
export function decodeDarwinAuditToken(token: readonly number[]): DecodedAuditToken {
  if (!Array.isArray(token) || token.length !== 8 ||
      token.some(word => !Number.isSafeInteger(word) || word < 0 || word > 0xffffffff))
    throw new TypeError("invalid audit token");
  const system = native(), value = { val: token };
  return Object.freeze({ pid: system.pid(value), uid: system.uid(value), gid: system.gid(value),
    auditSession: system.session(value), pidVersion: system.version(value) });
}
