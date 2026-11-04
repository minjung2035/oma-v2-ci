/** Private helper configuration bytes. No role, authority, scope-death or
 * installed-script guarantee is carried by this framing. The authenticated
 * Host sends the frame over an owned fileport, separate from workload input. */
import { snapshotCommand, type CommandSpec } from "@oma/process/command";
import { StoreError } from "@oma/domain/errors";
import { fileURLToPath } from "node:url";

export function bundledJobHelper(): string {
  return fileURLToPath(new URL("./job-helper/oma-job-helper", import.meta.url));
}
export function encodeDarwinJob(command: CommandSpec, slots: readonly number[], imageStages: 1 | 2, trace = false): Uint8Array {
  const source = snapshotCommand(command), descriptors = [...slots];
  if (!source.executable.startsWith("/") || ![1, 2].includes(imageStages) || typeof trace !== "boolean" ||
      descriptors.length < 3 || descriptors.length > 128 || new Set(descriptors).size !== descriptors.length ||
      ![0, 1, 2].every(fd => descriptors.includes(fd)) ||
      descriptors.some(fd => !Number.isSafeInteger(fd) || fd < 0 || fd > 65535))
    throw new StoreError("UNSUPPORTED_PROFILE", "invalid private Darwin job configuration");
  const argv = [source.executable, ...source.argv], environment = Object.entries(source.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined).map(([key, value]) => key + "=" + value);
  if (argv.length > 16384 || environment.length > 4096)
    throw new StoreError("UNSUPPORTED_PROFILE", "Darwin job argument count exceeds its native bound");
  const strings = [...argv, ...environment].map(value => Buffer.from(value));
  const size = 32 + descriptors.length * 4 + strings.reduce((sum, value) => sum + 4 + value.length, 0);
  if (size > 262144) throw new StoreError("UNSUPPORTED_PROFILE", "Darwin job configuration exceeds its native bound");
  const bytes = Buffer.alloc(size); bytes.write("OMAJOB1\0", 0, "ascii");
  [size, argv.length, environment.length, descriptors.length, imageStages, Number(trace)]
    .forEach((word, index) => bytes.writeUInt32LE(word, 8 + index * 4));
  let offset = 32;
  for (const fd of descriptors) { bytes.writeUInt32LE(fd, offset); offset += 4; }
  for (const value of strings) {
    bytes.writeUInt32LE(value.length, offset); offset += 4;
    bytes.set(value, offset); offset += value.length;
  }
  return bytes;
}
