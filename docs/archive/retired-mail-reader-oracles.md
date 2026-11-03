# Retired model mail-reader positive oracles — original bodies and FAIL

DR72/MCS-S13 removes `oma_mail_read` and raw archive aliases from the model surface. Original P0V-36/N13 and P0V-37/N14 therefore cannot remain executable compatibility requirements. Their original bodies below, names/IDs, and observed failure are preserved; neither is renamed into a current no-tool PASS.

Observed original execution: `/tmp/oma-goal-mvzejzp1/review-plan-retirement-bound-regressions.log`, fixed 15,853-input closure, 385 tests / 374 PASS / 11 FAIL, exit1. Both cases failed at the removed tool's `.execute`. This archive is not a PASS, an original-release drain, or authority to expose raw mail paths again.

Separate current oracles live in `test/collaboration-mail-read-bounds.test.ts`: actual Mail/Store publication, the exact declared Principal record path, packaged anchored read, contained grep plus immutable result-page read for oversized lines, all original 16KiB body shapes and 256KiB stress, both engine stored-byte declarations, original EML/accepted operation/delivery preservation, and explicit archive/alias refusal. Those intentionally different role-contained paths do not establish that the old aliases work.

Original dependencies are the imports in `test/p0-review4.test.ts` at the recorded execution: `node:test`, strict assert, fs/path/os, `registerOmaTools`, `storedMailBytes`, `buildEml`, `principalEnvironment`, `planPiSpawn`, `residentOptions`, and `residentEngineEffects`. The original complete two test bodies follow verbatim.

```ts
test("P0V-37 / N14, P0-2: a message path the Principal was shown reads back through the same mail tool", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-shown-path-"));
  const archive = join(root, "state", "mail", "archive", "cur");
  mkdirSync(archive, { recursive: true });
  const id = "m-00000000-0000-4000-8000-0000000000aa-0";
  writeFileSync(join(archive, `${id}:2,`), "Subject: shown\r\n\r\nthe body\r\n");
  const previous = { ...process.env };
  const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
  // The Principal's engine: its archive root is the host's own path (DR1).
  Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: archive,
    OMA_SOCKET: "/nonexistent/socket", OMA_SOCIETY: "demo" });
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root);
    const read = tools.get("oma_mail_read")!;
    for (const shown of [join(archive, `${id}:2,`), `/mail/archive/cur/${id}:2,`, `${id}:2,`, id])
      assert.match((await read.execute("t", { messageId: shown })).content[0]!.text, /the body/, `could not read back ${shown}`);
    // Only the root it was shown with: the same file name under another directory names nothing.
    await assert.rejects(read.execute("t", { messageId: join(root, `${id}:2,`) }), /message id or canonical archive path|expected a message id/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("P0V-36 / N13, P0-2: a message whose body is within the body limit is read back whole by the mail tool", async () => {
  const bodyBytes = 16 * 1024;
  // Both engines are told the bound of a stored message, not the body's.
  const principal = principalEnvironment({ stateRoot: "/srv/oma-n13", runRoot: "/run/oma-n13", libdir: "/opt/oma" },
    { society: "demo", provider: "pi", model: "current", extensions: [] }, { frameBytes: 256 * 1024, mailBodyBytes: bodyBytes, batchMaxMessages: 4, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 });
  assert.equal(Number(principal.OMA_MAIL_BYTES), storedMailBytes(bodyBytes));
  const state = "/srv/oma-n13";
  const options = residentOptions(state);
  const plan = planPiSpawn(residentEngineEffects.sandbox, { ...options, limits: { ...options.limits, mailBodyBytes: bodyBytes } });
  const told = plan.env.OMA_MAIL_BYTES ?? plan.args[plan.args.indexOf("OMA_MAIL_BYTES") + 1];
  assert.equal(Number(told), storedMailBytes(bodyBytes), "the Resident's engine was told the body limit");

  // The widest bodies the writer can be given: every byte a quoted-printable
  // escape, Korean and emoji text, and line breaks.
  const bodies: Record<string, string> = {
    equals: `a${"=".repeat(bodyBytes - 1)}`, korean: "가a".repeat(bodyBytes / 4), emoji: "😀abc".repeat(Math.floor(bodyBytes / 7)), lines: "a\n".repeat(bodyBytes / 2),
  };
  const root = mkdtempSync(join(tmpdir(), "oma-n13-"));
  const archive = join(root, "archive"); mkdirSync(archive);
  const previous = { ...process.env };
  const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { text: string }[] }> }>();
  Object.assign(process.env, { OMA_AGENT_HOME: root, OMA_MAIL_ARCHIVE: archive,
    OMA_SOCKET: "/nonexistent/socket", OMA_SOCIETY: "demo", OMA_MAIL_BYTES: principal.OMA_MAIL_BYTES });
  try {
    registerOmaTools({ registerTool: (tool: never) => { const t = tool as { name: string }; tools.set(t.name, tool); } } as never, root);
    let index = 0;
    for (const [name, body] of Object.entries(bodies)) {
      assert.ok(Buffer.byteLength(body) <= bodyBytes, name);
      const id = `m-00000000-0000-4000-8000-0000000001${String(index++).padStart(2, "0")}-0`;
      const eml = await buildEml({ from: "a@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [], subject: name, kind: "message",
        contextRevision: null, inReplyTo: null, references: [], messageId: `${id}@demo.oma.invalid`, body });
      assert.ok(eml.bytes <= storedMailBytes(bodyBytes), `${name}: ${eml.bytes} stored bytes exceed the bound`);
      writeFileSync(join(archive, `${id}:2,`), eml.text);
      const shown = (await tools.get("oma_mail_read")!.execute("t", { messageId: id })).content[0]!.text;
      // The writer ends the stored body with a line break of its own.
      const read = shown.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n/g, "\n");
      assert.ok(read === body || read === `${body}\n`, `${name} was not read back whole (${read.length} of ${body.length} characters)`);
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    rmSync(root, { recursive: true, force: true });
  }
});
```
