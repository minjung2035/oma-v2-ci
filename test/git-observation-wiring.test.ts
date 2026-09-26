import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AuthContext, ResolvedAgentSpec } from "../implementation/contracts.js";
import { Store, StoreError } from "../src/store.js";
import { GitModule } from "../src/git.js";
import { MailModule } from "../src/mail.js";
import { GitObserver, type GitProcessEvidence } from "../src/git/observe.js";
import { requestHash, canonicalJson, sha256Hex } from "../src/hash.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";
import { resolvedSpec } from "./fixtures/spec.js";

const BASE = "1".repeat(40);
const CANDIDATE = "2".repeat(40);
const OP = "op-00000000-0000-4000-8000-000000000018";

for (const path of ["M secret.txt", "A", "tab\tname", "line\nname"]) {
  test(`normal and recovery protect the exact Git path ${JSON.stringify(path)} before CAS`, async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "oma-git-observation-wiring-"));
    const store = new Store(join(stateRoot, "runtime.sqlite"), 5, { society: "demo" });
    try {
      const specJson = resolvedSpec(["code.integrate"], "p", "principal");
      const spec = JSON.parse(specJson) as ResolvedAgentSpec;
      store.transaction(() => store.insertAgent({
        name: "principal", specHash: resolvedSpecDigest(spec), role: "principal", desired: "enabled",
        incarnation: 0, profile: "p", createdBy: null, specJson,
      }));
      const mail = new MailModule({ stateRoot, society: "demo" }, store, 16);
      const module = new GitModule({
        stateRoot, society: "demo", projectGit: join(stateRoot, "project.git"), contextGit: join(stateRoot, "context.git"),
        worldDir: join(stateRoot, "world"), quarantineTmpBytes: 1048576,
      }, store, mail, { policyRevision: "p1", protectedPaths: [path], checks: [] });
      const commands: string[][] = [];
      let casCalls = 0;
      const observe = new GitObserver(args => {
        commands.push([...args]);
        const response = (stdout = "", status = 0): GitProcessEvidence => ({
          status, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0),
        });
        if (args.includes("--show-object-format")) return response("sha1\n");
        if (args.includes("for-each-ref")) return response(`${CANDIDATE}\n`);
        if (args.includes("rev-parse")) return response(`${BASE}\n`);
        if (args.includes("--is-ancestor")) return response();
        if (args.includes("diff-tree")) return response(`M\0${path}\0`);
        throw new Error(`unexpected Git observation: ${JSON.stringify(args)}`);
      });
      assert.ok(Reflect.get(module, "observations") instanceof GitObserver, "keep the production observation seam connected");
      assert.equal(typeof Reflect.get(module, "casRef"), "function");
      Object.defineProperty(module, "observations", { value: observe, configurable: true });
      Object.defineProperty(module, "casRef", {
        configurable: true,
        value: () => { casCalls++; throw new Error("a protected path must never reach CAS"); },
      });
      const auth: AuthContext = {
        actor: "principal", incarnation: 0, role: "principal", channel: "actor", capabilities: new Set(["code.integrate"]),
        peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null },
      };
      const input = { candidate: CANDIDATE, expected: BASE };
      const protectedFailure = (error: unknown): boolean => error instanceof StoreError && error.code === "PROTECTED_PATH";
      await assert.rejects(module.integrate(auth, "normal-protected", input), protectedFailure);
      const normal = store.getOperation(auth.actor, "normal-protected");
      assert.ok(normal);
      assert.equal(normal.state, "failed");
      assert.equal(normal.errorCode, "PROTECTED_PATH");
      const normalDiff = commands.filter(args => args.includes("diff-tree"));
      assert.equal(normalDiff.length, 1);
      const plan = {
        kind: "git.integrate", repo: "project", target: "refs/heads/main", base: BASE, candidate: CANDIDATE,
        policyRevision: "p1", checkProfileDigest: sha256Hex(canonicalJson([])),
      };
      store.transaction(() => store.claimOperation({
        id: OP, actor: auth.actor, requestKey: "recovery-protected", requestHash: requestHash("git.integrate", input),
        kind: "git.integrate", payloadJson: JSON.stringify(input), planJson: JSON.stringify(plan),
      }));
      assert.equal(store.getOperationById(OP)?.state, "pending", "a valid accepted recovery positive control");
      commands.length = 0;
      await assert.rejects(module.reconcile(OP), protectedFailure);
      assert.deepEqual(commands.filter(args => args.includes("diff-tree")), normalDiff);
      assert.equal(casCalls, 0);
      const recovered = store.getOperationById(OP);
      assert.equal(recovered?.state, "failed");
      assert.equal(recovered?.errorCode, "PROTECTED_PATH");
    } finally { store.close(); rmSync(stateRoot, { recursive: true, force: true }); }
  });
}
