// D03/WP03: one launch location, decided by the host and carried verbatim.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { hostLaunchLocation, launchedLocation, launchedPath, launchLocationArgv } from "#oma-test/app/runtime/assets";

test("D03 host location: XDG roots from the host's environment and an absolute config path", () => {
  const custom = hostLaunchLocation("demo", { XDG_DATA_HOME: "/d", XDG_RUNTIME_DIR: "/r", HOME: "/h" }, "rel/c.json");
  assert.deepEqual({ ...custom }, { society: "demo", stateRoot: "/d/oma/demo", runRoot: "/r/oma/demo", configPath: join(process.cwd(), "rel/c.json") });
  const fallback = hostLaunchLocation("demo", { HOME: "/h" });
  assert.deepEqual({ ...fallback }, { society: "demo", stateRoot: "/h/.local/share/oma/demo", runRoot: "/tmp/oma/demo", configPath: "/h/.local/share/oma/demo/config.json" });
  assert.deepEqual(launchedLocation(["--society", "demo", ...launchLocationArgv(custom)], "demo"), custom);
});

test("D03 host location: an environment with no data root is said, never /tmp", () => {
  // A process whose environment holds neither XDG_DATA_HOME nor HOME has no
  // data root at all; writing a society's state under a guessed /tmp would be
  // a shared-space write nobody asked for. It is named instead.
  for (const env of [{}, { HOME: "" }, { XDG_DATA_HOME: "", HOME: "" }])
    assert.throws(() => hostLaunchLocation("demo", env),
      (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /HOME/.test(error.message),
      JSON.stringify(env));
  // An explicit data root needs no HOME at all.
  const rooted = hostLaunchLocation("demo", { XDG_DATA_HOME: "/d" });
  assert.equal(rooted.stateRoot, "/d/oma/demo");
});

test("D03 launched location: every part given once, normalized, absolute and naming this society", () => {
  const good = ["--config", "/c/x.json", "--state-root", "/d/oma/demo", "--run-root", "/r/oma/demo"];
  assert.equal(launchedLocation(good, "demo").configPath, "/c/x.json");
  const refused: string[][] = [
    good.slice(2),                                             // no config: no default is chosen for it
    ["--config", "/c/x.json", "--run-root", "/r/oma/demo"],    // no state root
    [...good, "--run-root", "/r/oma/demo"],                    // given twice
    ["--config", "c.json", ...good.slice(2)],                  // relative
    ["--config", "/c/../x.json", ...good.slice(2)],            // denormalized
    ["--config", "/c/x.json", "--state-root", "/d/oma/other", "--run-root", "/r/oma/demo"],   // another society
    ["--config", "/c/x.json", "--state-root", "/d/demo", "--run-root", "/r/oma/demo"],        // not an OMA root
    ["--config", "/c/x.json", "--state-root", "/d/oma/demo", "--run-root"],                   // flag without value
  ];
  for (const args of refused) assert.throws(() => launchedLocation(args, "demo"), { code: "UNSUPPORTED_PROFILE" }, JSON.stringify(args));
  assert.equal(launchedPath(["--run-root", "/r/oma/demo"], "runRoot", "demo"), "/r/oma/demo");
});

// Literal runner argv and custom roots are verified through the actual broker
// entry in NATIVE-TOPO-01/02, rather than a removed service renderer.
