/** DR25 on macOS: the engine's side of `oma pi` (macos-platform §4.5
 * `packages.replace`), run by guesthost once it has checked that what it
 * staged is what the Mac declared (tui/packages-apply.ts does the work):
 *
 *   node guest-packages.js --data <oma data dir> --archive <staged> --libdir <installation> [--project <project mirror>]
 *
 * Prints one JSON line: { added, said }. */
import { StoreError } from "../domain/errors.js";
import { applyPackageArchive } from "../tui/packages-apply.js";
import { errorWords } from "../tui/words.js";

function argOf(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const data = argOf("--data"), archive = argOf("--archive"), libdir = argOf("--libdir"), mirror = argOf("--project");
  if (data === undefined || archive === undefined || libdir === undefined)
    throw new StoreError("INVALID_REQUEST", "usage: guest-packages --data <dir> --archive <file> --libdir <dir> [--project <mirror>]");
  process.stdout.write(`${JSON.stringify(await applyPackageArchive({ data, archive, libdir, mirror, activate: argOf("--activate") }))}\n`);
}

main().catch(error => { process.stderr.write(`guest-packages: ${errorWords(error)}\n`); process.exit(1); });
