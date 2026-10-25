import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { GitObserver, parseNameStatusZ, parseGitlinksZ, classifyRefAfterCas } from "@oma/git/observe";
import { protectedPathMatches } from "@oma/domain/git-facts";
import { canonicalMergeDiff, createCanonicalObserver, CANONICAL_PROCESS_LIMITS } from "@oma/git/canonical-command";
import { mergeDiffText } from "@oma/domain/git-facts";
const bytes = (text) => Buffer.from(text, "utf8");
function evidence(patch = {}) {
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
// AV-25's resolution (0ece271): a name outside the grammar is a permanent
// defect of that candidate, classified "refused" (INVALID_REQUEST at `observed`)
// -- neither "unknown" (the observation answered) nor "corrupt" (the store is
// fine). An earlier title called this "unknown"; that predates the refused kind.
test("AV-25: a name the wire grammar cannot carry is refused, not corruption", () => {
    // Candidate scope: the candidate's content cannot be represented on the wire —
    // the changed-path set is unobservable, but the output grammar itself was intact.
    for (const input of [Buffer.from([77, 0, 255, 0]), bytes("M\0../outside\0"), bytes("A\0/abs\0"),
        bytes("T\0a//b\0"), bytes("M\0\0")]) {
        const parsed = parseNameStatusZ(input);
        assert.equal(parsed.ok, false);
        if (!parsed.ok)
            assert.equal(parsed.scope, "candidate", parsed.reason);
    }
    // Output scope: a malformed record grammar means the output cannot be trusted.
    for (const input of [bytes("M\0x"), bytes("X\0x\0"), bytes("R100\0old\0new\0"), bytes("M\0ok\0extra")]) {
        const parsed = parseNameStatusZ(input);
        assert.equal(parsed.ok, false);
        if (!parsed.ok)
            assert.equal(parsed.scope, "output", parsed.reason);
    }
    const observer = new GitObserver(() => evidence({ stdout: Buffer.from([77, 0, 255, 0]) }));
    assert.equal(observer.changedPaths("/repo", "a".repeat(40), "b".repeat(40)).kind, "refused");
    const corruptObserver = new GitObserver(() => evidence({ stdout: bytes("M\0x") }));
    assert.equal(corruptObserver.changedPaths("/repo", "a".repeat(40), "b".repeat(40)).kind, "corrupt");
    // Boundary: an intact empty result and a valid record still decode present.
    const clean = new GitObserver(() => evidence({ stdout: bytes("A\0fine.txt\0") }));
    const result = clean.changedPaths("/repo", "a".repeat(40), "b".repeat(40));
    assert.deepEqual(result.kind === "present" ? result.value : null, [{ status: "A", path: "fine.txt" }]);
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
test("AV-05: the merge diff is raw bytes; the one text rendering never substitutes replacement characters", () => {
    const utf8 = Buffer.from("diff --git a/x b/x\n+한글\n", "utf8");
    assert.equal(mergeDiffText(utf8), utf8.toString("utf8"));
    const binary = Buffer.from("diff --git a/b b/b\n+\xff\xfe\n", "latin1");
    assert.equal(decodeUtf8Throws(binary), true);
    const rendered = mergeDiffText(binary);
    assert.match(rendered, /^\[non-UTF-8 merge diff: \d+ bytes, sha256 [0-9a-f]{64}; base64-encoded\]\n/);
    assert.equal(Buffer.from(rendered.slice(rendered.indexOf("\n") + 1), "base64").equals(binary), true, "the base64 line decodes back to the exact bytes");
    assert.ok(!rendered.includes("�"), "no replacement characters are silently introduced");
});
function decodeUtf8Throws(bytes) {
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return false;
    }
    catch {
        return true;
    }
}
test("AV-05: canonicalMergeDiff returns the authoritative bytes -- non-UTF-8 content reaches the renderer intact", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-diff-bytes-"));
    const env = { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_AUTHOR_NAME: "O", GIT_AUTHOR_EMAIL: "o@localhost", GIT_COMMITTER_NAME: "O", GIT_COMMITTER_EMAIL: "o@localhost" };
    const run = (args) => {
        const result = spawnSync("/usr/bin/git", ["-C", root, ...args], { env, encoding: "utf8", timeout: 10000 });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    try {
        run(["init", "-q", "-b", "main"]);
        writeFileSync(join(root, "file"), "ascii\n");
        run(["add", "--all"]);
        run(["commit", "-qm", "base"]);
        const base = run(["rev-parse", "HEAD"]);
        // A byte that is not UTF-8 and is not NUL: text-classified, so the diff
        // carries the raw byte — the old .toString("utf8") rewrote it to U+FFFD.
        writeFileSync(join(root, "file"), Buffer.from("ascii\n\xff\x80 raw\n", "latin1"));
        run(["add", "--all"]);
        run(["commit", "-qm", "candidate"]);
        const candidate = run(["rev-parse", "HEAD"]);
        const diff = canonicalMergeDiff(join(root, ".git"), base, candidate, 1 << 20);
        assert.ok(Buffer.isBuffer(diff) && decodeUtf8Throws(diff), "the raw diff keeps its non-UTF-8 byte");
        assert.ok(diff.includes(0xff));
        const rendered = mergeDiffText(diff);
        assert.match(rendered, /^\[non-UTF-8 merge diff:/);
        assert.ok(!rendered.includes("�"));
        assert.equal(Buffer.from(rendered.slice(rendered.indexOf("\n") + 1), "base64").equals(diff), true);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
// UX-09: the same hostile-input discipline as parseNameStatusZ — `ls-tree -r
// -z` output is one `<mode> <type> <oid>\t<path>` record per NUL, and only a
// strict grammar may decode it: malformed bytes are corrupt output, a leaf
// name outside the wire grammar refuses that candidate, and neither is ever
// "no gitlinks".
test("UX-09: gitlink records parse only the strict ls-tree grammar; hostile bytes corrupt or refuse", () => {
    const oid = "a".repeat(40);
    const record = (mode, type, path, oidText = oid) => bytes(`${mode} ${type} ${oidText}\t${path}\0`);
    // Well-formed leaf entries: only 160000 rows are collected; nested paths,
    // tabs, newlines and spaces inside names are preserved exactly.
    const parsed = parseGitlinksZ(Buffer.concat([
        record("100644", "blob", "file.txt"), record("120000", "blob", "link"),
        record("100755", "blob", "sub/run.sh"), record("160000", "commit", "dep"),
        record("160000", "commit", "vendor/nested"), record("100644", "blob", "M secret.txt"),
        record("160000", "commit", "tab\tname"), record("160000", "commit", "line\nname"),
    ]));
    assert.deepEqual(parsed, { ok: true, value: ["dep", "vendor/nested", "tab\tname", "line\nname"] });
    assert.deepEqual(parseGitlinksZ(bytes("")), { ok: true, value: [] });
    // Output scope — the record grammar itself is broken, so the answer cannot
    // be trusted: unterminated records, missing fields, a tree row `-r` never
    // emits, unknown or short modes, mode/type mismatches and non-full oids.
    for (const input of [
        record("100644", "blob", "x").subarray(0, -1), // unterminated record
        Buffer.concat([record("100644", "blob", "x"), bytes("partial-record")]), // trailing junk after the last NUL
        bytes(`100644 ${oid}\tx\0`), // missing the type field
        bytes(`100644 blob ${oid} x\0`), // missing the tab
        bytes(`040000 tree ${oid}\tdir\0`), // a tree row, impossible under -r
        bytes(`100664 blob ${oid}\tx\0`), // a mode git never writes
        bytes(`160000 blob ${oid}\tdep\0`), // gitlink mode naming a blob
        bytes(`100644 commit ${oid}\tx\0`), // blob mode naming a commit
        bytes(`160000 commit ${"a".repeat(39)}\tdep\0`), // short oid
        bytes(`160000 commit ${"a".repeat(41)}\tdep\0`), // long oid
        bytes(`160000 commit ${"A".repeat(40)}\tdep\0`), // non-lowercase-hex oid
        bytes(`160000 commit ${"g".repeat(40)}\tdep\0`), // non-hex oid
        bytes(` 100644 blob ${oid}\tx\0`), // leading whitespace
        bytes(`100644  blob ${oid}\tx\0`), // double space in the header
        bytes(`garbage\0`), bytes(`\0`),
    ]) {
        const result = parseGitlinksZ(input);
        assert.equal(result.ok, false, JSON.stringify(input.toString()));
        if (!result.ok)
            assert.equal(result.scope, "output", result.reason);
    }
    // Candidate scope — the record is well-formed but the leaf's name cannot be
    // represented on the wire; that candidate is refused, not the store.
    for (const input of [
        record("100644", "blob", "../outside"), record("100644", "blob", "/abs"),
        record("160000", "commit", "a//b"), record("160000", "commit", ""),
        record("100644", "blob", "x/./y"), record("160000", "commit", "x/../y"),
        Buffer.concat([record("160000", "commit", "").subarray(0, -1), Buffer.from([0xff, 0])]),
    ]) {
        const result = parseGitlinksZ(input);
        assert.equal(result.ok, false, JSON.stringify(input.toString()));
        if (!result.ok)
            assert.equal(result.scope, "candidate", result.reason);
    }
    // The sha256 object format is equally valid: 64-hex oids parse.
    assert.deepEqual(parseGitlinksZ(record("160000", "commit", "dep", "b".repeat(64))), { ok: true, value: ["dep"] });
    // And the observer maps each scope honestly: refused, corrupt, unknown —
    // never a silent empty list.
    const refusal = new GitObserver(() => evidence({
        stdout: Buffer.concat([record("160000", "commit", "").subarray(0, -1), Buffer.from([0xff, 0])])
    }));
    assert.equal(refusal.gitlinks("/repo", oid).kind, "refused");
    const corruptObserved = new GitObserver(() => evidence({ stdout: record("160000", "blob", "dep") }));
    assert.equal(corruptObserved.gitlinks("/repo", oid).kind, "corrupt");
    for (const uncertain of [
        evidence({ status: null, signal: "SIGKILL" }), // output-limited/timed-out shape
        evidence({ status: 128 }), // nonzero exit
        evidence({ stderr: bytes("warning: something\n") }), // stderr diagnostics
        evidence({ stdout: null }), // missing output
    ]) {
        const kind = new GitObserver(() => uncertain).gitlinks("/repo", oid).kind;
        assert.equal(kind, uncertain.stdout === null ? "corrupt" : "unknown");
    }
});
// UX-09: the whole-tree enumeration is the only observation that scales with
// leaf count; it is spooled to a file and parsed a record at a time, so the
// output has no byte bound at all -- a tree that wedged the shared 4 MiB
// buffer into unknown at every gate now answers whole. The fail-before
// stands as the control: the 4 MiB run still answers unknown rather than a
// truncated list.
test("UX-09: a tree larger than the shared bound still observes gitlinks whole", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-gitlinks-bound-"));
    const env = { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_AUTHOR_NAME: "O", GIT_AUTHOR_EMAIL: "o@localhost", GIT_COMMITTER_NAME: "O", GIT_COMMITTER_EMAIL: "o@localhost" };
    const run = (args, input) => {
        const result = spawnSync("/usr/bin/git", ["-C", root, ...args], { env, encoding: "utf8", timeout: 30000, ...(input === undefined ? {} : { input }) });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
    };
    try {
        run(["init", "-q", "-b", "main"]);
        const blob = run(["hash-object", "-w", "--stdin"], "x");
        const base = run(["commit-tree", run(["mktree"], ""), "-m", "base"]);
        // ~22k leaf entries at ~210 bytes each — past the shared 4 MiB bound.
        const lines = [];
        for (let index = 0; index < 22000; index += 1)
            lines.push(`100644 blob ${blob}\t${"p".repeat(150)}${String(index).padStart(5, "0")}`);
        lines.push(`160000 commit ${base}\tzzzz-dep`);
        lines.sort();
        const tree = run(["mktree"], `${lines.join("\n")}\n`);
        const commit = run(["commit-tree", tree, "-p", base, "-m", "wide tree"]);
        const repository = join(root, ".git");
        const raw = spawnSync("/usr/bin/git", ["--git-dir", repository, "ls-tree", "-r", "-z", "--full-tree", commit], { env, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
        assert.ok(raw.stdout.byteLength > CANONICAL_PROCESS_LIMITS.maxBuffer, `fixture must exceed the shared bound: ${raw.stdout.byteLength}`);
        // Fail-before: under the shared bound this same answer is output-limited
        // → unknown → REF_STATE_UNKNOWN at every gate. Under the named bound the
        // whole enumeration lands and names the one gitlink.
        const sharedBound = new GitObserver(args => {
            const result = spawnSync("/usr/bin/git", [...args], { env, timeout: 30000,
                maxBuffer: CANONICAL_PROCESS_LIMITS.maxBuffer });
            return { status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
                ...(result.error === undefined ? {} : { error: result.error }) };
        });
        assert.equal(sharedBound.gitlinks(repository, commit).kind, "unknown");
        const observedTree = createCanonicalObserver().gitlinks(repository, commit);
        assert.deepEqual(observedTree.kind === "present" ? observedTree.value : null, ["zzzz-dep"]);
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
});
test("post-CAS observations distinguish expected candidate third and unknown without mutation", () => {
    const base = "a".repeat(40);
    const candidate = "b".repeat(40);
    const third = "c".repeat(40);
    const observation = (oid) => ({ kind: "present", value: oid, evidence: evidence() });
    assert.deepEqual(classifyRefAfterCas(observation(base), base, candidate), { kind: "expected", oid: base });
    assert.deepEqual(classifyRefAfterCas(observation(candidate), base, candidate), { kind: "candidate", oid: candidate });
    assert.deepEqual(classifyRefAfterCas(observation(third), base, candidate), { kind: "third", oid: third });
    const absent = { kind: "absent", evidence: evidence({ status: 1 }) };
    assert.deepEqual(classifyRefAfterCas(absent, null, candidate), { kind: "expected", oid: null });
    assert.deepEqual(classifyRefAfterCas(absent, base, candidate), { kind: "third", oid: null });
    const unknown = { kind: "unknown", reason: "timeout", evidence: evidence({ status: null }) };
    assert.deepEqual(classifyRefAfterCas(unknown, base, candidate), { kind: "unknown", observation: unknown });
});
for (const format of ["sha1", "sha256"]) {
    test(`real ${format} Git observations preserve A/M/D/T and hostile-looking filenames`, () => {
        const root = mkdtempSync(join(tmpdir(), `oma-observe-${format}-`));
        const env = { HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
            GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
            GIT_AUTHOR_NAME: "O", GIT_AUTHOR_EMAIL: "o@localhost", GIT_COMMITTER_NAME: "O", GIT_COMMITTER_EMAIL: "o@localhost" };
        const run = (args) => {
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
            run(["add", "--all"]);
            run(["commit", "-qm", "base"]);
            const base = run(["rev-parse", "HEAD"]);
            for (const name of ["M secret.txt", "A", "tab\tname", "line\nname"])
                writeFileSync(join(root, name), "new\n");
            unlinkSync(join(root, "deleted"));
            unlinkSync(join(root, "type"));
            symlinkSync("A", join(root, "type"));
            writeFileSync(join(root, "added"), "new\n");
            run(["add", "--all"]);
            run(["commit", "-qm", "candidate"]);
            const candidate = run(["rev-parse", "HEAD"]);
            const repository = join(root, ".git");
            const changed = observer.changedPaths(repository, base, candidate);
            assert.equal(changed.kind, "present");
            if (changed.kind !== "present")
                assert.fail("changed paths unavailable");
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
        }
        finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
}
