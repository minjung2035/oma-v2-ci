/** DR25 on macOS, the guest's side of `packages.replace` (macos-platform
 * §4.5): the packages the Mac installed, staged by a stream (§4.8) under the
 * request's key, checked to be what the Mac declared, and handed to the
 * engine's own `oma pi` code (entry/guest-packages.ts), which makes them the
 * store and brings every project's roles to them. Keyed (MAC-240): the same
 * request again is answered from its outcome, and one cut off runs again --
 * publishing a generation that already exists and switching the link to it
 * are the same effect twice. */
import { existsSync, statSync } from "node:fs";
import { StoreError } from "../../domain/errors.js";
import { runProcess } from "../../process/run.js";
import { decodeProcessText } from "../../process/run.js";
import { isUuid } from "../../protocol/host-guest.js";
import { installedPackageSource } from "../../runtime/pi-packages.js";
import type { RequestLedger } from "./requests.js";
import type { GuestProjects } from "./project.js";
import { sha256File } from "./project.js";

export interface GuestPackagesOptions {
  readonly ledger: RequestLedger;
  readonly projects: GuestProjects;
  /** `<XDG_DATA_HOME>/oma`: the engine's data, whose store and projects these are. */
  readonly dataDir: string;
  /** The installation, and the Node and entry of its `oma pi` code. */
  readonly libdir: string;
  readonly node: string;
  readonly entry: string;
  /** The environment the engine's own processes run with. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export class GuestPackages {
  constructor(private readonly options: GuestPackagesOptions) {}

  replace(key: unknown, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.options.ledger.run(key, "packages.replace", params, async () => {
      const activate = params.activate;
      if (activate !== undefined && (typeof activate !== "string" || !installedPackageSource(activate)))
        throw new StoreError("INVALID_REQUEST", "activate must name an installed package source");
      const { archive, projectId } = params as { archive?: { bytes?: unknown; sha256?: unknown }; projectId?: unknown };
      if (projectId !== undefined && !isUuid(projectId)) throw new StoreError("INVALID_REQUEST", "projectId must be a UUID");
      if (archive === null || typeof archive !== "object" || typeof archive.bytes !== "number" || typeof archive.sha256 !== "string")
        throw new StoreError("INVALID_REQUEST", "archive must be { bytes, sha256 }");
      const staged = this.options.ledger.staging(key as string, "bundle");
      if (!existsSync(staged) || statSync(staged).size !== archive.bytes || await sha256File(staged) !== archive.sha256)
        throw new StoreError("STREAM_INVALID", "the packages did not arrive as declared");
      const mirror = projectId === undefined ? undefined : this.options.projects.mirrorOf(projectId as string);
      if (mirror !== undefined && !existsSync(mirror))
        throw new StoreError("INVALID_REQUEST", "that project has not been brought to the engine yet");
      const ran = await runProcess({ executable: this.options.node,
        argv: [this.options.entry, "--data", this.options.dataDir, "--archive", staged, "--libdir", this.options.libdir,
          ...(mirror === undefined ? [] : ["--project", mirror]), ...(activate === undefined ? [] : ["--activate", activate])],
        env: { ...this.options.env }, timeoutMs: this.options.timeoutMs, stdoutBytes: 1024 * 1024, stderrBytes: 64 * 1024 });
      // Cut off or failed: no outcome is kept, so the same key runs it again.
      if (ran.kind !== "exited" || ran.exitCode !== 0)
        throw new StoreError("INTERNAL_ERROR", "the engine could not take the packages on");
      let answer: unknown;
      try { answer = JSON.parse(decodeProcessText(ran.stdout)); } catch { throw new StoreError("INTERNAL_ERROR", "the engine's answer about the packages was malformed"); }
      if (answer === null || typeof answer !== "object") throw new StoreError("INTERNAL_ERROR", "the engine's answer about the packages was malformed");
      const { added, said, ok } = answer as { added?: unknown; said?: unknown; ok?: unknown };
      const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string" && item.length <= 4096);
      if (!strings(added) || !strings(said) || typeof ok !== "boolean") throw new StoreError("INTERNAL_ERROR", "the engine's answer about the packages was malformed");
      return { added, said, ok };
    });
  }
}
