/** Protection of the current process only. Signature validation is not role
 * admission, library integrity, a scope witness or a process-death proof. */
import { decode, load } from "koffi";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll } from "./cleanup.js";

function refuse(message: string): never { throw new StoreError("UNSUPPORTED_PROFILE", message); }
export function protectDarwinSupervisor(): void {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    refuse("supervisor protection requires Darwin 64-bit signing information");
  const security = load("/System/Library/Frameworks/Security.framework/Security"),
    foundation = load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const self = security.func("int SecCodeCopySelf(unsigned int flags, void *result)"),
    validate = security.func("int SecCodeCheckValidity(void *code, unsigned int flags, void *requirement)"),
    information = security.func("int SecCodeCopySigningInformation(void *code, unsigned int flags, void *result)"),
    value = foundation.func("void *CFDictionaryGetValue(void *dictionary, void *key)"),
    type = foundation.func("unsigned long CFGetTypeID(void *value)"),
    numberType = foundation.func("unsigned long CFNumberGetTypeID()"),
    dictionaryType = foundation.func("unsigned long CFDictionaryGetTypeID()"),
    booleanType = foundation.func("unsigned long CFBooleanGetTypeID()"),
    number = foundation.func("bool CFNumberGetValue(void *number, int type, void *result)"),
    boolean = foundation.func("bool CFBooleanGetValue(void *value)"),
    text = foundation.func("void *CFStringCreateWithCString(void *allocator, const char *text, unsigned int encoding)"),
    release = foundation.func("void CFRelease(void *value)");
  let code: unknown, info: unknown, entitlementKey: unknown;
  try {
    const output = Buffer.alloc(8);
    if (self(0, output) !== 0 || (code = decode(output, "void *")) == null ||
        validate(code, 0x20000000 /* kSecCSNoNetworkAccess */, null) !== 0)
      refuse("supervisor has no dynamically valid code signature");
    output.fill(0);
    // Public signing and dynamic information. Never substitute the on-disk
    // flags for the current process's validity/debugged observation.
    if (information(code, 2 | 8, output) !== 0 || (info = decode(output, "void *")) == null || type(info) !== dictionaryType())
      refuse("supervisor signing information is unavailable");
    const field = (name: string): unknown => value(info, decode(security.symbol(name), "void *"));
    const flags = (name: string): number => {
      const entry = field(name), bytes = Buffer.alloc(8);
      if (entry == null || type(entry) !== numberType() || !number(entry, 4 /* kCFNumberSInt64Type */, bytes))
        refuse("supervisor signing flags are unavailable");
      const result = bytes.readBigInt64LE();
      if (result < 0n || result > 0xffffffffn) refuse("supervisor signing flags are out of range");
      return Number(result);
    };
    const status = flags("kSecCodeInfoStatus");
    if (!(flags("kSecCodeInfoFlags") & 0x10000 /* runtime */) || !(status & 1 /* valid */) || status & 0x10000000 /* debugged */)
      refuse("supervisor requires a valid, undebugged hardened image");
    const entitlements = field("kSecCodeInfoEntitlementsDict");
    if (entitlements == null || type(entitlements) !== dictionaryType()) refuse("supervisor entitlements are unavailable");
    entitlementKey = text(null, "com.apple.security.get-task-allow", 0x08000100);
    if (entitlementKey == null) refuse("supervisor entitlement key allocation failed");
    const debug = value(entitlements, entitlementKey);
    if (debug != null && (type(debug) !== booleanType() || boolean(debug)))
      refuse("supervisor image permits task debugging");
    const ptrace = load(null).func("int ptrace(int request, int pid, void *address, int data)");
    if (ptrace(31 /* PT_DENY_ATTACH */, 0, null, 0) !== 0) refuse("supervisor could not deny trace attachment");
  } finally { cleanupAll([entitlementKey, info, code].filter(item => item != null).map(item => () => release(item))); }
}
