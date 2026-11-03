/** Real review/Mail/Git ledger and frozen patch records, not provider qualification. */
import test from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, readFileSync, readdirSync, chmodSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { CollaborationReviewViews } from "#oma-test/app/views/collaboration-reviews";
import { fixture, messageText } from "./fixtures/review-fixture.js";
import { createHash } from "node:crypto";
import type { ReviewSourceRecord } from "@oma/contracts/files";
import { CollaborationReviewMaterials } from "#oma-test/app/views/collaboration-review-materials";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { publishNoReplace } from "@oma/storage/durable-fs";
import { readImmutableBytes } from "@oma/storage/immutable-file";
import { runProcessSync } from "@oma/process/run";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { runGitText } from "@oma/process/policies";
import { containWorkspaceTools } from "@oma/tool-runtime/contained-tools";

function discovery(root: string): string {
  const pending = [join(root, "reviews/index.md")], seen = new Set<string>(), documents: string[] = [];
  while (pending.length) {
    const path = pending.pop()!;
    assert.ok(!seen.has(path), "discovery must not cycle or repeat a subtree"); seen.add(path);
    const text = readFileSync(path, "utf8"); documents.push(text);
    for (const match of text.matchAll(/^Child: (.+)$/gm)) {
      assert.match(match[1]!, /^\/oma\/reviews\/pages\/[a-f0-9]{64}\.md$/u);
      pending.push(join(root, match[1]!.slice("/oma/".length)));
    }
  }
  return documents.join("\n");
}

function setup(t: test.TestContext) {
  const f = fixture(); t.after(() => f.close());
  const records = new CollaborationReviewViews(f.store, f.root, f.module, 4096);
  const root = (actor = "bob") => join(f.root, "agents", actor, "records");
  const publish = (actor = "bob") => records.publish(f.auth(actor), f.reviews.observeRecords(f.auth(actor)), "2026-11-01T00:00:00.000Z");
  return { f, records, root, publish };
}

test("001. Completion discovery: normal and compact notices use ordinary role-scoped records, never retired callable readers", async t => {
  for (const compact of [false, true]) await t.test(`002. Collaboration review records: ${compact ? "compact metadata notice" : "complete notice"}`, async () => {
    const f = fixture({ bundleBytes: compact ? 2048 : 256 * 1024 });
    try {
      const candidate = f.candidateWith({ "exact.txt": "original applied patch bytes\n" });
      await f.submit("alice", candidate);
      await f.open("alice", { tier: "LOW", candidate, reason: compact ? "Explain the change. ".repeat(500) : "small change" }, "notice-records");
      const open = f.store.getOperation("alice", "notice-records")!;
      const integration = f.store.getOperation("alice", applyRequestKeyFor(open.id));
      assert.ok(integration?.kind === "git.integrate" && integration.plan.merge?.version === 3);
      assert.equal(integration.state, "succeeded");
      const notice = integration.plan.merge.notice.map(plan => messageText(f.root, plan.id)).join("\n");
      assert.doesNotMatch(notice, /oma_review_diff|cursor=next|oma_review_show/u, "fresh notices cannot advertise removed tools");
      const relative = notice.match(/Read (reviews\/op-[0-9a-f-]+\/status\.md) under your declared record_root/u)?.[1];
      assert.equal(relative, `reviews/${open.id}/status.md`, "discovery is bound to the actual source request, not a guessed name or a foreign root");
      assert.match(notice, /permitted status and exact material paths/);
      assert.match(notice, /observations, not execution authority/);
      assert.equal(notice.includes("Reason:"), !compact, "both full and metadata-only generation branches are exercised");
      const frozen = f.store.acceptedOperationPage();
      const archives = integration.plan.merge.notice.map(plan => ({ path: join(f.root, "mail", "archive", "cur", `${plan.id}:2,`),
        bytes: readFileSync(join(f.root, "mail", "archive", "cur", `${plan.id}:2,`)) }));
      const canonical = runGitText(["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", f.base, candidate], { gitDir: f.projectGit });
      assert.equal(canonical.status, 0, canonical.stderr);
      const records = new CollaborationReviewViews(f.store, f.root, f.module, 64 * 1024);
      const roots = new Map<string, string>();
      for (const actor of ["bob", "principal"]) {
        const auth = f.auth(actor), root = join(f.root, "agents", actor, "records"); roots.set(actor, root);
        const report = records.publish(auth, f.reviews.observeRecords(auth), "2026-11-01T00:00:00.000Z");
        assert.equal(report.failed, 0); assert.ok(report.requests.includes(open.id));
        const workspace = join(f.root, `reader-${actor}`); mkdirSync(workspace);
        type Reader = { execute(id: string, input: { path: string }): Promise<{ content: { text?: string }[] }> };
        let reader: Reader | undefined;
        containWorkspaceTools({ registerTool: (tool: { name: string }) => { if (tool.name === "read") reader = tool as unknown as Reader; } } as never,
          workspace, false, true, [root]);
        assert.ok(reader);
        const read = async (path: string) => (await reader!.execute("notice-record", { path })).content.map(part => part.text ?? "").join("\n");
        const status = await read(join(root, relative!));
        assert.match(status, /Display: applied/);
        if (actor === "bob") {
          // Fixture-only mapping of the Worker's displayed /oma mount to its
          // physical record directory; an actual mounted Worker is a separate lane.
          const physical = (displayed: string) => {
            assert.ok(displayed.startsWith("/oma/"), `unexpected published Worker path: ${displayed}`);
            return join(root, displayed.slice("/oma/".length));
          };
          const pending = [join(root, "reviews", open.id, "materials", "index.md")], seen = new Set<string>(), pages: string[] = [];
          while (pending.length) {
            const page = pending.pop()!;
            assert.ok(!seen.has(page), "material discovery cannot cycle"); seen.add(page);
            const text = await read(page); pages.push(text);
            for (const child of text.matchAll(/^Child: (.+)$/gm)) pending.push(physical(child[1]!));
          }
          const prefix: string = `Applied ${integration.id}: `;
          const material: string | undefined = pages.join("\n").split("\n").find(row => row.startsWith(prefix))?.slice(prefix.length);
          assert.ok(material, "published material pages must name this exact applied attempt");
          const materialPath = physical(material), descriptor = JSON.parse(await read(materialPath));
          assert.equal(descriptor.identity.request, open.id); assert.equal(descriptor.identity.integration, integration.id);
          assert.equal(descriptor.storedPatch.reference, "proposal.patch");
          const path = join(dirname(materialPath), descriptor.storedPatch.reference);
          assert.equal(await read(path), canonical.stdout, "the contained ordinary reader reaches the independently observed complete Git delta through published discovery");
        } else {
          assert.equal(existsSync(join(root, "reviews", open.id, "applied")), false, "Principal publication never creates Worker patch materials");
          await assert.rejects(() => read(join(roots.get("bob")!, "reviews", open.id, "applied", integration.id, "proposal.patch")), /outside the agent workspace/);
        }
        await assert.rejects(() => read(archives[0]!.path), /outside the agent workspace/);
      }
      assert.deepEqual(f.store.acceptedOperationPage(), frozen, "discovery is neither acceptance nor ACK");
      f.reopen(); await f.reviews.advanceAll(); await f.module.reconcile(integration.id);
      assert.deepEqual(f.store.acceptedOperationPage(), frozen);
      for (const archive of archives) assert.deepEqual(readFileSync(archive.path), archive.bytes, "restart retains the originally frozen EML, not a regenerated guide");
      assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    } finally { f.close(); }
  });
});


test("003. Source collection: actual SIGKILL during and after scratch removal preserves accepted facts and exact-OID restart", async t => {
  const { f } = setup(t), candidate = f.candidateWith({ "exact.txt": "accepted source bytes\n" });
  await f.submit("alice", candidate, "source-before-process-loss");
  const accepted = JSON.stringify(f.store.acceptedOperationPage()), refs = f.git(["for-each-ref", "--format=%(refname) %(objectname)"]);
  const scratch = join(f.root, "source-scratch"), report = join(f.root, "source-report.json"); mkdirSync(scratch);
  const module = new URL("../../packages/git/dist/review-record.js", import.meta.url).href;
  // The child executes the production reader. Only its real fsync observation
  // is intercepted, after the actual syscall, to kill at collection boundaries.
  const child = `
    import fs from "node:fs";
    import { dirname } from "node:path";
    import { createHash } from "node:crypto";
    import { syncBuiltinESMExports } from "node:module";
    const [repository, base, candidate, report, point, module] = process.argv.slice(1);
    const { withReviewSourceRecord } = await import(module);
    const identity = stat => String(stat.dev) + ":" + String(stat.ino);
    const realSync = fs.fsyncSync; let armed = false, selected = "";
    fs.fsyncSync = fd => {
      realSync(fd);
      if (armed && identity(fs.fstatSync(fd)) === selected) process.kill(process.pid, "SIGKILL");
    };
    syncBuiltinESMExports();
    withReviewSourceRecord(repository, base, candidate, "sha1", source => {
      const temporary = dirname(source.patch.path);
      const patch = fs.readFileSync(source.patch.path);
      const record = { base: source.base, candidate: source.candidate, bytes: source.patch.bytes,
        sha256: source.patch.sha256, actualBytes: patch.length, actualSha256: createHash("sha256").update(patch).digest("hex"), temporary };
      fs.writeFileSync(report, JSON.stringify(record));
      selected = identity(fs.statSync(point === "partial-collection" ? temporary : dirname(temporary)));
      armed = point !== "complete";
      return undefined;
    });
  `;
  const run = (point: string) => runProcessSync({ executable: process.execPath,
    argv: ["--input-type=module", "--eval", child, join(f.root, "repos/project.git"), f.base, candidate, report, point, module],
    env: { PATH: "/usr/bin:/bin", TMPDIR: scratch }, timeoutMs: 10000, stdoutBytes: 8192, stderrBytes: 8192 });
  let exact: { bytes: number; sha256: string } | undefined;
  const retainedScratch = () => readdirSync(scratch).sort().map(name => ({ name,
    files: readdirSync(join(scratch, name)).sort().map(file => ({ file, bytes: readFileSync(join(scratch, name, file)) })) }));
  for (const point of ["partial-collection", "after-collection"]) {
    const killed = run(point);
    assert.equal(killed.kind, "signalled", killed.stderr.toString()); assert.equal(killed.signal, "SIGKILL");
    const observed = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(observed.base, f.base); assert.equal(observed.candidate, candidate);
    assert.equal(observed.bytes, observed.actualBytes); assert.equal(observed.sha256, observed.actualSha256);
    assert.match(observed.temporary, new RegExp(`^${scratch}/oma-review-record-[a-f0-9-]+$`));
    assert.equal(existsSync(observed.temporary), point === "partial-collection");
    exact ??= { bytes: observed.bytes, sha256: observed.sha256 };
    assert.deepEqual({ bytes: observed.bytes, sha256: observed.sha256 }, exact);
    const retained = retainedScratch();
    f.reopen();
    const restarted = run("complete"); assert.equal(restarted.kind, "exited", restarted.stderr.toString());
    assert.equal(restarted.exitCode, 0, restarted.stderr.toString());
    const retry = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(retry.base, f.base); assert.equal(retry.candidate, candidate);
    assert.equal(retry.bytes, retry.actualBytes); assert.equal(retry.sha256, retry.actualSha256);
    assert.deepEqual({ bytes: retry.bytes, sha256: retry.sha256 }, exact);
    assert.equal(existsSync(retry.temporary), false, "fresh observation returns only its own scratch");
    assert.deepEqual(retainedScratch(), retained, "retry never collects another observation's retained scratch");
    assert.equal(JSON.stringify(f.store.acceptedOperationPage()), accepted);
    assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
    assert.equal(f.git(["show", `${candidate}:exact.txt`]), "accepted source bytes");
  }
});

test("004. Review materials: cold and verified-cache publication refuse T before even a dependency probe", t => {
  const { f, root } = setup(t), directory = join(root(), "review-materials"), candidate = f.candidateWith({ "exact.txt": "recorded bytes\n" });
  let probes = 0, writes = 0;
  const materials = new CollaborationReviewMaterials(f.store, f.module, f.root, (path, bytes) => {
    writes++; ensureOwnedDirectory(dirname(path), f.root); publishNoReplace(path, bytes, 0o444);
  }, (path, hash, bytes) => {
    probes++; if (!existsSync(path)) return false;
    readImmutableBytes(path, hash, bytes); return true;
  });
  const identity = { origin: "recorded immutable endpoints" };
  const publish = () => materials.publish(directory, f.base, candidate, identity);
  const refuse = () => assert.throws(() => f.store.transaction(publish), {
    code: "INTERNAL_ERROR", message: "review materials cannot publish in T",
  });
  const manifest = publish(), before = [probes, writes];
  refuse(); assert.deepEqual([probes, writes], before, "a verified cache must not read its dependency files inside T");
  assert.equal(publish(), manifest); assert.ok(probes > before[0]!);
  const cold = join(root(), "cold-review-materials"), after = [probes, writes];
  assert.throws(() => f.store.transaction(() => materials.publish(cold, f.base, candidate, identity)), {
    code: "INTERNAL_ERROR", message: "review materials cannot publish in T",
  });
  assert.deepEqual([probes, writes], after); assert.equal(existsSync(cold), false);
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
});

test("005. Source observations: held private scratch returns exact recorded blobs and expires without acceptance or ref changes", t => {
  const { f } = setup(t), contents = { "exact.txt": "\uFEFFexact\r\nbytes", "binary.bin": "\0binary\0bytes" };
  const candidate = f.candidateWith(contents), refs = f.git(["for-each-ref", "--format=%(refname) %(objectname)"]);
  let retained: ReviewSourceRecord | undefined; const paths: string[] = [];
  for (const fail of [false, true]) {
    const primary = new Error("consumer failed after observing exact bytes");
    const observe = () => f.module.withReviewSourceRecord(f.base, candidate, source => {
      retained = source; paths.push(source.patch.path);
      assert.equal(source.base, f.base); assert.equal(source.candidate, candidate); assert.equal(source.objectFormat, "sha1");
      const patch = readFileSync(source.patch.path);
      assert.equal(patch.length, source.patch.bytes); assert.equal(createHash("sha256").update(patch).digest("hex"), source.patch.sha256);
      assert.match(patch.toString("utf8"), /GIT binary patch/);
      assert.deepEqual(source.paths.map(entry => entry.path).sort(), Object.keys(contents).sort());
      for (const entry of source.paths) {
        assert.equal(entry.status, "A"); assert.equal(entry.before, null); assert.equal(entry.after!.kind, "blob");
        source.withBlob(entry.after!.oid, file => {
          paths.push(file.path); const bytes = readFileSync(file.path);
          assert.deepEqual(bytes, Buffer.from(contents[entry.path as keyof typeof contents]));
          assert.equal(bytes.length, file.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
          return undefined;
        });
      }
      assert.throws(() => source.withBlob(f.base, () => undefined), { code: "INVALID_REQUEST" });
      if (fail) throw primary;
      return undefined;
    });
    if (fail) assert.throws(observe, error => error === primary); else observe();
    for (const path of paths) assert.equal(existsSync(path), false, "success or consumer failure returns only its private scratch");
    assert.ok(retained); assert.throws(() => retained!.withBlob(retained!.paths[0]!.after!.oid, () => undefined), { code: "INTERNAL_ERROR" });
  }
  assert.throws(() => f.store.transaction(() => f.module.withReviewSourceRecord(f.base, candidate, () => undefined)), { code: "INTERNAL_ERROR" });
  assert.equal(f.store.acceptedOperationPage().items.length, 0);
  assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
});

test("006. Review records: existing policy/quorum owner and exact frozen context bytes precede status; Principal gets no Worker facts", async t => {
  const { f, records, root, publish } = setup(t);
  const candidate = f.candidateWith({ "change.txt": "exact candidate\n" });
  await f.submit("alice", candidate);
  await f.open("alice", { tier: "HIGH", candidate }, "open");
  const name = f.requestName("open"), operation = f.store.getOperation("alice", "open")!;
  const receipts = f.store.acceptedOperationPage(0, undefined, 128).items.map(item => item.operation.resultJson);
  publish();
  const observed = f.reviews.observeRecords(f.auth("bob")).find(record => record.request === operation.id)!;
  assert.equal(observed.role, "resident");
  if (observed.role !== "resident") throw new Error("Worker observation required");
  const status = readFileSync(join(root(), "reviews", operation.id, "status.md"), "utf8");
  assert.match(status, /\/oma\/reviews\//);
  const observationName = readdirSync(join(root(), "reviews", operation.id, "observations"))[0]!;
  const current = JSON.parse(readFileSync(join(root(), "reviews", operation.id, "observations", observationName), "utf8"));
  assert.equal(current.status.normalRequired, observed.state.normalRequired);
  assert.equal(current.status.capacityFallback, observed.state.capacityFallback);
  assert.deepEqual(current.status.missing, observed.status.missing);
  publish("principal");
  assert.equal(existsSync(join(root("principal"), "reviews", operation.id)), false, "no approval addressed to Principal yet");
  await f.vote("bob", name, "approve", "checked"); await f.vote("carol", name, "approve", "checked");
  publish("principal");
  assert.ok(existsSync(join(root("principal"), "reviews", operation.id, "status.md")));
  const approval = f.stateOf(name).approval; assert.ok(approval);
  await f.vote("principal", name, "approve", "approved exact proposal", "principal-vote", approval.id);
  await f.reviews.advanceAll(); publish();
  const prepared = f.reviews.observeRecords(f.auth("bob")).find(record => record.request === operation.id);
  if (prepared?.role !== "resident") throw new Error("Worker preparation observation required");
  const context = prepared.input.entries.find(entry => entry.fact.kind === "review.integration");
  assert.ok(context?.fact.kind === "review.integration");
  if (context?.fact.kind !== "review.integration") throw new Error("frozen preparation required");
  const directory = join(root(), "reviews", operation.id, "contexts", context.operation);
  assert.deepEqual(readFileSync(join(directory, "proposal.patch")), f.module.readReviewDiffRecord(context.fact.diff).patch);
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.diff.sha256, context.fact.diff.sha256); assert.equal(manifest.binaryArtifacts.state, "not-projected");
  publish("principal");
  assert.ok(existsSync(join(root("principal"), "reviews", operation.id, "status.md")));
  for (const forbidden of ["facts", "contexts", "applied", "revisions"]) assert.equal(existsSync(join(root("principal"), "reviews", operation.id, forbidden)), false);
  const worker = f.reviews.observeRecords(f.auth("bob"));
  assert.throws(() => records.publish(f.auth("principal"), worker, "2026-11-01T00:00:00.000Z"), { code: "CAPABILITY_DENIED" });
  assert.deepEqual(f.store.acceptedOperationPage(0, undefined, 128).items.slice(0, receipts.length).map(item => item.operation.resultJson), receipts);
});

for (const point of ["immutable", "status", "index"] as const) {
  test(`007. Review records: interrupted ${point} publication reconstructs exact facts with a fresh owner`, async t => {
    const { f, records, root } = setup(t), candidate = f.candidateWith({ "change.txt": "frozen bytes\n" });
    await f.submit("alice", candidate); await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const healthyCandidate = f.candidateWith({ "independent.txt": "independent frozen bytes\n" });
    await f.submit("dave", healthyCandidate); await f.open("dave", { tier: "MEDIUM", candidate: healthyCandidate }, "independent");
    const failedRequest = f.store.getOperation("alice", "open")!.id, healthyRequest = f.store.getOperation("dave", "independent")!.id;
    const observations = f.reviews.observeRecords(f.auth("bob"));
    const before = f.store.acceptedOperationPage(0, undefined, 128).items.map(item => item.operation.resultJson);
    const original = fs.writeFileSync; let injected = false;
    fs.writeFileSync = new Proxy(original, { apply(target, receiver, args) {
      const bytes = args[1], text = typeof bytes === "string" ? bytes : Buffer.isBuffer(bytes) ? bytes.toString("utf8") : "";
      const match = point === "immutable" ? text.includes('"kind":"merge.open"') : point === "status" ? text.startsWith("# Review status\n") : text.startsWith("# Permitted reviews\n") && text.includes("Rows:");
      if (!injected && match) { injected = true; throw Object.assign(new Error(`injected review ${point}`), { code: "EIO" }); }
      return Reflect.apply(target, receiver, args);
    } }); syncBuiltinESMExports();
    try {
      if (point === "index") assert.throws(() => records.publish(f.auth("bob"), observations, "2026-11-01T00:00:00.000Z"), { code: "EIO" });
      else {
        const result = records.publish(f.auth("bob"), observations, "2026-11-01T00:00:00.000Z");
        assert.equal(result.failed, 1); assert.deepEqual(result.requests, [healthyRequest]);
        assert.equal(existsSync(join(root(), "reviews", failedRequest, "status.md")), false);
        assert.equal(existsSync(join(root(), "reviews", healthyRequest, "status.md")), true, "one unavailable request cannot suppress an independent request");
        const navigation = discovery(root());
        assert.match(navigation, /unavailable.*not a current status link/);
        assert.ok(!navigation.includes(`${failedRequest}/status.md`));
        assert.ok(navigation.includes(`${healthyRequest}/status.md`));
        assert.match(readFileSync(join(root(), "reviews/health.md"), "utf8"), /unavailable requests: 1/);
      }
    }
    finally { fs.writeFileSync = original; syncBuiltinESMExports(); }
    assert.ok(injected);
    new CollaborationReviewViews(f.store, f.root, f.module, 4096).publish(f.auth("bob"), observations, "2026-11-01T00:00:01.000Z");
    assert.match(readFileSync(join(root(), "reviews/index.md"), "utf8"), /Rows: 2/);
    assert.deepEqual(f.store.acceptedOperationPage(0, undefined, 128).items.map(item => item.operation.resultJson), before);
  });
}

test("008. Review records: conflicting frozen bytes retain prior status while discovery labels the request unavailable", async t => {
  const { f, root, publish } = setup(t), candidate = f.candidateWith({ "change.txt": "original\n" });
  await f.submit("alice", candidate); await f.open("alice", { tier: "MEDIUM", candidate }, "open"); publish();
  const request = f.store.getOperation("alice", "open")!.id, index = readFileSync(join(root(), "reviews/index.md"));
  const status = readFileSync(join(root(), "reviews", request, "status.md"));
  const path = join(root(), "reviews", request, "facts", `${request}.json`);
  chmodSync(path, 0o644); writeFileSync(path, "conflicting immutable projection");
  const result = publish();
  assert.equal(result.failed, 1); assert.deepEqual(result.requests, []);
  const unavailable = readFileSync(join(root(), "reviews/index.md"));
  assert.notDeepEqual(unavailable, index, "failed observation must no longer advertise the retained status as current");
  const navigation = discovery(root());
  assert.match(navigation, /unavailable.*not a current status link/);
  assert.ok(!navigation.includes(`${request}/status.md`));
  assert.equal(readFileSync(path, "utf8"), "conflicting immutable projection", "refresh never repairs conflicting immutable evidence");
  assert.match(readFileSync(join(root(), "reviews/health.md"), "utf8"), /unavailable requests: 1/);
  assert.deepEqual(readFileSync(join(root(), "reviews", request, "status.md")), status);
});
