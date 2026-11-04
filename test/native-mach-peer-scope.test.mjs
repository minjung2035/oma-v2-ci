/** Real kernel sender and CID mechanics; no actor/run is admitted here. */
import test from "node:test";
import assert from "node:assert/strict";
import { createMachEndpoint } from "@oma/native/mach-message";
import { identifyDarwinCoalition } from "@oma/native/audit-session";
import { bindMachSender } from "@oma/platform-mac/audit-peer";

test("001. Actual Mach peer membership requires the pinned kernel sender's exact physical boot and CID", { timeout: 15000 }, async () => {
  if (process.platform !== "darwin") return assert.throws(createMachEndpoint, { code: "UNSUPPORTED_PROFILE" });
  const endpoint = createMachEndpoint(); let binding, peer, message;
  try {
    assert.equal(endpoint.send.send(0x4f4d4181, Buffer.alloc(4)), "sent");
    message = endpoint.receive.receive(); assert.equal(message.kind, "data"); assert.equal(message.reply, null);
    binding = bindMachSender(message.sender); await binding.ready; peer = binding.take();
    const identity = identifyDarwinCoalition(process.pid);
    assert.equal(peer.sameSender(message.sender), true); assert.equal(peer.sameSender({ ...message.sender }), false);
    assert.equal(peer.inScope(identity), true);
    for (const other of [null, {}, { kind: "darwin-audit-session", auditSession: message.sender.auditSession },
      { ...identity, coalitionId: String(BigInt(identity.coalitionId) + 1n) }, { ...identity, coalitionId: Number(identity.coalitionId) },
      { ...identity, bootId: "00000000-0000-0000-0000-000000000000" }, { ...identity, actor: "forged" }])
      assert.equal(peer.inScope(other), false);
    peer.close(); assert.equal(peer.inScope(identity), false); assert.equal(peer.sameSender(message.sender), false);
  } finally {
    try { peer?.close(); } finally {
      try { await binding?.close(); } finally {
        try { message?.reply?.close(); } finally { try { endpoint.send.close(); } finally { endpoint.receive.close(); } }
      }
    }
  }
});
