import test from "node:test";
test("Review public API rechecks current eligible votes and cancellation before CAS", async () => {
  await import("./installed-runtime.mjs");
});
