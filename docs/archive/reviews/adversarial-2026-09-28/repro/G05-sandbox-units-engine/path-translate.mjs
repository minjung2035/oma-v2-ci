import { hostSessionPath, confinedPath, RESIDENT_PATHS } from "../../../../dist/src/sandbox.js";

const dirs = {
  workspace: "/state/agents/w/workspace",
  home: "/state/agents/w/home",
  sessions: "/state/agents/w/sessions",
  archive: "/state/mail/archive",
  selfMail: "/state/mail/inboxes/w",
  view: "/state/agents/w/view",
  world: "/state/world",
  projectGit: "/state/repos/project.git",
  projectMirror: "/state/repos/project-mirror.git",
};

const cases = [
  "/run/oma-sessions/abc.json",
  "/run/oma-sessions/../../../etc/passwd",
  "/run/oma-sessions/a/b",
  "/run/oma-sessions/",
  "/run/oma-sessions/.",
  "/run/oma-sessions/..",
  "/run/oma-sessions/\0evil",
  "/run/oma-sessions/normal-name",
  "/etc/passwd",
  "/run/oma-sessionsXYZ/x", // prefix confusion
];
console.log("--- hostSessionPath ---");
for (const c of cases) console.log(JSON.stringify(c), "->", JSON.stringify(hostSessionPath(dirs, c)));

console.log("\n--- confinedPath ---");
const cp = [
  "/state/agents/w/workspace",
  "/state/agents/w/workspace/file.txt",
  "/state/agents/w/workspace-evil/x", // sibling prefix
  "/state/world/../mail/archive/secret",
  "/state/repos/project.git/HEAD",
  "/opt/oma",
];
for (const c of cp) {
  try { console.log(JSON.stringify(c), "->", JSON.stringify(confinedPath("/opt/oma", dirs, c))); }
  catch (e) { console.log(JSON.stringify(c), "-> THROW", e.code, e.message); }
}
