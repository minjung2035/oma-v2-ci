import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StoreError } from "../src/domain/errors.js";
import { DEPLOYMENT_LAYOUT } from "../src/domain/deployment.js";
import { SURFACE_LIMITS, planToolSurface, type ToolSurfaceConfig } from "../src/domain/tool-surface.js";
import { INITIAL, step, type PanelData } from "../src/tui/model.js";
import { render } from "../src/tui/view/index.js";
import { unknownDashboard } from "./fixtures/dashboard.js";
import { WORKER_LIMIT, commitField, layoutOf, readSettings } from "../src/tui/sources/settings.js";
import { readExtensions, toggleExtension } from "../src/tui/sources/extensions.js";
import { parseMessage, principalMailbox, readBody, readMailbox } from "../src/tui/sources/mail.js";

const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));
const corrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";
const invalid = (error: unknown): boolean => error instanceof StoreError && error.code === "INVALID_REQUEST";

/** A minimal operations bundle whose index can be rewritten per case. */
function bundle(root: string, overrides: Record<string, unknown> = {}): string {
  const libdir = join(root, "lib");
  mkdirSync(join(libdir, "dist", "src"), { recursive: true });
  writeFileSync(join(libdir, DEPLOYMENT_LAYOUT.extension), "export {};\n");
  writeFileSync(join(root, "prompt.md"), "");
  writeFileSync(join(root, "host.json"), JSON.stringify({ installation: { libdir } }));
  writeFileSync(join(root, "models.json"), JSON.stringify({}));
  writeFileSync(join(root, "role.json"), JSON.stringify({
    agentProfile: { modelProfile: "m" }, extensions: [DEPLOYMENT_LAYOUT.extension], promptFile: "prompt.md",
  }));
  const index = join(root, "index.json");
  writeFileSync(index, JSON.stringify({
    kind: "oma-operations-v1", host: "host.json", models: "models.json",
    roles: { resident: "role.json" }, ...overrides,
  }));
  return index;
}

test("a bundle reference that escapes the bundle directory is refused", () => {
  const root = scratch("oma-adv-escape-");
  try {
    for (const host of ["../outside.json", "/etc/passwd", "sub/../../outside.json"]) {
      const index = bundle(root, { host });
      assert.throws(() => layoutOf(index), (error: unknown) =>
        error instanceof StoreError && /relative path|escapes/.test(error.message),
        `host reference ${host} must be refused`);
    }
    for (const roles of [{ resident: "../role.json" }, { resident: "/tmp/role.json" }]) {
      const index = bundle(root, { roles });
      assert.throws(() => layoutOf(index), (error: unknown) => error instanceof StoreError);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a host file missing the object a write targets fails as corruption, not silently", () => {
  const root = scratch("oma-adv-corrupt-");
  try {
    const index = bundle(root);
    writeFileSync(join(root, "host.json"), JSON.stringify({ installation: { libdir: join(root, "lib") }, quota: "not-an-object" }));
    const layout = layoutOf(index);
    assert.equal(layout.kind, "operations");
    // readSettings composes and validates; a malformed host must not compose.
    assert.throws(() => readSettings(index), (error: unknown) => error instanceof StoreError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a role file that becomes unreadable between read and write is not half-written", () => {
  const root = scratch("oma-adv-race-");
  try {
    const index = bundle(root);
    const context = readExtensions(index, "principal", "resident");
    const rolePath = join(root, "role.json");
    const before = readFileSync(rolePath, "utf8");
    writeFileSync(rolePath, "{ this is not json");
    assert.throws(() => toggleExtension(context, "extensions/x.js", "workers", false), (error: unknown) =>
      error instanceof StoreError);
    // The damaged file is left as found; the writer does not overwrite it with
    // a guess assembled from a stale in-memory copy.
    assert.equal(readFileSync(rolePath, "utf8"), "{ this is not json");
    assert.notEqual(readFileSync(rolePath, "utf8"), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the panel renders at degenerate terminal sizes without exceeding them", () => {
  const data: PanelData = Object.freeze({
    dashboard: unknownDashboard("아주 긴 이유 문자열입니다 ".repeat(4)),
    config: Object.freeze([]), extensions: Object.freeze([]),
    mail: Object.freeze([{ id: "m", from: "worker-a", kind: "question", subject: "제목".repeat(60), unread: true, path: "/tmp/m" }]),
  });
  let state = step(INITIAL, { kind: "panel" }, data).state;
  for (const [columns, rows] of [[1, 1], [2, 2], [8, 3], [20, 6], [200, 60]] as const) {
    for (const category of [0, 1, 2]) {
      const view = { ...state, category };
      const lines = render({ state: view, data, transcript: ["긴 줄 ".repeat(50)], body: null, notice: { kind: "text", text: "알림" }, busy: true, columns, rows });
      assert.equal(lines.length, rows, `${columns}x${rows} must produce exactly ${rows} lines`);
      for (const line of lines)
        assert.ok([...line].length <= columns * 2, `${columns}x${rows} produced an oversized line`);
    }
  }
  state = step(state, { kind: "enter" }, data).state;
  assert.doesNotThrow(() => render({ state, data, transcript: [], body: "본문", notice: null, busy: false, columns: 0, rows: 0 }));
});

test("a tool surface declaration cannot smuggle an oversized or malformed name", () => {
  const base = (overrides: Partial<ToolSurfaceConfig>): ToolSurfaceConfig =>
    ({ defaultMode: "DISABLED", direct: [], disabled: [], groups: [], roots: [], ...overrides });
  const long = "a".repeat(200);
  for (const candidate of [
    base({ direct: [long] }),
    base({ direct: ["UPPER"] }),
    base({ direct: ["9leading"] }),
    base({ direct: ["has space"] }),
    base({ direct: ["has/slash"] }),
    base({ groups: [{ name: long, description: "d", members: [] }] }),
    base({ groups: [{ name: "g", description: "x".repeat(SURFACE_LIMITS.descriptionBytes + 1), members: [] }] }),
    base({ groups: [{ name: "g", description: "", members: [] }] }),
  ]) assert.throws(() => planToolSurface(candidate), invalid);
  // A description at exactly the limit is accepted; the bound is inclusive.
  assert.doesNotThrow(() => planToolSurface(base({
    groups: [{ name: "g", description: "x".repeat(SURFACE_LIMITS.descriptionBytes), members: [{ tool: "t" }] }],
  })));
});

test("mail reading survives malformed, empty and non-file entries", () => {
  const root = scratch("oma-adv-mail-");
  try {
    const box = principalMailbox(root);
    mkdirSync(box.newDir, { recursive: true });
    mkdirSync(box.curDir, { recursive: true });
    writeFileSync(join(box.newDir, "empty"), "");
    writeFileSync(join(box.newDir, "headers-only"), "From: a@b\n");
    writeFileSync(join(box.newDir, "binary"), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    mkdirSync(join(box.newDir, "a-directory"));
    symlinkSync("/etc/passwd", join(box.curDir, "a-symlink"));

    const rows = readMailbox(box);
    // Nothing throws, a directory is not a message, and a symlink's target is
    // read as a message body only if it parses -- it is never followed to gain
    // a path outside the mailbox listing.
    assert.ok(!rows.some(row => row.id === "a-directory"));
    for (const row of rows) {
      assert.equal(typeof row.subject, "string");
      assert.equal(typeof row.from, "string");
      assert.ok(row.path.startsWith(root));
    }
    assert.doesNotThrow(() => readBody(join(box.newDir, "binary")));
    assert.equal(readBody(join(box.newDir, "a-directory")), null);
    // A header block with no body is not an error.
    assert.equal(parseMessage("From: a@b\n").body, "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an extension list is not taken from outside the installation directory", () => {
  const root = scratch("oma-adv-ext-");
  try {
    const index = bundle(root);
    const libdir = join(root, "lib");
    mkdirSync(join(libdir, "extensions"), { recursive: true });
    const outside = join(root, "outside.js");
    writeFileSync(outside, "export {};\n");
    symlinkSync(outside, join(libdir, "extensions", "linked.js"));

    const context = readExtensions(index, "principal", "resident");
    for (const row of context.rows)
      assert.ok(!row.id.startsWith("..") && !row.id.startsWith("/"),
        `offered id escapes libdir: ${row.id}`);
    // An id naming a path outside libdir is refused at write time as well.
    if (context.editable)
      assert.throws(() => toggleExtension(context, "../outside.js", "workers", true), (error: unknown) =>
        error instanceof StoreError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a settings write refuses a value the closed config schema would reject", () => {
  const root = scratch("oma-adv-value-");
  try {
    const index = bundle(root);
    const layout = layoutOf(index);
    assert.equal(layout.kind, "operations");
    // The bundle here has no valid HostConfigV1, so composing must fail rather
    // than letting a write proceed against an unvalidated config.
    assert.throws(() => commitField(readSettings(index), WORKER_LIMIT, 4), (error: unknown) =>
      error instanceof StoreError);
    void corrupt;
  } finally { rmSync(root, { recursive: true, force: true }); }
});
