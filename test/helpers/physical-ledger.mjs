import { serializePlanIntent } from "../../dist/test/fixtures/plan.js";
/** Test-only current accepted fixture. Production never imports this file. */
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, readDiagnosticSnapshot } from "@oma/storage";
import { agentRecord } from "./ledger-fixture.mjs";
import { generateOperationId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { sha256Hex } from "@oma/domain/canonical-json";
import { requestHash } from "@oma/domain/request-identity";
import { ensureDurableDirectory, writeExclusiveFsyncedFile } from "@oma/storage/durable-fs";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { publishedRefFor } from "@oma/domain/derived";
import { mailObjectPathAt, mailArchivePathAt, mailInboxPathAt, contextStagingPathAt } from "@oma/domain/paths";
import { rfc5322Date } from "@oma/mail/headers";
/** Published context revisions are 0555; cleanup needs the owner write bit
 * on every directory it empties (mirrors test/fixtures/cleanup.ts). */
export function removeTree(root) {
  if (!existsSync(root)) return;
  const restore = path => {
    let stat;
    try { stat = lstatSync(path); } catch { return; }
    if (!stat.isDirectory()) return;
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) restore(join(path, name));
  };
  restore(root);
  rmSync(root, { recursive: true, force: true });
}
export function physicalLedger(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-integrity-"));
  let store = new Store(join(root, "runtime.sqlite"), 0, { society: "fixture" });
  store.transaction(tx => { tx.agents.insert(agentRecord("principal")); tx.agents.insert(agentRecord("alice", "principal")); });
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  const id = generateOperationId(), messageId = generateMessageId(id, 0), dateMs = Math.floor(Date.now() / 1000) * 1000;
  const body = "the immutable fixture\n";
  const kind = options.kind ?? "mail.send";
  const messageKind = kind === "context.publish" ? "context" : kind === "git.submit" ? "result" : "message";
  const to = kind === "context.publish" ? ["residents"] : ["alice"];
  const candidate = options.candidate;
  if (!["mail.send", "context.publish", "git.submit"].includes(kind)) throw new Error("unsupported fixture kind");
  const headerText = [
    `Date: ${rfc5322Date(dateMs)}`, "From: alice@fixture.oma.invalid", `To: ${to[0]}@fixture.oma.invalid`,
    "Reply-To: alice@fixture.oma.invalid", `Message-ID: <${messageId}@fixture.oma.invalid>`,
    "Subject: fixture", `X-OMA-Kind: ${messageKind}`, ...(kind === "context.publish" ? [`X-OMA-Context: ${candidate}`] : []), "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit", "", body,
  ].join("\r\n");
  const bytes = Buffer.from(options.editHeaders ? options.editHeaders(headerText) : headerText);
  const payload = kind === "mail.send" ? { to, subject: "fixture", body, kind: "message" } :
    kind === "git.submit" ? { candidate, exportRef: "refs/oma/export/fixture", prerequisites: [], to, subject: "fixture", body, paths: [] } :
    { expected: null, entries: options.entries, content: { bytes: options.entries.reduce((n, e) => n + e.bytes, 0),
      sha256: options.contentHash, mediaType: "application/vnd.oma.context-v1" } };
  const message = { id: messageId, objectPath: `mail/objects/${messageId}.eml`, sha256: sha256Hex(bytes), bytes: bytes.length,
    dateMs, to, recipients: ["alice"], kind: messageKind, contextRevision: kind === "context.publish" ? candidate : null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } };
  const object = mailObjectPathAt(root, messageId), archive = mailArchivePathAt(root, messageId);
  ensureDurableDirectory(join(root, "mail/objects")); writeExclusiveFsyncedFile(object, bytes, 0o444);
  const plan = kind === "mail.send" ? { kind, message } : kind === "git.submit" ?
    { kind, candidate, exportRef: payload.exportRef, prerequisites: [], bundle: null, publishedRef: publishedRefFor("alice", id), message } :
    { kind, base: null, candidate, noopRef: null, target: "refs/heads/main", entries: options.entries, stagingPath: contextStagingPathAt(root, id), message };
  store.transaction(tx => {
    tx.operations.insert({ id, actor: "alice", requestKey: randomUUID(), requestHash: requestHash(kind, payload),
      kind, payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan) });
    tx.deliveries.insert([{ messageId, recipient: "alice", operationId: id }]);
  });
  return { root, id, message, bytes, object, archive, kind, plan, context: { stateRoot: root, society: "fixture" },
    get store() { return store; },
    reopen() { store.close(); store = new Store(join(root, "runtime.sqlite"), 0, { society: "fixture" }); return store; },
    snapshot() { return readDiagnosticSnapshot(root); },
    inbox(folder = "new") { return mailInboxPathAt(root, "alice", messageId, folder); },
    publish(mark = true) {
      publishImmutableFile(object, archive, message.sha256);
      publishImmutableFile(object, mailInboxPathAt(root, "alice", messageId, "new"), message.sha256);
      if (mark) store.transaction(tx => tx.deliveries.materialize(messageId, "alice"));
    },
  };
}
