import test from "node:test";
test("Lifecycle rechecks current authority and attempts every Resident before releasing quiescence", async () => {
  await import("./installed-runtime.mjs");
});
