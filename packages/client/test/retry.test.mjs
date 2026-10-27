import test from "node:test";
import assert from "node:assert/strict";
import { RequestService } from "@oma/client/request-service";
import { installRuntime } from "@oma/client/runtime";
import { snapshotJson } from "@oma/domain/canonical-json";
import { requestParamsEqual } from "@oma/domain/request-identity";
import { decodeReceipt, decodeFailure } from "@oma/protocol/receipt-codec";
import { isRequestNotFound, receiptExit } from "@oma/protocol/receipts";

test("a lost answer only queries the original key; changed payload cannot be resent", async () => {
  installRuntime({ snapshot: snapshotJson, paramsEqual: requestParamsEqual, decodeReceipt, decodeFailure,
    notFound: isRequestNotFound, receiptExit, cacheFailure: () => null });
  let frozen;
  const cache = {
    read: () => frozen ? { kind: "present", value: frozen } : { kind: "absent" },
    freeze: value => { frozen = { ...value, lastReceipt: null }; return { kind: "created", value: frozen }; },
    updateReceipt: () => { throw new Error("an unknown acceptance has no receipt"); },
  };
  const calls = [];
  const service = new RequestService(cache, async method => { calls.push(method); throw new Error("connection lost"); });
  const params = { to: ["bob"], subject: "frozen", body: "original", kind: "message" };
  await assert.rejects(service.send("mail.send", params, "same-key"), /Acceptance status unknown/);
  assert.deepEqual(calls, ["mail.send", "operation.get"]);
  await assert.rejects(service.send("mail.send", params, "same-key"), /Acceptance status unknown/);
  assert.deepEqual(calls, ["mail.send", "operation.get", "operation.get"]);
  await assert.rejects(service.send("mail.send", { ...params, body: "new bytes" }, "same-key"), /REQUEST_KEY_REUSED/);
  assert.deepEqual(calls, ["mail.send", "operation.get", "operation.get"]);
  assert.equal(frozen.params.body, "original");
});
