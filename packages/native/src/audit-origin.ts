/** Public Security.framework audit-token observation. No PID-only fallback,
 * signing-identity allowlist, role policy or authorization grant lives here.
 * Source: Apple Security db15acbe, SecCode.h/cskernel.cpp/csprocess.cpp. NOT_RUN.
 */
import { decode, load, type KoffiFunc } from "koffi";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withAsyncCleanup } from "./cleanup.js";
import { decodeDarwinAuditToken } from "./audit-token.js";

type Handle = unknown;
interface AuditCalls {
  readonly auditKey: Handle; readonly keyCallbacks: Handle; readonly valueCallbacks: Handle;
  data(allocator: null, bytes: Buffer, length: number): Handle;
  dictionary(allocator: null, capacity: number, keys: Handle, values: Handle): Handle;
  set(dictionary: Handle, key: Handle, value: Handle): void;
  guest: KoffiFunc<(host: null, attributes: Handle, flags: number, result: Buffer) => number>;
  validate: KoffiFunc<(code: Handle, flags: number, requirement: null) => number>;
  release(value: Handle): void;
}
let calls: AuditCalls | undefined;
function native(): AuditCalls {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "audit-origin observation requires Darwin 64-bit Security.framework");
  if (calls !== undefined) return calls;
  const security = load("/System/Library/Frameworks/Security.framework/Security");
  const foundation = load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  calls = {
    auditKey: decode(security.symbol("kSecGuestAttributeAudit"), "void *"),
    keyCallbacks: foundation.symbol("kCFTypeDictionaryKeyCallBacks"),
    valueCallbacks: foundation.symbol("kCFTypeDictionaryValueCallBacks"),
    data: foundation.func("void *CFDataCreate(void *allocator, const void *bytes, long length)"),
    dictionary: foundation.func("void *CFDictionaryCreateMutable(void *allocator, long capacity, const void *keys, const void *values)"),
    set: foundation.func("void CFDictionarySetValue(void *dictionary, const void *key, const void *value)"),
    guest: security.func("int SecCodeCopyGuestWithAttributes(void *host, void *attributes, unsigned int flags, void *result)"),
    validate: security.func("int SecCodeCheckValidity(void *code, unsigned int flags, void *requirement)"),
    release: foundation.func("void CFRelease(void *value)"),
  };
  return calls;
}
export type AuditOriginObservation =
  | { readonly kind: "matched" }
  | { readonly kind: "unavailable"; readonly osStatus: number };
export interface AuditOriginOperation {
  readonly result: Promise<AuditOriginObservation>;
  /** Native callbacks and every CF release complete independently of a
   * negative identity observation. Failed resource return rejects this. */
  readonly returned: Promise<void>;
}

/** Only a successful dynamic validation is a positive observation. Failure
 * does not distinguish a dead/reused PID, unsigned code, permission or I/O.
 * It never grants authority or proves a whole execution scope has died.
 */
export function observeDarwinAuditOrigin(token: readonly number[]): AuditOriginOperation {
  const { pid } = decodeDarwinAuditToken(token);
  if (pid < 2 || pid > 0x7fffffff) throw new TypeError("invalid kernel audit process");
  const system = native(), bytes = Buffer.alloc(32);
  token.forEach((word, index) => bytes.writeUInt32LE(word, index * 4));
  let data: Handle, attributes: Handle, code: Handle;
  let returned!: () => void, failedReturn!: (error: unknown) => void;
  const completion = new Promise<void>((yes, no) => { returned = yes; failedReturn = no; });
  const result = withAsyncCleanup<AuditOriginObservation>(async () => {
    data = system.data(null, bytes, bytes.length);
    if (data == null) throw new Error("audit-token data allocation failed");
    attributes = system.dictionary(null, 1, system.keyCallbacks, system.valueCallbacks);
    if (attributes == null) throw new Error("audit-token dictionary allocation failed");
    system.set(attributes, system.auditKey, data);
    const output = Buffer.alloc(8);
    // Security may perform IPC/disk work. The buffers and CF owners stay
    // alive through the Koffi worker callback, including after cancellation.
    const located = await new Promise<number>((resolve, reject) => {
      system.guest.async(null, attributes, 0, output, (error, status) => error ? reject(error) : resolve(status));
    });
    if (located !== 0) return { kind: "unavailable", osStatus: located };
    code = decode(output, "void *");
    if (code == null) throw new Error("Security returned no audit-bound code reference");
    // Public since macOS 11.3 for dynamic code. Validation uses the complete
    // audit token internally (csops_audittoken), with no network work. Copying
    // a SecCode alone does not perform the necessary kernel validation.
    const validated = await new Promise<number>((resolve, reject) => {
      system.validate.async(code, 0x20000000 /* kSecCSNoNetworkAccess */, null, (error, status) => error ? reject(error) : resolve(status));
    });
    return validated === 0 ? { kind: "matched" } : { kind: "unavailable", osStatus: validated };
  }, () => {
    try {
      cleanupAll([code, attributes, data].filter(value => value != null).map(value => () => system.release(value)));
      returned();
    } catch (error) { failedReturn(error); throw error; }
  });
  void result.catch(() => {}); void completion.catch(() => {});
  return Object.freeze({ result, returned: completion });
}
