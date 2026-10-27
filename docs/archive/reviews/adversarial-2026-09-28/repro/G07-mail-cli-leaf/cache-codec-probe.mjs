import { decodeCachedRequest, decodeStreamDigest } from "../../../../dist/src/cli/cache-codec.js";
function t(name, v, key="cli-11111111-1111-4111-8111-111111111111") {
  const r = decodeCachedRequest(v, key);
  console.log(`${name}: ${r.ok ? "OK" : "REJECT " + r.reason}`);
}
const key = "cli-11111111-1111-4111-8111-111111111111";
t("proto-pollution", JSON.parse('{"key":"'+key+'","method":"mail.send","params":{"__proto__":{"x":1}},"createdAtMs":0,"lastReceipt":null}'));
t("extra-key", { key, method: "mail.send", params: {}, createdAtMs: 0, lastReceipt: null, evil: 1 });
t("key-mismatch", { key: "cli-22222222-2222-4222-8222-222222222222", method: "mail.send", params: {}, createdAtMs: 0, lastReceipt: null });
t("neg-timestamp", { key, method: "mail.send", params: {}, createdAtMs: -1, lastReceipt: null });
t("nonmutation-method", { key, method: "operation.get", params: {}, createdAtMs: 0, lastReceipt: null });
t("null-input", null);
t("array-input", []);
console.log("digest NaN:", JSON.stringify(decodeStreamDigest({ bytes: NaN, sha256: "a".repeat(64) })));
console.log("digest neg:", JSON.stringify(decodeStreamDigest({ bytes: -1, sha256: "a".repeat(64) })));
