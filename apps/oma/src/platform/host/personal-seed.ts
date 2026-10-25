import { prepareHostProjectDirectory } from "@oma/platform-mac/files";
/** DR29 / MODE-006: observe first project choice, never guest paths on the Mac. */
import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { extensionEntryProblem } from "@oma/config/operations";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { readHostRecord } from "@oma/platform-mac/record";
import { bundledProjectBookmarks, type ProjectBookmarks } from "@oma/platform-mac/bookmark";
import { MacGit } from "@oma/git/host-project";
import { hostApiRequest } from "./api-client.js";
import { macBundleResources } from "@oma/platform-mac/bundle";

export async function macProjectExtensionSeed(dataRoot: string, cwd: string, libdir: string,
  observation?: { readonly bookmarks: ProjectBookmarks; readonly git: MacGit;
    readonly request: (projectId: string) => Promise<Record<string, unknown>> }): Promise<readonly string[]> {
  const projects = readHostRecord(join(dataRoot, "host-record.json"))?.projects ?? [];
  if (projects.length === 0) return [];
  const bookmarks = observation?.bookmarks ?? bundledProjectBookmarks(libdir);
  const git = observation?.git ?? new MacGit(join(macBundleResources(libdir), "git", "bin", "git"), prepareHostProjectDirectory);
  const matching: string[] = [];
  for (const project of projects) {
    const repo = realpathSync(await bookmarks.resolve(project.bookmark));
    const inside = relative(repo, cwd);
    if (inside === "" || (!inside.startsWith("../") && inside !== ".." && !inside.startsWith("/"))) {
      await git.verifyIdentity(repo, project);
      matching.push(project.projectId);
    }
  }
  if (matching.length === 0) return [];
  if (matching.length !== 1) throw new StoreError("INVALID_REQUEST", "This folder has multiple project bindings");
  let result: Record<string, unknown>;
  if (observation !== undefined) result = await observation.request(matching[0]!);
  else {
    let token: string;
    try { token = readFileSync(join(dataRoot, "run", "token"), "utf8").trim(); }
    catch { throw new StoreError("BROKER_UNAVAILABLE", "Project settings could not be observed; open the OMA app and its engine first"); }
    result = await hostApiRequest(join(dataRoot, "run", "hostapi.sock"), token, "project.extensions", { projectId: matching[0]! }, undefined, 30_000);
  }
  if (Object.keys(result).join(",") !== "extensions" || !Array.isArray(result.extensions) ||
      !result.extensions.every(entry => typeof entry === "string" && extensionEntryProblem(entry) === null) ||
      new Set(result.extensions).size !== result.extensions.length)
    throw new StoreError("BROKER_UNAVAILABLE", "Project extension choice could not be observed");
  return result.extensions.filter(entry => entry !== DEPLOYMENT_LAYOUT.extension) as string[];
}
