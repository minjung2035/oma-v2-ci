/** Darwin physical fence only. Full identity is authenticated by the fixed
 * creator; the finite UDP port is an exclusion resource, never its identity.
 * A collision/unavailable creator refuses acquisition; no alternate is tried. */
import { closeSync, fstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "koffi";
import { closeOnExec, controlSocketPair } from "./control-socket.js";
import { machoImageCdHashes } from "./darwin-macho-image.js";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withCleanup } from "./cleanup.js";

function identity(name: string): string {
  const matched = /^\0oma\.society\.([a-f0-9]{64})$/.exec(name);
  if (!matched) throw new TypeError("invalid full Society fence identity");
  return matched[1]!;
}
/** Index only. Different full identities can contend for this finite resource;
 * that condition is unavailable, never proof of owning the other Society. */
export function darwinSocietyFencePort(name: string): number {
  return 1024 + Number.parseInt(identity(name).slice(0, 8), 16) % (49152 - 1024);
}
function assets() {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch) || (process.getuid?.() ?? 0) <= 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "Darwin Society fences require an ordinary supported Darwin owner");
  const producer = fileURLToPath(new URL("./society-fence/oma-society-fence-producer", import.meta.url));
  const control = fileURLToPath(new URL("./society-fence/oma-society-fence-control", import.meta.url));
  const hashes = machoImageCdHashes(readFileSync(producer), process.arch === "arm64" ? "arm64" : "x64");
  if (hashes.length !== 1) throw new StoreError("UNSUPPORTED_PROFILE", "fixed fence producer has no unique mapped CodeDirectory");
  return { producer, control, hash: hashes[0]! };
}
export type DarwinSocietyFenceRunner = (executable: string, argv: readonly string[], fd?: number) => {
  readonly kind: string; readonly exitCode: number | null; readonly signal: string | null;
  readonly stdout: Uint8Array; readonly stderr: Uint8Array;
};
function invoke(run: DarwinSocietyFenceRunner, control: string, argv: readonly string[], fd?: number): { kind: string; errno?: number } {
  const result = run(control, argv, fd);
  if (result.kind !== "exited" || result.signal || result.exitCode !== 0)
    throw new StoreError("BROKER_UNAVAILABLE", `Society fence observation failed: ${Buffer.from(result.stderr).toString("utf8").slice(0, 2048) || result.kind}`);
  let value: unknown;
  try { value = JSON.parse(Buffer.from(result.stdout).toString("utf8")); } catch (cause) { throw new StoreError("BROKER_UNAVAILABLE", "Society fence result was incomplete", { cause }); }
  if (!value || typeof value !== "object" || !("kind" in value) || typeof value.kind !== "string")
    throw new StoreError("BROKER_UNAVAILABLE", "Society fence result differs from its protocol");
  return value as { kind: string; errno?: number };
}
let receive: ((channel: number, descriptors: Int32Array) => number) | undefined;
export type HeldDarwinSocietyFence = { readonly kind: "held"; readonly fd: number; release(): void } | { readonly kind: "busy" };

export function holdDarwinSocietyFence(name: string, run: DarwinSocietyFenceRunner): HeldDarwinSocietyFence {
  const tag = identity(name), port = String(darwinSocietyFencePort(name)), image = assets(), channel = controlSocketPair();
  let fence: number | undefined, owner: number | undefined;
  let parent: number | undefined = channel.parent, child: number | undefined = channel.child;
  return withCleanup<HeldDarwinSocietyFence>(() => {
    const acquired = invoke(run, image.control, ["acquire", image.producer, tag, image.hash, port], channel.child);
    if (acquired.kind === "busy") {
      if (acquired.errno !== 48 || invoke(run, image.control, ["holder", tag, image.hash, port]).kind !== "matched")
        throw new StoreError("BROKER_UNAVAILABLE", "Society fence exclusion resource is occupied without an authenticated owner");
      return { kind: "busy" };
    }
    if (acquired.kind !== "held") throw new StoreError("BROKER_UNAVAILABLE", "Society fence acquisition was not confirmed");
    receive ??= load(fileURLToPath(new URL("./society-fence/oma-society-fence-bridge.dylib", import.meta.url)))
      .func("int oma_fence_receive(int channel, _Out_ int *descriptors)");
    const descriptors = new Int32Array([-1, -1]), result = receive(channel.parent, descriptors);
    if (result !== 0) throw new StoreError("BROKER_UNAVAILABLE", `Society fence private handoff failed (errno ${result})`);
    fence = descriptors[0]!; owner = descriptors[1]!; closeOnExec(fence); closeOnExec(owner);
    if (invoke(run, image.control, ["identify", tag, image.hash, port], fence).kind !== "matched")
      throw new StoreError("BROKER_UNAVAILABLE", "Society fence handoff differs from its authenticated instance");
    const returnedParent = channel.parent, returnedChild = channel.child; parent = undefined; child = undefined;
    cleanupAll([() => closeSync(returnedParent), () => closeSync(returnedChild)]);
    const held = fence, lifetime = owner; fence = undefined; owner = undefined; let released = false;
    return { kind: "held", fd: held, release() {
      if (released) return; released = true;
      try { invoke(run, image.control, ["release"], lifetime); }
      finally { cleanupAll([() => closeSync(held), () => closeSync(lifetime)]); }
    } };
  }, () => cleanupAll([() => { if (fence !== undefined) closeSync(fence); }, () => { if (owner !== undefined) closeSync(owner); },
    () => { if (parent !== undefined) closeSync(parent); }, () => { if (child !== undefined) closeSync(child); }]));
}
export function identifyDarwinSocietyFence(fd: number, name: string, run: DarwinSocietyFenceRunner): { readonly kind: "matched" | "other" } {
  const tag = identity(name), image = assets();
  if (!Number.isSafeInteger(fd) || fd < 0) throw new TypeError("invalid inherited fence descriptor");
  if (!fstatSync(fd).isSocket()) return { kind: "other" };
  const result = invoke(run, image.control, ["identify", tag, image.hash, String(darwinSocietyFencePort(name))], fd);
  if (result.kind !== "matched" && result.kind !== "other") throw new StoreError("BROKER_UNAVAILABLE", "Inherited fence observation was not confirmed");
  return { kind: result.kind };
}
