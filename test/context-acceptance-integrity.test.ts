import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { MailModule, parseEmlHeaders } from "../src/mail.js";
import { GitModule } from "../src/git.js";
import { isValidFullOid } from "../src/ids.js";
import { resolvedSpec, ALL_CAPS } from "./fixtures/spec.js";
import type { AuthContext, Oid } from "../implementation/contracts.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

test("CTX-003/DB-009: T-context-accept already freezes candidate and matching EML context", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-context-accept-"));
  const state = join(root, "state");
  mkdirSync(state, { recursive: true });
  const store = new Store(join(state, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: state, society: "demo" }, store, 16);
  const git = new GitModule(
    {
      stateRoot: state,
      projectGit: join(state, "repos", "project.git"),
      contextGit: join(state, "repos", "context.git"),
      worldDir: join(state, "world"),
      society: "demo",
      quarantineTmpBytes: 64 * 1024 * 1024,
      quarantineResources: {
        cpuSeconds: 30,
        memoryBytes: 512 * 1024 * 1024,
        tasks: 128,
      },
      checkTimeoutSeconds: 30,
    },
    store,
    mail,
    null,
  );
  const auth: AuthContext = {
    actor: "principal",
    incarnation: 0,
    role: "principal",
    channel: "actor",
    capabilities: new Set(["context.publish"]),
    peer: {
      pid: process.pid,
      uid: process.getuid!(),
      gid: process.getgid!(),
      cgroup: null,
    },
  };
  try {
    store.transaction(() => {
      store.insertAgent({
        name: "principal",
        specHash: "principal",
        role: "principal",
        desired: "enabled",
        incarnation: 0,
        profile: "p",
        createdBy: null,
        specJson: resolvedSpec(ALL_CAPS, "p", "principal"),
      });
    });

    let acceptedPlan: null | {
      candidate: string;
      message: {
        id: string;
        dateMs: number;
        contextRevision: string | null;
      };
    } = null;
    const transaction = store.transaction.bind(store);
    store.transaction = ((body: Parameters<typeof store.transaction>[0]) => {
      const result = transaction(body);
      if (!acceptedPlan) {
        const op = store.getOperation("principal", "ctx-preaccept");
        if (op?.kind === "context.publish" && op.state === "pending") {
          acceptedPlan = JSON.parse(op.planJson) as typeof acceptedPlan;
        }
      }
      return result;
    }) as typeof store.transaction;

    const goal = Buffer.from("# GOAL\nfreeze candidate before acceptance\n", "utf8");
    const receipt = await git.publishContext(
      auth,
      "ctx-preaccept",
      {
        expected: null,
        entries: [{ path: "GOAL.md", bytes: goal.length, sha256: sha256(goal) }],
        content: {
          bytes: goal.length,
          sha256: sha256(goal),
          mediaType: "application/vnd.oma.context-v1",
        },
      },
      once(goal),
    );
    assert.equal(receipt.state, "succeeded");
    assert.ok(acceptedPlan, "context operation was never observed at T-context-accept");
    assert.ok(isValidFullOid(acceptedPlan.candidate), "candidate must be frozen before acceptance");
    assert.equal(
      acceptedPlan.message.contextRevision,
      acceptedPlan.candidate,
      "MessagePlan contextRevision must equal the accepted candidate",
    );

    const object = mail.objectPath(acceptedPlan.message.id as never);
    assert.equal(existsSync(object), true);
    const headers = parseEmlHeaders(readFileSync(object, "utf8"));
    assert.equal(headers.omaContext, acceptedPlan.candidate);
    assert.equal(headers.dateMs, Math.floor(acceptedPlan.message.dateMs / 1000) * 1000);
    assert.equal((receipt.result as { revision: Oid }).revision, acceptedPlan.candidate);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
