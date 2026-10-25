// D03/WP03: one launch location, decided by the host and carried verbatim.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { hostLaunchLocation, launchedLocation, launchedPath, launchLocationArgv } from "#oma-test/app/runtime/assets";
import { renderUnit, renderedExecArgv, UNIT_TPL_DIR } from "@oma/platform-linux/units";

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

const residentValues = {
  node: "/n", libdir: "/l", state: "/s p/oma/demo", society: "demo", agent: "a", config: "/c $%/x.json", run: "/r/oma/demo",
  profileHex: "70", modelProfileHex: "6d64", toolSurfaceHex: "7b7d",
};

test("D03 resident unit: the product runs the broker, so nothing is bound and the location lands as exact ExecStart words", () => {
  const template = readFileSync(join(UNIT_TPL_DIR, "resident.service.in"), "utf8");
  const product = renderUnit(template, { ...residentValues });
  assert.doesNotMatch(product, /^(BindsTo|After|Requires)=/m);
  assert.match(product, /^ExecStart=\/n \/l\/apps\/oma\/dist\/entry\/runner\.js --society demo --agent a --config \/c\\x20\$\$%%\/x\.json --state-root \/s\\x20p\/oma\/demo --run-root \/r\/oma\/demo$/m);
  // The path unit watches the inbox under the same root, verbatim.
  assert.match(renderUnit(readFileSync(join(UNIT_TPL_DIR, "resident.path.in"), "utf8"), residentValues),
    /^DirectoryNotEmpty=\/s p\/oma\/demo\/mail\/inboxes\/a\/new$/m);
});

test("D03 resident unit: a missing location is refused, never defaulted", () => {
  const template = readFileSync(join(UNIT_TPL_DIR, "resident.service.in"), "utf8");
  const { config: _config, ...noConfig } = residentValues;
  assert.throws(() => renderUnit(template, { ...noConfig }), /unit template input is missing: CONFIG_ARG/);
  const { run: _run, ...noRun } = residentValues;
  assert.throws(() => renderUnit(template, { ...noRun }), /unit template input is missing: RUN_ARG/);
  const host = renderUnit(readFileSync(join(UNIT_TPL_DIR, "principal-relay.service.in"), "utf8"), { ...residentValues });
  assert.doesNotMatch(host, /^(BindsTo|After|Requires)=/m);
  assert.match(host, / --run-root \/r\/oma\/demo$/m);
});

test("D03 effective ExecStart: the words systemd reports are the rendered ones, escapes undone", () => {
  const rendered = renderUnit(readFileSync(join(UNIT_TPL_DIR, "resident.service.in"), "utf8"), { ...residentValues });
  // `$$` stays until execution; C escapes and specifiers are resolved at load.
  assert.deepEqual(renderedExecArgv(rendered), ["/n", "/l/apps/oma/dist/entry/runner.js", "--society", "demo", "--agent", "a",
    "--config", "/c $$%/x.json", "--state-root", "/s p/oma/demo", "--run-root", "/r/oma/demo"]);
  assert.equal(renderedExecArgv("[Path]\nDirectoryNotEmpty=/x\n"), null);
});
