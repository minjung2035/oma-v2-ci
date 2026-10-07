/** A society's archive, the guest's part (macos-platform §8.4, REC-005,
 * MAC-619, MAC-623): made only while the society is stopped, from its state
 * root as files -- the DB and its WAL, Maildir, receipts, sessions,
 * configuration generations, and the canonical and context repositories, all
 * of one quiescent point -- without opening the DB. A manifest of every file's
 * sha256 goes in with them. `run/` is left out. */
import { createHash } from "node:crypto";
import { createReadStream, lstatSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { removeOwnedTree } from "../../storage/directory.js";
import { StoreError } from "../../domain/errors.js";
import { isValidSocietyName } from "../../domain/identifiers.js";
import { runProcess } from "../../process/run.js";
import type { RequestLedger } from "./requests.js";

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function manifestOf(root: string, top: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = relative(root, path);
      if (rel === join(top, "run")) continue;
      const stat = lstatSync(path);
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) entries[rel] = await sha256(path);
    }
  };
  await walk(join(root, top));
  return entries;
}

export class GuestArchives {
  constructor(private readonly societiesDir: string, private readonly ledger: RequestLedger,
    private readonly running: (society: string) => Promise<boolean>) {}

  create(key: unknown, params: { society: unknown }): Promise<Record<string, unknown>> {
    return this.ledger.run(key, "archive.create", params, async () => {
      const society = params.society;
      if (!isValidSocietyName(society)) throw new StoreError("INVALID_REQUEST", "invalid society name");
      // REC-005: an archive is of a quiescent society; a running one is not archived.
      if (await this.running(society)) throw new StoreError("BATCH_CONFLICT", "stop the society before archiving it");
      const manifest = await manifestOf(this.societiesDir, society);
      const scratch = mkdtempSync(this.ledger.staging(key as string, "manifest-"));
      try {
        writeFileSync(join(scratch, "manifest.json"), JSON.stringify({ kind: "oma-archive-manifest-v1", society, files: manifest }));
        const staged = this.ledger.staging(key as string, "archive.tar");
        // An archive is exactly as large as the society is: a fixed total
        // deadline would refuse a legitimately large state tree. tar instead
        // reports progress -- a "Write checkpoint" line per 1024 records
        // (~10 MiB) -- which re-arms the silence window, so a working archive
        // runs to completion however long that takes while one that stopped
        // ends as "stalled". The checkpoint lines themselves are progress,
        // not content: stderr is bounded to a head and discarded past it.
        const made = await runProcess({ executable: "/usr/bin/tar", argv: ["--create", "--file", staged, "--format=pax", "--sort=name",
          "--numeric-owner", "--checkpoint=1024", "--directory", this.societiesDir, `--exclude=${society}/run`, society,
          "--directory", scratch, "manifest.json"],
          env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeoutMs: 0x7fffffff, silenceMs: 10 * 60_000,
          stdoutBytes: 64 * 1024, stderrBytes: 64 * 1024, stderrOverflow: "discard" });
        if (made.kind !== "exited" || made.exitCode !== 0) throw new StoreError("INTERNAL_ERROR", "the archive could not be made");
        return { files: Object.keys(manifest).length, bytes: statSync(staged).size, sha256: await sha256(staged) };
      } finally { removeOwnedTree(scratch); }
    });
  }
}
