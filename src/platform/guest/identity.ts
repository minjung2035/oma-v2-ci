/** What a guest says about itself in every hello (MAC-211): the VM instance
 * its state disk was made for, the image it booted, this boot, and the state
 * schema it reads and writes. Read from the files the image and the first
 * boot wrote; a file that cannot be read makes the guest refuse every hello
 * rather than answer with a guess. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { SCHEMA_USER_VERSION_READABLE, SCHEMA_USER_VERSION_WRITTEN } from "../../domain/persisted-formats.js";
import { isUuid } from "../../protocol/host-guest.js";
import type { GuestIdentity } from "./server.js";

export const INSTANCE_FILE = "instance.json";
export const INSTANCE_KIND = "oma-guest-instance-v1";
export const IMAGE_KIND = "oma-guest-image-v1";

function readJson(path: string, what: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new StoreError("BROKER_UNAVAILABLE", `${what} cannot be read`, { cause: error }); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new StoreError("STORE_CORRUPT", `${what} is not an object`);
  return value as Record<string, unknown>;
}

export function readGuestIdentity(dataDir: string, imageManifest: string, capabilities: readonly string[],
  bootIdPath = "/proc/sys/kernel/random/boot_id"): GuestIdentity {
  const instance = readJson(join(dataDir, INSTANCE_FILE), "the VM instance record");
  if (instance.kind !== INSTANCE_KIND || !isUuid(instance.instanceId)) throw new StoreError("STORE_CORRUPT", "the VM instance record is malformed");
  const image = readJson(imageManifest, "the image manifest");
  if (image.kind !== IMAGE_KIND || typeof image.version !== "string") throw new StoreError("STORE_CORRUPT", "the image manifest is malformed");
  const bootId = readFileSync(bootIdPath, "utf8").trim();
  if (!isUuid(bootId)) throw new StoreError("BROKER_UNAVAILABLE", "this boot has no identity");
  return Object.freeze({
    instanceId: instance.instanceId, guestImage: image.version, bootId,
    stateSchema: Object.freeze({ written: SCHEMA_USER_VERSION_WRITTEN, readable: SCHEMA_USER_VERSION_READABLE }),
    capabilities: Object.freeze([...capabilities]),
  });
}
