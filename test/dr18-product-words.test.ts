/** DR18 (D-1, MAC-022): on a Mac's screen the TUI shows only product text;
 * the original words go to the guest's log. On Linux they are shown as they
 * are. Each case runs in a child process, whose environment and streams are
 * its own. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const words = fileURLToPath(new URL("../src/tui/words.js", import.meta.url));
const exit = fileURLToPath(new URL("../src/tui/exit.js", import.meta.url));

function run(script: string, productText: boolean): { stdout: string; stderr: string; status: number | null } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
  if (productText) env.OMA_PRODUCT_TEXT = "1";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

const leaking = `Object.assign(new Error("ENOENT: no such file or directory, open '/var/lib/oma/societies/a/config.json'"), { code: "ENOENT" })`;

test("DR18 D-1: on a Mac's screen an error naming a Linux path is shown as its code, and the original goes to the log", () => {
  const script = `import { errorWords } from ${JSON.stringify(words)};
process.stdout.write("screen:" + errorWords(${leaking}) + "\\n");
process.stdout.write("screen:" + errorWords(${leaking}) + "\\n");`;
  const mac = run(script, true);
  assert.equal(mac.status, 0, mac.stderr);
  assert.doesNotMatch(mac.stdout, /\/var\/lib|ENOENT/);
  assert.match(mac.stdout, /screen:오류 코드 [A-Z_]+\n/);
  // The original is in the log, once for two readings of the same words.
  assert.equal(mac.stderr.split("/var/lib/oma/societies/a/config.json").length - 1, 1);
  const linux = run(script, false);
  assert.match(linux.stdout, /screen:ENOENT: no such file or directory, open '\/var\/lib\/oma\/societies\/a\/config\.json'/);
  assert.equal(linux.stderr, "");
});

test("DR18 D-1: product text passes unchanged on a Mac's screen", () => {
  const mac = run(`import { errorWords, surfaceWords } from ${JSON.stringify(words)};
process.stdout.write(errorWords(new Error("설정 파일의 형식이 맞지 않습니다")) + "|" + surfaceWords("broker 관측 없음", "x"));`, true);
  assert.equal(mac.stdout, "설정 파일의 형식이 맞지 않습니다|broker 관측 없음");
  assert.equal(mac.stderr, "");
});

test("DR18 D-1: a failure's message reaches the Human's screen: stdout on a Mac (stderr is the log there), stderr on Linux", () => {
  const script = `import { fail } from ${JSON.stringify(exit)}; fail("설정을 읽을 수 없습니다", 2);`;
  const mac = run(script, true);
  assert.equal(mac.status, 2);
  assert.equal(mac.stdout, "oma: 설정을 읽을 수 없습니다\n");
  const linux = run(script, false);
  assert.equal(linux.status, 2);
  assert.equal(linux.stderr, "oma: 설정을 읽을 수 없습니다\n");
  assert.equal(linux.stdout, "");
});
