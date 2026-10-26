import { StoreError, exceptionText } from "@oma/domain/errors";
/** Outgoing session transition. Admission observes history; replacement awaits actual engine exit. */
import { realpathSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import type { SessionMode } from "@oma/domain/session-mode";
import { removeUnusedTree } from "@oma/storage/directory";
import { principalSessionDir, principalWorkspace } from "@oma/engine/principal-session";
import { RESUME_SESSION_ENV } from "@oma/protocol/session-handoff";
import { sessionBirthForHistory } from "../runtime/session-catalog.js";
import { tryHoldSociety } from "../runtime/society-lease.js";
import { exitFor } from "./exit.js";
import type { SocietyRuntime } from "./society-runtime.js";
import type { SocietyBootstrap, PreparedSociety } from "./society-bootstrap.js";
export class SocietyTransition {
  private relaunchPending = false;
  constructor(private readonly bootstrap: SocietyBootstrap, private readonly prepared: PreparedSociety, private readonly libdir: string, private readonly runtime: Pick<SocietyRuntime, "session" | "finished" | "beginFinish" | "end">, private readonly interaction: {
    close(): void;
    restore(): void;
  }, private readonly fail: (text: string, code: ReturnType<typeof exitFor>) => never) { }
  async shutdown(code: number): Promise<void> {
    if (!this.runtime.beginFinish())
      return;
    this.interaction.close();
    await this.runtime.end(false);
    this.removeIfUnused();
    this.interaction.restore();
    process.exit(code);
  }
  private removeIfUnused(): void {
    if (!this.bootstrap.createdHere || this.prepared.configuration.settings.config.initialResidents.length > 0)
      return;
    let said: boolean;
    try {
      said = readdirSync(principalSessionDir(this.bootstrap.stateRoot)).some(name => name.endsWith(".jsonl"));
    }
    catch {
      said = true;
    }
    if (said)
      return;
    try {
      removeUnusedTree(this.bootstrap.stateRoot);
      removeUnusedTree(this.bootstrap.runRoot);
    }
    catch { /* left behind, not lost */ }
  }
  async relaunch(resume: string | null, mode?: SessionMode): Promise<void> {
    if (mode !== undefined && (resume !== null || mode !== "personal"))
      throw new StoreError("INVALID_REQUEST", "A mode switch starts a fresh Personal session");
    if (this.runtime.finished || this.relaunchPending)
      return;
    const outgoing = this.runtime.session;
    this.relaunchPending = true;
    try {
      let resumeCwd = this.bootstrap.canonicalProjectPath;
      if (resume !== null) {
        let birth;
        try {
          birth = await sessionBirthForHistory(this.bootstrap.dataRoot, resume, this.bootstrap.canonicalProjectPath);
          // Admission observes history, not authority to resurrect an ended host.
          if (this.runtime.finished || this.runtime.session !== outgoing)
            return;
          resumeCwd = realpathSync(birth.cwd);
          if (resumeCwd !== birth.cwd || !statSync(resumeCwd).isDirectory())
            throw new StoreError("INVALID_REQUEST", "Session cwd no longer identifies its saved directory");

        }
        catch (error) {
          if (!this.runtime.finished && this.runtime.session === outgoing)
            outgoing?.sendUi({ type: "notice", text: exceptionText(error) });
          return;
        }
        const target = birth.mode === "personal" ? null : birth.id;
        if (target !== null && target !== this.bootstrap.society) {
          let probe: ReturnType<typeof tryHoldSociety>;
          try {
            probe = tryHoldSociety(join(this.bootstrap.dataRoot, target));
          }
          catch {
            probe = null;
          }
          if (probe === null) {
            this.runtime.session?.sendUi({ type: "notice", text: "That session is open in another oma window." });
            return;
          }
          probe.release();
        }
      }
      if (!this.runtime.beginFinish())
        return;
      this.interaction.close();
      // Quitting may return a bounded, fenced tenure. A replacement history
      // requires the outgoing engine's actual exit, even after that grace.
      await this.runtime.end(true);
      this.removeIfUnused();
      this.interaction.restore();
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env[RESUME_SESSION_ENV];
      if (resume !== null)
        env[RESUME_SESSION_ENV] = resume;
      // This Node has execve (24+): the new session is this process, its
      // terminal and its place in the shell unchanged.
      if (process.execve === undefined)
        this.fail("This Node cannot restart oma in place; start oma again.", exitFor("UNSUPPORTED_PROFILE"));
      process.chdir(resumeCwd);
      process.execve(process.execPath, [process.execPath, ...process.execArgv, join(this.libdir, DEPLOYMENT_LAYOUT.entries.tui),
        ...(mode === undefined ? [] : ["--mode", mode])], env);
    }
    finally {
      this.relaunchPending = false;
    }
  }
}
