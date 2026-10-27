import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ResticTarVerifier } from "@oma/storage/restic-tar";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const metadata = (type, extra = {}) => ({ type, mode: type === "dir" ? 0o700 : 0o600,
  uid: "1000", gid: "1000", mtimeNs: "1700000000123456789", ...extra });
// Independent POSIX tar fixture writer; tests vary bytes, boundaries and
// metadata rather than deriving expectations from the decoder.
function entry(name, type, bytes = Buffer.alloc(0), link = "", overrides = {}) {
  const header = Buffer.alloc(512);
  const field = (offset, size, value) => header.write(value, offset, size, "utf8");
  const octal = (offset, size, value) => field(offset, size, value.toString(8).padStart(size - 1, "0") + "\0");
  field(0, 100, name); octal(100, 8, type === "5" ? 0o700 : 0o600); octal(108, 8, 1000); octal(116, 8, 1000);
  octal(124, 12, bytes.length); octal(136, 12, 1700000000); field(148, 8, "        "); field(156, 1, type);
  field(157, 100, link); field(257, 6, "ustar\0"); field(263, 2, "00");
  for (const [offset, value] of Object.entries(overrides)) field(Number(offset), Buffer.byteLength(value), value);
  const checksum = header.reduce((sum, byte) => sum + byte, 0); field(148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
function verify(archive, source, chunk = 37) {
  const verifier = new ResticTarVerifier(source);
  for (let at = 0; at < archive.length; at += chunk) verifier.push(archive.subarray(at, at + chunk));
  verifier.finish();
}
const eof = Buffer.alloc(1024), payload = Buffer.from("exact file bytes\n");
const records = new Map([
  ["repos", metadata("dir")],
  ["repos/file", metadata("file", { size: payload.length, contentHash: hash(payload), hardlinkGroup: "repos/file" })],
  ["repos/link", metadata("symlink", { linkTarget: Buffer.from("file").toString("base64") })],
]);
const source = { paths: new Set(records.keys()), metadata: records };
const regular = entry("repos/file", "0", payload), directory = entry("repos/", "5"), symlink = entry("repos/link", "2", undefined, "file");
const archive = Buffer.concat([directory, regular, symlink, eof]);

test("dump verification consumes arbitrary chunk boundaries, bytes, links and complete EOF", () => {
  for (const size of [1, 511, 512, 513, 65536]) verify(archive, source, size);
});
test("dump truncation, duplicate entries, content mutation and invalid metadata refuse reclamation", () => {
  const corrupt = Buffer.from(archive); corrupt[1024] ^= 1;
  for (const bytes of [archive.subarray(0, -1), archive.subarray(0, -512), corrupt,
    Buffer.concat([directory, regular, regular, symlink, eof]), Buffer.concat([directory, symlink, eof]),
    Buffer.concat([directory, entry("repos/file", "0", payload, "", { 100: "0000644\0" }), symlink, eof]),
    Buffer.concat([directory, regular, entry("repos/link", "2", undefined, "wrong"), eof]),
    Buffer.concat([archive, regular]), Buffer.concat([entry("../escape", "0", payload), eof]),
    Buffer.concat([directory, entry("repos/file", "6"), symlink, eof])]) assert.throws(() => verify(bytes, source), { code: "STORE_CORRUPT" });
});
function paxRecord(key, value) {
  const body = `${key}=${value}\n`; let length = Buffer.byteLength(body) + 2;
  while (Buffer.byteLength(`${length} ${body}`) !== length) length = Buffer.byteLength(`${length} ${body}`);
  return Buffer.from(`${length} ${body}`);
}
test("PAX long Unicode paths are byte-counted and malformed/duplicate records are rejected", () => {
  const long = "repos/" + "한글".repeat(80), meta = metadata("file", { size: payload.length, contentHash: hash(payload) });
  const expected = { paths: new Set([long]), metadata: new Map([[long, meta]]) };
  verify(Buffer.concat([entry("PaxHeader", "x", paxRecord("path", long)), entry("short", "0", payload), eof]), expected);
  for (const pax of [Buffer.from("999 path=unfinished\n"), Buffer.concat([paxRecord("path", long), paxRecord("path", long)]), paxRecord("path", "../escape")])
    assert.throws(() => verify(Buffer.concat([entry("PaxHeader", "x", pax), entry("short", "0", payload), eof]), expected));
});
test("hardlinks require the source group and content identity", () => {
  const meta = metadata("file", { size: payload.length, contentHash: hash(payload), hardlinkGroup: "a" });
  const expected = { paths: new Set(["a", "b"]), metadata: new Map([["a", meta], ["b", meta]]) };
  verify(Buffer.concat([entry("a", "0", payload), entry("b", "1", undefined, "a"), eof]), expected);
  assert.throws(() => verify(Buffer.concat([entry("a", "0", payload), entry("b", "1", undefined, "missing"), eof]), expected));
});
function linkedSource(names, bytes = payload) {
  const meta = metadata("file", { size: bytes.length, contentHash: hash(bytes), hardlinkGroup: names[0] });
  return { paths: new Set(names), metadata: new Map(names.map(name => [name, meta])) };
}
test("dump hardlinks reject self, forward and cyclic references without verified file data", () => {
  for (const [names, entries] of [
    [["a"], [entry("a", "1", undefined, "a")]],
    [["a", "b"], [entry("a", "1", undefined, "b"), entry("b", "0", payload)]],
    [["a", "b"], [entry("a", "1", undefined, "b"), entry("b", "1", undefined, "a")]],
    [["a", "b", "c"], [entry("a", "0", payload), entry("b", "1", undefined, "c"), entry("c", "1", undefined, "b")]],
  ]) {
    const bytes = Buffer.concat([...entries, eof]);
    for (const size of [1, 511, 512, 513, 65536])
      assert.throws(() => verify(bytes, linkedSource(names), size), { code: "STORE_CORRUPT" });
  }
});
test("dump hardlink chains resolve to verified regular data, including empty files", () => {
  for (const bytes of [payload, Buffer.alloc(0)]) {
    const archive = Buffer.concat([entry("a", "0", bytes), entry("b", "1", undefined, "a"), entry("c", "1", undefined, "b"), eof]);
    for (const size of [1, 511, 512, 513, 65536]) verify(archive, linkedSource(["a", "b", "c"], bytes), size);
  }
});
test("PAX hardlink targets require earlier verified data instead of trusting the raw header", () => {
  const expected = linkedSource(["a", "b"]);
  const link = target => Buffer.concat([entry("a", "0", payload), entry("PaxHeader", "x", paxRecord("linkpath", target)), entry("b", "1", undefined, "a"), eof]);
  verify(link("a"), expected, 1);
  for (const size of [1, 511, 512, 513, 65536])
    assert.throws(() => verify(link("b"), expected, size), { code: "STORE_CORRUPT" });
});
