/** `host-record.json` (macos-platform §2.3): the host's own facts about this
 * Mac's engine -- which installation and VM instance it is, whether the disk
 * was ever provisioned (MAC-303), the images it runs, the newest state schema
 * ever written (MAC-611), and how the last stop ended (MAC-320). It is written
 * whole and published by rename, so a reader sees one version or the next. */
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { StoreError } from "../../domain/errors.js";
import { isUuid } from "../../protocol/host-guest.js";

export const HOST_RECORD_KIND = "oma-host-record-v1";

export interface HostRecord {
  readonly kind: typeof HOST_RECORD_KIND;
  readonly installationId: string;
  readonly instanceId: string;
  /** MAC-303: "pending" until the first boot finished making the disk. */
  readonly provisioning: "pending" | "done";
  readonly image: { readonly current: string | null; readonly previous: string | null };
  /** MAC-611: the newest state schema any image wrote to this disk. */
  readonly highestSchemaWritten: number | null;
  /** MAC-320: how the last stop ended, for the one line the next start shows. */
  readonly lastStop: "clean" | "forced" | "crashed" | "failed" | null;
}

export function newHostRecord(): HostRecord {
  return { kind: HOST_RECORD_KIND, installationId: randomUUID(), instanceId: randomUUID(), provisioning: "pending",
    image: { current: null, previous: null }, highestSchemaWritten: null, lastStop: null };
}

const nullableVersion = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length > 0 && value.length <= 64);

/** The record, or null when there is none yet. A record that exists and does
 * not parse is not replaced by a new one: the instance it names is the disk's. */
export function readHostRecord(path: string): HostRecord | null {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new StoreError("BROKER_UNAVAILABLE", "the app's record cannot be read");
  }
  let value: Record<string, unknown>;
  try { value = JSON.parse(text) as Record<string, unknown>; } catch { throw new StoreError("STORE_CORRUPT", "the app's record is damaged"); }
  const image = value.image as Record<string, unknown> | undefined;
  if (value.kind !== HOST_RECORD_KIND || !isUuid(value.installationId) || !isUuid(value.instanceId) ||
      (value.provisioning !== "pending" && value.provisioning !== "done") ||
      typeof image !== "object" || image === null || !nullableVersion(image.current) || !nullableVersion(image.previous) ||
      !(value.highestSchemaWritten === null || (Number.isSafeInteger(value.highestSchemaWritten) && (value.highestSchemaWritten as number) >= 0)) ||
      ![null, "clean", "forced", "crashed", "failed"].includes(value.lastStop as string | null))
    throw new StoreError("STORE_CORRUPT", "the app's record is damaged");
  return value as unknown as HostRecord;
}

export function writeHostRecord(path: string, record: HostRecord): void {
  const temporary = join(dirname(path), `.host-record.${process.pid}.${randomUUID().slice(0, 8)}`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fsyncSync(fd);
  } catch (error) { closeSync(fd); unlinkSync(temporary); throw error; }
  closeSync(fd);
  renameSync(temporary, path);
  const directory = openSync(dirname(path), constants.O_RDONLY);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
