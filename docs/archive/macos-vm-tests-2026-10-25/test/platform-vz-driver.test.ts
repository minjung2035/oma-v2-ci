import { connectSocket } from "#oma-test/app/platform/rpc";
/** macos-platform §2.1, §9.1, §9.3, MAC-701: the Node side of the VM helper's
 * channel, against a stand-in helper that speaks the same protocol. The
 * Swift helper itself is built and tested only on a Mac (mac-unit). */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StoreError } from "@oma/domain/errors";
import { VzDriver, type VzDeadlines } from "@oma/platform-mac/vz-driver";

const fakeHelper = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "test", "fixtures", "fake-vmhelper.mjs");

async function world(t: import("node:test").TestContext, env: Record<string, string> = {}, deadlines?: VzDeadlines) {
  const dir = mkdtempSync(join(tmpdir(), "oma-vz-"));
  // "Guest port 700": an echo service.
  const guestPath = join(dir, "guest-700.sock");
  const guest: Server = createServer(socket => { socket.on("data", (chunk: Buffer) => socket.write(Buffer.concat([Buffer.from("echo:"), chunk]))); });
  await new Promise<void>(resolve => guest.listen(guestPath, resolve));
  const driver = VzDriver.launch({ executable: process.execPath, argv: [fakeHelper],
    env: { PATH: process.env.PATH ?? "/usr/bin", FAKE_GUEST_PORT_700: guestPath, FAKE_KEYCHAIN: join(dir, "keychain.json"), ...env } },
    dir, { kernel: "k", initrd: "i", cmdline: "c", disks: [], cpus: 2, memoryBytes: 1 << 30, consoleLog: join(dir, "console.log"), ports: [700] }, connectSocket, deadlines);
  const stops: number[] = [];
  driver.onStopped(() => stops.push(Date.now()));
  t.after(async () => { driver.close(); await new Promise(r => guest.close(r)); rmSync(dir, { recursive: true, force: true }); });
  return { driver, stops, dir };
}
const until = async (condition: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise(r => setTimeout(r, 10));
  assert.ok(condition(), what);
};

test("§2.1: a started VM's guest port is one connection through the helper's port socket", async t => {
  const { driver } = await world(t);
  await driver.start();
  const socket = await driver.connect(700);
  socket.write("hi");
  const reply = await new Promise<string>(resolve => socket.once("data", chunk => resolve(String(chunk))));
  assert.equal(reply, "echo:hi");
  socket.destroy();
});

test("MAC-701/702: the Keychain is the helper's; an unreadable one is an error, not an empty item", async t => {
  const { driver } = await world(t);
  assert.equal(await driver.keychain.get("engine-managed"), undefined);
  await driver.keychain.put("engine-managed", '{"anthropic":{"type":"api_key","key":"k"}}');
  assert.equal(await driver.keychain.get("engine-managed"), '{"anthropic":{"type":"api_key","key":"k"}}');
  const locked = await world(t, { FAKE_KEYCHAIN_LOCKED: "1" });
  await assert.rejects(locked.driver.keychain.get("engine-managed"), (error: unknown) => error instanceof StoreError && /locked/.test(error.message));
});

test("DR39 native helper: the credential API exposes no VM control and remains usable after VM stop", async t => {
  const { driver } = await world(t);
  assert.equal("get" in driver, false);
  assert.equal("start" in driver.keychain, false);
  await driver.keychain.put("separate-api", "before");
  await driver.start(); await driver.forceStop();
  assert.equal(await driver.keychain.get("separate-api"), "before");
  await driver.keychain.put("separate-api", "after");
  assert.equal(await driver.keychain.get("separate-api"), "after");
});

test("§9.3: a forced stop, a guest power-off and the helper's own end are all the VM stopping", async t => {
  const forced = await world(t);
  await forced.driver.start();
  await forced.driver.forceStop();
  await until(() => forced.stops.length === 1, "a forced stop is reported");

  const helperDies = await world(t);
  await helperDies.driver.start();
  (helperDies.driver as unknown as { child: { kill(signal: string): void } }).child.kill("SIGKILL");
  await until(() => helperDies.stops.length === 1, "the VM ran inside the helper, so it stopped with it");
  await assert.rejects(helperDies.driver.keychain.get("x"), (error: unknown) => error instanceof StoreError && /helper ended/.test(error.message),
    "nothing more is asked of a helper that is gone");

  const powersOff = await world(t);
  await powersOff.driver.start();
  (powersOff.driver as unknown as { child: { kill(signal: string): void } }).child.kill("SIGUSR1");
  await until(() => powersOff.stops.length === 1, "the guest's own power-off is reported");
});

test("§9.1: the helper's sleep and wake reach the host", async t => {
  const { driver } = await world(t);
  const events: string[] = [];
  driver.onPower(event => events.push(event));
  await driver.start();
  (driver as unknown as { child: { kill(signal: string): void } }).child.kill("SIGUSR2");
  await until(() => events.length === 1, "the wake arrives");
  assert.deepEqual(events, ["wake"]);
});

test("AV-21: a credential answer whose value is not a string is an error, never an absence", async t => {
  const { driver, dir } = await world(t);
  writeFileSync(join(dir, "keychain.json"), JSON.stringify({ malformed: 42 }));
  await assert.rejects(driver.keychain.get("malformed"), (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
  assert.equal(await driver.keychain.get("absent"), undefined, "only the omitted value is absent");
});

test("NB-29: a helper that answers nothing does not hold the request forever", async t => {
  const { driver } = await world(t, { FAKE_KEYCHAIN_WEDGED: "1" }, { keychainMs: 80 });
  await assert.rejects(driver.keychain.get("engine-managed"),
    (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE" && /did not answer .* in time/.test(error.message));
  await assert.rejects(driver.keychain.get("engine-managed"),
    (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE" && /did not answer .* in time/.test(error.message),
    "the next request is bounded the same way");
});
