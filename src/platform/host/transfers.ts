/** Package transfer and encrypted archive retrieval (DR25, MAC-621).
 * Plain archive bytes never land in the host staging directory. */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { writePackageArchive } from "../package-archive.js";
import { sealedArchiveSink } from "./archive-crypto.js";
import { getStream, putStream, sha256File } from "./project.js";
import { listHostStaged, removeHostStaged } from "./files.js";
import { PLATFORM_FRAME_BYTES } from "../../protocol/host-guest.js";
import type { GuestLink } from "./guest-link.js";
import type { HostApiBackend } from "./host-api.js";

export interface HostTransferOptions {
  readonly link: GuestLink;
  readonly transfer: string;
  readonly packagesDir?: string;
  readonly archivesDir: string;
  readonly archiveKey: () => Promise<Buffer>;
  readonly room: (dir: string, incoming: number) => void;
}
export class HostTransfers {
  constructor(private readonly options: HostTransferOptions) {}
  async syncPackages(key: string, params: Parameters<HostApiBackend["syncPackages"]>[1]): Promise<Record<string, unknown>> {
    if (this.options.packagesDir === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "this OMA keeps no packages");
    const file = join(this.options.transfer, `${createHash("sha256").update(key).digest("hex")}.packages`);
    this.options.room(this.options.transfer, 0);
    try {
      // The whole store, as it is now: what `oma pi` installed and the list it keeps.
      removeHostStaged(file);
      await writePackageArchive(this.options.packagesDir, file);
      const declared = { bytes: statSync(file).size, sha256: await sha256File(file) };
      await putStream(await this.options.link.bytes("stream"), key, file, PLATFORM_FRAME_BYTES);
      const society = await this.options.link.json("society");
      try {
        return await society.request("packages.replace",
          { archive: declared, ...(params.activate === undefined ? {} : { activate: params.activate }), ...(params.projectId === null ? {} : { projectId: params.projectId }) }, key);
      } finally { society.close(); }
    } finally { removeHostStaged(file); }
  }
  async archive(key: string, society: string): Promise<Record<string, unknown>> {
    const peer = await this.options.link.json("society");
    let made: Record<string, unknown>;
    try { made = await peer.request("archive.create", { society }, key); } finally { peer.close(); }
    const name = `${society}-${createHash("sha256").update(key).digest("hex").slice(0, 16)}.omaarchive`;
    const target = join(this.options.archivesDir, name);
    // P0V-103: a name in the archives directory is a finished
    // publication (files.ts); an interrupted one is only a temporary.
    const entries = listHostStaged(this.options.archivesDir);
    if (entries === null) throw new StoreError("BROKER_UNAVAILABLE", "the archive store could not be observed");
    const existing = entries.find(entry => entry.name === name);
    if (existing !== undefined && !existing.isFile()) throw new StoreError("STORE_CORRUPT", "the archive publication is not a file");
    if (existing === undefined) {
      const sealKey = await this.options.archiveKey();
      // MAC-621, P0V-104: sealed as it arrives -- the plain bytes are
      // never written -- into a temporary published whole.
      await getStream(await this.options.link.bytes("stream"), key, declared => {
        this.options.room(this.options.archivesDir, declared.bytes);
        return sealedArchiveSink(this.options.archivesDir, name, sealKey);
      }, PLATFORM_FRAME_BYTES, "archive");
    }
    return { ...made, path: target };
  }
}
