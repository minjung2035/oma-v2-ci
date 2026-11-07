import test from "node:test";
import assert from "node:assert/strict";
import { StoreError } from "@oma/domain/errors";
import { callerGit } from "#oma-test/app/runtime/caller-git";
import { clientEnvironment } from "@oma/extension/mail-tools";

const DARWIN = { DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer", GIT_EXEC_PATH: "/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core" };
function on<T>(platform: NodeJS.Platform, action: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...original, value: platform });
  try { return action(); } finally { Object.defineProperty(process, "platform", original); }
}

test("001. A Mac Worker's caller git is its launch's developer git, never the xcrun shim it cannot run", () => {
  assert.deepEqual(on("darwin", () => callerGit(DARWIN)), { executable: `${DARWIN.DEVELOPER_DIR}/usr/bin/git`, env: DARWIN });
});

test("002. Without both launch-fixed entries, and on Linux, the caller keeps /usr/bin/git", () => {
  for (const env of [{}, { DEVELOPER_DIR: DARWIN.DEVELOPER_DIR }, { GIT_EXEC_PATH: DARWIN.GIT_EXEC_PATH }])
    assert.deepEqual(on("darwin", () => callerGit(env)), { executable: "/usr/bin/git", env: {} });
  assert.deepEqual(on("linux", () => callerGit(DARWIN)), { executable: "/usr/bin/git", env: {} });
});

test("003. A developer root outside the closed developer-tools grammar is refused, not executed", () => {
  for (const env of [{ DEVELOPER_DIR: "/tmp/evil", GIT_EXEC_PATH: "/tmp/evil/libexec" },
    { DEVELOPER_DIR: DARWIN.DEVELOPER_DIR, GIT_EXEC_PATH: "/tmp/git-core" }])
    assert.throws(() => on("darwin", () => callerGit(env)), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
});

test("004. The Worker tools' client carries the launch-fixed developer git entries the caller git reads", () => {
  const saved = { DEVELOPER_DIR: process.env.DEVELOPER_DIR, GIT_EXEC_PATH: process.env.GIT_EXEC_PATH };
  try {
    Object.assign(process.env, DARWIN);
    const forwarded = clientEnvironment("/h", "/s", "/a");
    assert.deepEqual(on("darwin", () => callerGit(forwarded)).env, DARWIN);
  } finally {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
