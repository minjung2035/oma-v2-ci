import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { GitObserver, parseNameStatusZ, classifyRefAfterCas } from "@oma/git/observe";
import { protectedPathMatches } from "@oma/domain/git-facts";
const BASE = "1".repeat(40);
const CANDIDATE = "2".repeat(40);
const THIRD = "3".repeat(40);
function evidence(overrides = {}) {
    return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), ...overrides };
}
function observer(value) { return new GitObserver(() => value); }
test("fixed no-renames pairs preserve filename bytes without treating status as a path", () => {
    const bytes = Buffer.from("M\0M secret.txt\0A\0A\0D\0tab\tname\0T\0line\nname\0", "utf8");
    assert.deepEqual(parseNameStatusZ(bytes), { ok: true, value: [
            { status: "M", path: "M secret.txt" }, { status: "A", path: "A" },
            { status: "D", path: "tab\tname" }, { status: "T", path: "line\nname" },
        ] });
    assert.deepEqual(parseNameStatusZ(Buffer.alloc(0)), { ok: true, value: [] });
    for (const malformed of [
        Buffer.from("M"), Buffer.from("M\0"), Buffer.from("M\0name"), Buffer.from("M\0name\0A\0"),
        Buffer.from("R100\0old\0new\0"), Buffer.from("C100\0copy\0"), Buffer.from("U\0conflict\0"),
        Buffer.from("A\0\0"), Buffer.from("A\0../escape\0"), Buffer.from("A\0/absolute\0"),
        Buffer.from([77, 0, 0xc3, 0x28, 0]),
    ])
        assert.equal(parseNameStatusZ(malformed).ok, false, malformed.toString("hex"));
    assert.deepEqual(parseNameStatusZ(Buffer.from("A\0\uFEFFname\0")), {
        ok: true, value: [{ status: "A", path: "\uFEFFname" }],
    }, "a filename BOM is data, not a transport header");
});
test("protected path matching retains exact-file and directory-prefix semantics", () => {
    assert.equal(protectedPathMatches("M secret.txt", "M secret.txt"), true);
    assert.equal(protectedPathMatches("M secret.txt", "secret.txt"), false);
    assert.equal(protectedPathMatches("A", "A"), true);
    assert.equal(protectedPathMatches("src/main.ts", "src/"), true);
    assert.equal(protectedPathMatches("src", "src/"), false);
    assert.equal(protectedPathMatches("src-other/main.ts", "src/"), false);
    assert.equal(protectedPathMatches("tab\tname", "tab\tname"), true);
    assert.equal(protectedPathMatches("anything", "/"), true, "DR18: the root protects the whole tree");
});
test("ref absence needs the precise exit and empty-output evidence", () => {
    const absent = evidence({ status: 1 });
    const found = observer(absent).ref("/repository", "refs/heads/main");
    assert.equal(found.kind, "absent");
    assert.equal(found.evidence, absent, "original subprocess facts are retained");
    for (const failure of [
        evidence({ status: 128 }), evidence({ status: 1, stderr: Buffer.from("permission denied") }),
        evidence({ status: null }), evidence({ status: 1, signal: "SIGKILL" }),
        evidence({ error: Object.assign(new Error("missing executable"), { code: "ENOENT" }) }),
        evidence({ error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) }),
        evidence({ error: Object.assign(new Error("buffer limit"), { code: "ENOBUFS" }) }),
        evidence({ status: 1, stdout: null }), evidence({ status: 1, stderr: null }),
    ])
        assert.equal(observer(failure).ref("/repository", "refs/heads/main").kind, "unknown");
    for (const output of ["", `${BASE} extra\n`, ` ${BASE}\n`, `${BASE}\n\n`, "broken\n"]) {
        assert.equal(observer(evidence({ stdout: Buffer.from(output) })).ref("/repository", "refs/heads/main").kind, "corrupt");
    }
    for (const oid of [BASE, "a".repeat(64)]) {
        const value = observer(evidence({ stdout: Buffer.from(`${oid}\n`) })).ref("/repository", "refs/heads/main");
        assert.equal(value.kind, "present");
        if (value.kind === "present")
            assert.equal(value.value, oid);
    }
});
test("object ancestry format and published observations never collapse unavailable into negative", () => {
    assert.equal(observer(evidence({ stdout: Buffer.from(`${BASE}^{commit} missing\n`) })).commit("/repo", BASE).kind, "absent");
    assert.equal(observer(evidence({ stdout: Buffer.from("commit\n") })).commit("/repo", BASE).kind, "present");
    assert.equal(observer(evidence({ stdout: Buffer.from("blob\n") })).commit("/repo", BASE).kind, "corrupt");
    assert.equal(observer(evidence({ status: 128 })).commit("/repo", BASE).kind, "unknown");
    const unrelated = observer(evidence({ status: 1 })).ancestry("/repo", BASE, CANDIDATE);
    assert.equal(unrelated.kind, "present");
    if (unrelated.kind === "present")
        assert.equal(unrelated.value, false);
    assert.equal(observer(evidence({ status: 1, stderr: Buffer.from("fatal") })).ancestry("/repo", BASE, CANDIDATE).kind, "unknown");
    assert.equal(observer(evidence({ stdout: Buffer.from("sha256\n") })).objectFormat("/repo").kind, "present");
    assert.equal(observer(evidence({ stdout: Buffer.from("sha512\n") })).objectFormat("/repo").kind, "corrupt");
    const published = observer(evidence()).published("/repo");
    assert.equal(published.kind, "present");
    if (published.kind === "present")
        assert.deepEqual(published.value, []);
    assert.equal(observer(evidence({ stdout: Buffer.from(`${BASE}\n${"a".repeat(64)}\n`) })).published("/repo").kind, "corrupt");
    assert.equal(observer(evidence({ stdout: Buffer.from(BASE) })).published("/repo").kind, "corrupt");
    assert.equal(observer(evidence({ status: 1 })).published("/repo").kind, "unknown");
});
test("fresh post-CAS observations distinguish expected candidate third absence and uncertainty", () => {
    const observed = (oid) => observer(evidence({ stdout: Buffer.from(`${oid}\n`) })).ref("/repo", "refs/heads/main");
    assert.deepEqual(classifyRefAfterCas(observed(CANDIDATE), BASE, CANDIDATE), { kind: "candidate", oid: CANDIDATE });
    assert.deepEqual(classifyRefAfterCas(observed(BASE), BASE, CANDIDATE), { kind: "expected", oid: BASE });
    assert.deepEqual(classifyRefAfterCas(observed(THIRD), BASE, CANDIDATE), { kind: "third", oid: THIRD });
    const absent = observer(evidence({ status: 1 })).ref("/repo", "refs/heads/main");
    assert.deepEqual(classifyRefAfterCas(absent, null, CANDIDATE), { kind: "expected", oid: null });
    assert.deepEqual(classifyRefAfterCas(absent, BASE, CANDIDATE), { kind: "third", oid: null });
    const unknown = observer(evidence({ status: null })).ref("/repo", "refs/heads/main");
    assert.deepEqual(classifyRefAfterCas(unknown, BASE, CANDIDATE), { kind: "unknown", observation: unknown });
});
for (const format of ["sha1", "sha256"]) {
    test(`real ${format} Git emits the same exact A M D T pair grammar`, () => {
        const root = mkdtempSync(join(tmpdir(), "oma-git-path-oracle-"));
        const env = {
            ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@invalid",
        };
        const git = (...args) => {
            const result = spawnSync("/usr/bin/git", ["-C", root, ...args], { env, timeout: 10000, maxBuffer: 1048576 });
            assert.equal(result.error, undefined);
            assert.equal(result.signal, null);
            assert.equal(result.status, 0, result.stderr?.toString("utf8"));
            return result.stdout;
        };
        try {
            git("init", "-q", `--object-format=${format}`);
            git("config", "core.hooksPath", "/dev/null");
            git("config", "commit.gpgSign", "false");
            writeFileSync(join(root, "M secret.txt"), "before\n");
            writeFileSync(join(root, "tab\tname"), "delete\n");
            writeFileSync(join(root, "line\nname"), "regular\n");
            git("add", "-A");
            git("commit", "-qm", "base");
            const base = git("rev-parse", "HEAD").toString("utf8").trim();
            writeFileSync(join(root, "M secret.txt"), "after\n");
            writeFileSync(join(root, "A"), "added\n");
            unlinkSync(join(root, "tab\tname"));
            unlinkSync(join(root, "line\nname"));
            symlinkSync("A", join(root, "line\nname"));
            git("add", "-A");
            git("commit", "-qm", "candidate");
            const output = git("diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", base, "HEAD");
            const parsed = parseNameStatusZ(output);
            if (!parsed.ok)
                assert.fail(parsed.reason);
            assert.equal(parsed.ok, true);
            assert.deepEqual(parsed.value, [
                { status: "A", path: "A" }, { status: "M", path: "M secret.txt" },
                { status: "T", path: "line\nname" }, { status: "D", path: "tab\tname" },
            ]);
            assert.deepEqual(parseNameStatusZ(git("diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--no-renames", "HEAD", "HEAD")), { ok: true, value: [] });
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}
