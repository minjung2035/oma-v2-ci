#!/usr/bin/env node
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
/** Unqualified functional smoke only. It deliberately bypasses production READY,
 * systemd and platform qualification; a pass is never release evidence. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "@oma/storage";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { PiAdapter } from "@oma/engine/pi-adapter";
import {
  publishDeliveryReceipt,
} from "@oma/storage/delivery-receipt";
import {
  agentRootPathAt,
  runnerReceiptPathAt,
  runnerSessionDirPathAt,
  runnerViewPathAt,
  workspacePathAt,
} from "@oma/domain/paths";
import { ALL_CAPS, storedSpec } from "../../dist/test/fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "../../dist/test/fixtures/limits.js";
import { enterBoundedScript } from "../../scripts/bounded-script.mjs";
const FUNCTIONAL_LIMITS = Object.freeze({
  ...TEST_VIEW_LIMITS,
  idleStreamSeconds: 120,
  receiptWaitSeconds: 15,
  mailBodyBytes: 1024 * 1024,
});

if (await enterBoundedScript(import.meta.url)) {
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const provider = option("--provider") ?? "pi";
const model = option("--model") ?? "current";
const keep = args.includes("--keep");
const root = mkdtempSync(join(tmpdir(), "oma-functional-pi-"));
const state = join(root, "state");
mkdirSync(state, { recursive: true });
const store = new Store(join(state, "runtime.sqlite"));
const auth = (actor) => ({
  actor,
  incarnation: 1,
  role: "resident",
  channel: "actor",
  capabilities: new Set(["mail.send"]),
  peer: {
    pid: process.pid,
    uid: process.getuid?.() ?? -1,
    gid: process.getgid?.() ?? -1,
  },
});
try {
  console.error(
    `UNQUALIFIED functional profile: systemd/READY/platform qualification is not tested; root=${root}`,
  );
  store.transaction(() => {
    for (const name of ["sender", "receiver"])
      store.insertAgent({
        name,
        ...storedSpec(ALL_CAPS, "functional", name),
        role: "resident",
        desired: "enabled",
        incarnation: 1,
        profile: "functional",
        createdBy: null,
      });
  });
  const mail = createMailModule(
    { stateRoot: state, society: "functional" },
    store,
    64,
    FUNCTIONAL_LIMITS.batchMaxMessages,
    FUNCTIONAL_LIMITS,
  );
  await mail.send(auth("sender"), "functional-mail", {
    to: ["receiver"],
    subject: "functional Pi smoke",
    kind: "question",
    body: "Read this message and finish the turn with a short acknowledgement.",
  });
  const batch = await mail.prepare(auth("receiver"));
  if (!batch) throw new Error("functional batch was not prepared");
  const workspace = workspacePathAt(state, "receiver");
  const agentHome = join(agentRootPathAt(state, "receiver"), "home");
  const sessions = runnerSessionDirPathAt(state, "receiver");
  for (const path of [workspace, agentHome, sessions])
    mkdirSync(path, { recursive: true });
  const adapter = new PiAdapter({
    actor: "receiver",
    society: "functional",
    limits: FUNCTIONAL_LIMITS,
    profile: {
      provider,
      model,
      extensions: [],
      prompt:
        "This is an OMA functional smoke. You must call oma_mail_read once with the exact archive path from the delivery notice, then finish with a short acknowledgement. Do not send mail or call status.",
    },
    paths: {
      piCommand: process.env.OMA_PI_COMMAND ?? "/usr/bin/pi",
      coreExtension: resolve("packages/extension/dist/index.js"),
      cli: resolve("apps/oma/dist/cli.js"),
      workspace,
      sessionDir: sessions,
      agentHome,
      mailArchive: join(state, "mail", "archive", "cur"),
      batchView: runnerViewPathAt(state, "receiver"),
      socket: join(root, "unused-control.sock"),
    },
  });
  const boundary = await adapter.deliver(batch);
  const entries = readFileSync(boundary.sessionPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const messages = entries
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message);
  const assistants = messages.filter((message) => message.role === "assistant");
  const toolResults = messages.filter(
    (message) => message.role === "toolResult",
  );
  const mailReads = toolResults.filter(
    (message) => message.toolName === "oma_mail_read",
  );
  if (
    mailReads.length !== 1 ||
    mailReads[0].isError ||
    toolResults.some((message) => message.isError)
  )
    throw new Error(
      "functional Pi did not read the delivered mail exactly once without tool errors",
    );
  const finalAssistant = assistants.at(-1);
  if (!finalAssistant || finalAssistant.stopReason !== "stop")
    throw new Error(
      "functional Pi did not finish with a terminal assistant response",
    );
  const receipt = publishDeliveryReceipt(
    state,
    batch,
    boundary,
    FUNCTIONAL_LIMITS.frameBytes,
  );
  await mail.complete(auth("receiver"), {
    batchId: batch.id,
    incarnation: batch.incarnation,
    sessionPath: receipt.sessionPath,
    adapterRevision: PI_ADAPTER_REVISION,
    receiptPath: runnerReceiptPathAt(state, "receiver", batch.id),
  });
  const row = store.getBatch(batch.id);
  const delivery = store.getDelivery(batch.messageIds[0], "receiver");
  if (row?.state !== "completed" || delivery?.presented !== 1)
    throw new Error("durable completion did not converge");
  console.log(
    JSON.stringify({
      status: "FUNCTIONAL_PI_PASS_UNQUALIFIED",
      requested: { provider, model },
      actual: {
        provider: finalAssistant.provider,
        model: finalAssistant.model,
      },
      mailReads: mailReads.length,
      batch: batch.id,
      sessionPersisted: row.sessionPath === receipt.sessionPath,
      presented: delivery.presented,
    }),
  );
} finally {
  store.close();
  if (!keep) rmSync(root, { recursive: true, force: true });
  else console.error(`preserved functional profile at ${root}`);
}
}
