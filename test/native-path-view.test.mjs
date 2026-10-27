/** Pure path policy on two layouts, never a simulated Darwin kernel oracle. */
import test from "node:test";
import assert from "node:assert/strict";
import { residentPathView, RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { actorSocketPathAt } from "@oma/domain/paths";
import { decodeRunLease } from "@oma/protocol/run-lease";
import { macResidentPathView } from "@oma/platform-mac/path-view";

const directories = () => Object.fromEntries(["workspace", "home", "archive", "workerArchive", "selfMail", "view", "world", "projectGit", "projectMirror", "sessions"]
  .map(name => [name, `/private/var/한 글자/${name}`]));
const installation = { libdir: "/opt/oma installation", packages: "/opt/oma installation/packages" };
const endpoints = { socket: "/private/var/run/actor.sock", inference: "/private/var/run/inference.sock", egress: "/private/var/run/egress.sock" };
function assertView(layout) {
    const dirs = directories(), view = residentPathView(installation, dirs, endpoints, layout);
    const expected = (host, mounted) => layout === "host" ? host : mounted;
    assert.equal(view.map(`${installation.packages}/extension.ts`), expected(`${installation.packages}/extension.ts`, `${RESIDENT_PATHS.packages}/extension.ts`));
    assert.equal(view.map(endpoints.socket), expected(endpoints.socket, RESIDENT_PATHS.socket));
    assert.equal(view.map(endpoints.inference), expected(endpoints.inference, RESIDENT_PATHS.inference));
    assert.equal(view.map(endpoints.egress), expected(endpoints.egress, RESIDENT_PATHS.egress));
    const file = `${dirs.sessions}/한 글자.jsonl`;
    assert.equal(view.sessionPathToHost(view.map(file)), file);
    for (const suffix of ["", "/../wrong", "/nested/file.jsonl", "/./wrong", "X/file.jsonl", "/bad\0.jsonl"])
      assert.equal(view.sessionPathToHost(`${expected(dirs.sessions, RESIDENT_PATHS.sessions)}${suffix}`), null, suffix);
    for (const outside of ["/human/auth.json", `${dirs.workspace}-other/secret`, `${endpoints.socket}/fake`, `${installation.libdir}/../secret`])
      assert.throws(() => view.map(outside), { code: "AUTH_FAILED" });
    assert.equal(view.sessionPathToHost(view.map(`${dirs.workspace}/pretend.jsonl`)), null);
}
test("PathView mounted: one mapping covers paths, exact endpoints and session reversal", () => assertView("mounted"));
test("PathView host: one mapping covers paths, exact endpoints and session reversal", () => assertView("host"));
test("PathView policy freezes the session relation and admits no missing relay endpoint", () => {
  const dirs = directories(), original = dirs.sessions;
  const view = residentPathView(installation, dirs, { socket: endpoints.socket }, "host");
  dirs.sessions = "/human/private-sessions";
  assert.equal(view.sessionPathToHost(`${original}/session.jsonl`), `${original}/session.jsonl`);
  assert.throws(() => view.map(endpoints.inference), { code: "AUTH_FAILED" });
});
test("Mac PathView adapter requires the decoded root-bound lease without changing physical paths", () => {
  const dirs = directories(), runRoot = "/private/var/oma-run", actor = "alice";
  const socket = actorSocketPathAt(runRoot, actor, 1);
  const lease = decodeRunLease({ actor, incarnation: 1, socketHostPath: socket }, { actor, runRoot });
  const host = { ...installation, runRoot };
  const view = macResidentPathView(host, lease, dirs, { inference: endpoints.inference });
  assert.equal(view.map(dirs.workspace), dirs.workspace);
  assert.equal(view.map(socket), socket);
  assert.equal(view.map(endpoints.inference), endpoints.inference);
  assert.throws(() => macResidentPathView(host, { ...lease }, dirs), { code: "AUTH_FAILED" });
  assert.throws(() => macResidentPathView({ ...host, runRoot: "/other-run" }, lease, dirs), { code: "AUTH_FAILED" });
  assert.throws(() => macResidentPathView({ ...installation }, lease, dirs), { code: "UNSUPPORTED_PROFILE" });
});
