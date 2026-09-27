/** MAC-601, MAC-611: whether this host may boot a guest image.
 *
 * An image is a directory: `manifest.json`, its detached Ed25519 signature
 * `manifest.json.sig` (base64, over the manifest's exact bytes), and the files
 * the manifest names. The release key's public half is in the app. Before
 * every boot the signature, each file's size and sha256, the protocol and the
 * state schema are checked; any failure is a refusal to boot this image, never
 * a warning. The verity root the manifest carries goes to the kernel command
 * line, where dm-verity checks every block the guest reads.
 */
import { createHash, verify, type KeyObject } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PlatformError } from "../rpc.js";

export const IMAGE_MANIFEST_KIND = "oma-guest-image-v1";
const FILES = ["kernel", "initrd", "system", "verity"] as const;
type ImageFile = (typeof FILES)[number];

export interface VerifiedImage {
  readonly version: string;
  readonly protocol: number;
  readonly stateSchema: { readonly written: number; readonly readable: readonly number[] };
  readonly verityRoot: string;
  readonly paths: Readonly<Record<ImageFile, string>>;
}

const refuse = (message: string): PlatformError =>
  new PlatformError({ code: "ENGINE_UNAVAILABLE", message, retry: "after-repair" });
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function verifyImage(dir: string, releaseKey: KeyObject, hostProtocol: { readonly min: number; readonly max: number }): Promise<VerifiedImage> {
  let bytes: Buffer; let signature: Buffer;
  try {
    bytes = readFileSync(join(dir, "manifest.json"));
    signature = Buffer.from(readFileSync(join(dir, "manifest.json.sig"), "utf8").trim(), "base64");
  } catch { throw refuse("the engine update files are missing"); }
  if (!verify(null, bytes, releaseKey, signature)) throw refuse("the engine update is not signed by this app's publisher");
  let manifest: unknown;
  try { manifest = JSON.parse(bytes.toString("utf8")); } catch { throw refuse("the engine update is damaged"); }
  if (!object(manifest) || manifest.kind !== IMAGE_MANIFEST_KIND || typeof manifest.version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(manifest.version))
    throw refuse("the engine update is damaged");
  if (!uint(manifest.protocol) || manifest.protocol < hostProtocol.min || manifest.protocol > hostProtocol.max)
    throw new PlatformError({ code: "ENGINE_VERSION_SKEW", message: "the engine update is for another version of this app", retry: "never" });
  const schema = manifest.stateSchema;
  if (!object(schema) || !uint(schema.written) || !Array.isArray(schema.readable) || schema.readable.length === 0 || !schema.readable.every(uint))
    throw refuse("the engine update is damaged");
  if (typeof manifest.verityRoot !== "string" || !/^[0-9a-f]{64}$/.test(manifest.verityRoot)) throw refuse("the engine update is damaged");
  const files = manifest.files;
  if (!object(files)) throw refuse("the engine update is damaged");
  const paths = {} as Record<ImageFile, string>;
  for (const name of FILES) {
    const entry = files[name];
    if (!object(entry) || typeof entry.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name) ||
        !uint(entry.bytes) || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256))
      throw refuse("the engine update is damaged");
    const path = join(dir, entry.name);
    let size: number;
    try { size = statSync(path).size; } catch { throw refuse("the engine update is incomplete"); }
    if (size !== entry.bytes || await sha256Of(path) !== entry.sha256) throw refuse("the engine update is damaged");
    paths[name] = path;
  }
  return Object.freeze({ version: manifest.version, protocol: manifest.protocol,
    stateSchema: Object.freeze({ written: schema.written, readable: Object.freeze([...schema.readable as number[]]) }),
    verityRoot: manifest.verityRoot, paths: Object.freeze(paths) });
}

/** MAC-611: state is never taken back to an image that cannot read it. The
 * host records the highest schema any image wrote to this disk. */
export function bootableWith(image: VerifiedImage, highestWritten: number | null): void {
  if (highestWritten !== null && !image.stateSchema.readable.includes(highestWritten))
    throw new PlatformError({ code: "STATE_NEWER_THAN_APP", message: "this data was made by a newer OMA; update OMA", retry: "never" });
}
