/** Human-only Personal lifecycle. The child owns Pi; this host owns its exit. */
import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSocietyFor } from "@oma/config/defaults";
import { sha256Hex } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { sessionBirthForHistory } from "../runtime/session-catalog.js";
import { RESUME_SESSION_ENV } from "@oma/protocol/session-handoff";
import { sessionRootForHistory } from "../runtime/session-mode.js";
import { personalBirth, runPersonalSession } from "../runtime/personal-session.js";
import { updatePersonalSettingsAsync } from "../runtime/personal-settings.js";
import { readSettingsForEditing, projectSettingsPath, roleSetOf } from "../application/settings.js";

export async function personalMain(options: { readonly dataRoot: string; readonly cwd: string; readonly resume?: string;
  readonly packages?: string; readonly noProjectExtensions?: boolean }): Promise<void> {
  if (options.noProjectExtensions && options.resume !== undefined)
    throw new StoreError("INVALID_REQUEST", "--no-project-extensions requires a new Personal session");
  const libdir = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  const packages = options.packages ?? join(options.dataRoot, ".packages");
  // Only an explicitly saved project selection is inherited once. It never
  // creates a Society configuration, prompt, binding or workspace.
  const target = options.resume === undefined ? undefined
    : { root: sessionRootForHistory(options.dataRoot, options.resume), birth: await sessionBirthForHistory(options.dataRoot, options.resume, options.cwd) };
  if (target !== undefined && (target.root === null || target.birth.mode !== "personal" || !lstatSync(options.resume!).isFile()))
    throw new StoreError("INVALID_REQUEST", "That is not a saved Personal history");
  const cwd = target?.birth.cwd ?? options.cwd;
  if (realpathSync(cwd) !== cwd || !lstatSync(cwd).isDirectory())
    throw new StoreError("INVALID_REQUEST", "Personal cwd no longer identifies its saved directory");
  await updatePersonalSettingsAsync({ dataRoot: options.dataRoot, libdir, packages }, async () => {
    if (options.noProjectExtensions) return [];
    const project = defaultSocietyFor(cwd, sha256Hex(cwd));
    const config = projectSettingsPath(options.dataRoot, project);
    if (lstatSync(config, { throwIfNoEntry: false }) === undefined) return [];
    const saved = readSettingsForEditing(config);
    if (saved.snapshot === null) throw new StoreError("STORE_CORRUPT", "Project settings have no committed source");
    const role = roleSetOf(saved.snapshot)[saved.config.principalProfile];
    if (role === undefined) throw new StoreError("STORE_CORRUPT", "Project settings have no Principal profile");
    return role.extensions;
  });
  const opened = target === undefined ? personalBirth(options.dataRoot, cwd) : { ...target, root: target.root! };
  const ended = await runPersonalSession({ root: opened.root, dataRoot: options.dataRoot, libdir, packages,
    ...(options.resume === undefined ? {} : { resume: options.resume }) });
  if (ended.next === undefined) { process.exitCode = ended.code; return; }
  if (process.execve === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "This Node cannot restart oma in place; start oma again");
  const env = { ...process.env }; delete env[RESUME_SESSION_ENV];
  if (ended.next.mode !== undefined) {
    process.chdir(cwd);
    process.execve(process.execPath, [process.execPath, ...process.execArgv, join(libdir, DEPLOYMENT_LAYOUT.entries.tui), "--mode", ended.next.mode], env);
    return;
  }
  if (ended.next.society !== undefined) {
    // `/society`: a fresh Society birth for this session's own project, never
    // this session resumed — no RESUME_SESSION_ENV and no saved history.
    // The child declared the name its gate freed; it is this project's
    // canonical name or the request does not stand.
    const project = defaultSocietyFor(cwd, sha256Hex(cwd));
    if (ended.next.society !== project)
      throw new StoreError("INVALID_REQUEST", `A Personal session can only start its own project's Society ${project}, not ${ended.next.society}`);
    process.chdir(cwd);
    process.execve(process.execPath, [process.execPath, ...process.execArgv, join(libdir, DEPLOYMENT_LAYOUT.entries.tui), "--society", project], env);
  }
  if (ended.next.session !== undefined) {
      const birth = await sessionBirthForHistory(options.dataRoot, ended.next.session, cwd);
      env[RESUME_SESSION_ENV] = ended.next.session;
      // Personal histories use their saved cwd, not the window they were found in.
      if (birth.mode === "personal") process.chdir(realpathSync(birth.cwd));
  }
  process.execve(process.execPath, [process.execPath, ...process.execArgv, join(libdir, DEPLOYMENT_LAYOUT.entries.tui),
    ...(ended.next.session === undefined ? ["--mode", "personal"] : [])], env);
}
