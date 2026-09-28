import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { GitObserver, parseNameStatusZ, protectedPathMatches, classifyRefAfterCas,
  type GitProcessEvidence, type GitObservation } from "../src/git/observe.js";

const bytes = (text: string): Buffer => Buffer.from(text, "utf8");
function evidence(patch: Partial<GitProcessEvidence> = {}): GitProcessEvidence {
  return { status: 0, signal: null, stdout: bytes(""), stderr: bytes(""), ...patch };
}

test("name-status pairs preserve filename bytes and never add status tokens as paths", () => {
  const expected = [
    { status: "A", path: "A" }, { status: "M", path: "M secret.txt" },
    { status: "D", path: "tab\tname" }, { status: "T", path: "line\nname" },
    { status: "M", path: "\ufeffname" },
  ];
  const input = bytes(expected.map(value => `${value.status}\0${value.path}\0`).join(""));
  assert.deepEqual(parseNameStatusZ(input), { ok: true, value: expected });
  assert.deepEqual(parseNameStatusZ(bytes("")), { ok: true, value: [] });
  assert.equal(protectedPathMatches("M secret.txt", "M secret.txt"), true);
  assert.equal(protectedPathMatches("M secret.txt", "secret.txt"), false);
  assert.equal(protectedPathMatches("src/a.ts", "src/"), true);
  assert.equal(protectedPathMatches("src-other/a.ts", "src/"), false);
  assert.equal(protectedPathMatches("A-file", "A"), false);
  assert.equal(protectedPathMatches("a", "/"), true, "DR18: the root protects the whole tree");
  for (const input of [bytes("M\0"), bytes("M\0x"), bytes("M\0\0"), bytes("R100\0old\0new\0"),
    bytes("M100\0x\0"), bytes("X\0x\0"), bytes("M\0../outside\0"), Buffer.from([77, 0, 255, 0])])
    assert.equal(parseNameStatusZ(input).ok, false);
});

test("only the defined ref outcome proves absence; process evidence is retained", () => {
  const absent = evidence({ status: 1 });
  const result = new GitObserver(() => absent).ref("/repo", "refs/heads/main");
  assert.equal(result.kind, "absent");
  assert.equal(result.evidence, absent);
  for (const failed of [
    evidence({ status: 128, stderr: bytes("permission denied") }),
    evidence({ status: 1, stderr: bytes("repository corrupt") }),
    evidence({ status: null, signal: "SIGKILL" }),
    evidence({ status: null, error: Object.assign(new Error("spawn failed"), { code: "ENOENT" }) }),
    evidence({ status: null, error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) }),
  ]) {
    const value = new GitObserver(() => failed).ref("/repo", "refs/heads/main");
    assert.equal(value.kind, "unknown");
    assert.equal(value.evidence, failed);
  }
  assert.equal(new GitObserver(() => evidence({ stdout: bytes(" a".repeat(20)) })).ref("/repo", "refs/heads/main").kind, "corrupt");
  assert.equal(new GitObserver(() => evidence({ stdout: bytes(`${"a".repeat(40)}\n`) })).ref("/repo", "refs/heads/main").kind, "present");
});

test("post-CAS observations distinguish expected candidate third and unknown without mutation", () => {
  const base = "a".repeat(40); const candidate = "b".repeat(40); const third = "c".repeat(40);
  const observation = (oid: string): GitObservation<string> => ({ kind: "present", value: oid, evidence: evidence() });
  assert.deepEqual(classifyRefAfterCas(observation(base), base, candidate), { kind: "expected", oid: base });
  assert.deepEqual(classifyRefAfterCas(observation(candidate), base, candidate), { kind: "candidate", oid: candidate });
  assert.deepEqual(classifyRefAfterCas(observation(third), base, candidate), { kind: "third", oid: third });
  const absent: GitObservation<string> = { kind: "absent", evidence: evidence({ status: 1 }) };
  assert.deepEqual(classifyRefAfterCas(absent, null, candidate), { kind: "expected", oid: null });
  assert.deepEqual(classifyRefAfterCas(absent, base, candidate), { kind: "third", oid: null });
  const unknown: GitObservation<string> = { kind: "unknown", reason: "timeout", evidence: evidence({ status: null }) };
  assert.deepEqual(classifyRefAfterCas(unknown, base, candidate), { kind: "unknown", observation: unknown });
});

for (const format of ["sha1", "sha256"] as const) {
  test(`real ${format} Git observations preserve A/M/D/T and hostile-looking filenames`, () => {
    const root = mkdtempSync(join(tmpdir(), `oma-observe-${format}-`));
    const env = { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "O", GIT_AUTHOR_EMAIL: "o@localhost", GIT_COMMITTER_NAME: "O", GIT_COMMITTER_EMAIL: "o@localhost" };
    const run = (args: string[]): string => {
      const result = spawnSync("/usr/bin/git", ["-C", root, ...args], { env, encoding: "utf8", timeout: 10000 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const observer = new GitObserver((args, input) => {
      const result = spawnSync("/usr/bin/git", [...args], { env, timeout: 10000, maxBuffer: 1048576,
        ...(input === undefined ? {} : { input }) });
      return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
        ...(result.error === undefined ? {} : { error: result.error }) };
    });
    try {
      run(["init", "-q", `--object-format=${format}`, "-b", "main"]);
      for (const name of ["M secret.txt", "A", "tab\tname", "line\nname", "type", "deleted"])
        writeFileSync(join(root, name), "old\n");
      run(["add", "--all"]); run(["commit", "-qm", "base"]);
      const base = run(["rev-parse", "HEAD"]);
      for (const name of ["M secret.txt", "A", "tab\tname", "line\nname"]) writeFileSync(join(root, name), "new\n");
      unlinkSync(join(root, "deleted")); unlinkSync(join(root, "type")); symlinkSync("A", join(root, "type"));
      writeFileSync(join(root, "added"), "new\n");
      run(["add", "--all"]); run(["commit", "-qm", "candidate"]);
      const candidate = run(["rev-parse", "HEAD"]);
      const repository = join(root, ".git");
      const changed = observer.changedPaths(repository, base, candidate);
      assert.equal(changed.kind, "present");
      if (changed.kind !== "present") assert.fail("changed paths unavailable");
      assert.deepEqual(new Map(changed.value.map(entry => [entry.path, entry.status])), new Map([
        ["M secret.txt", "M"], ["A", "M"], ["tab\tname", "M"], ["line\nname", "M"],
        ["type", "T"], ["deleted", "D"], ["added", "A"],
      ]));
      const objectFormat = observer.objectFormat(repository);
      assert.equal(objectFormat.kind === "present" ? objectFormat.value : null, format);
      assert.equal(observer.ref(repository, "refs/heads/not-present").kind, "absent");
      assert.equal(observer.commit(repository, candidate).kind, "present");
      const ancestry = observer.ancestry(repository, base, candidate);
      assert.equal(ancestry.kind === "present" ? ancestry.value : null, true);
      run(["update-ref", "refs/oma/published/alice/frozen", candidate]);
      const published = observer.published(repository);
      assert.deepEqual(published.kind === "present" ? published.value : null, [candidate]);
      const empty = observer.changedPaths(repository, candidate, candidate);
      assert.deepEqual(empty.kind === "present" ? empty.value : null, []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
