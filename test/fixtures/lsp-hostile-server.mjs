/** OMA-owned hostile fixture server for the bundled-pi-lsp bounds tests.
 * Lives outside the vendored bundle (upstream-tests/ is the byte-exact npm
 * snapshot, so nothing can be added there); the wire protocol is the same
 * Content-Length framed JSON-RPC the vendored fixture speaks.
 *
 * Scenarios (argv[2]):
 * - `stderr-flood`: answers initialize/pull normally but writes far more
 *   than the client's 64KiB stderr bound; the diagnostic request then
 *   fails so a bounded stderr tail stays small in the error.
 * - `stderr-flood-exit`: floods stderr past the bound, then dies mid-request --
 *   the exit path's stderr tail must show the truncation marker. The flood
 *   is drained deterministically: the exit only happens after every byte
 *   reached the pipe, so the client has provably consumed past its bound
 *   before the error lands (a fixed sleep raced the reader under load).
 * - `oversized-frame`: on the diagnostics request, announces a
 *   Content-Length far past the inbound bound -- the client must refuse
 *   without buffering it.
 * - `frame-drip`: streams more bytes than the inbound bound without ever
 *   completing a frame -- the accumulation bound must trip.
 * - `push-flood`: pushes more diagnostics for one file than the bound.
 * - `push-big-message`: pushes one diagnostic whose message is over bound.
 * - `pull-flood` / `pull-big-message`: same floods through the pull path.
 * - `actions-flood`: returns more code actions than the resolve bound, so
 *   the sequential codeAction/resolve loop never starts.
 * - `edits-flood`: two actions whose edits total more than the accumulated
 *   edit bound -- the count cap is per list, the total is OMA's bound.
 * - `edits-documentchanges-flood`: one action whose documentChanges carry
 *   more edits than the per-list bound.
 * - `edit-bytes-flood`: few edits whose newText total exceeds the byte
 *   bound -- count under the bound, bytes over.
 * - `edits-at-bound`: exactly the edit bound of inserts -- under/at the
 *   bound applies, it is not refused.
 * - `env-echo`: a benign server whose one diagnostic reports the HOME,
 *   XDG_CACHE_HOME and TMPDIR it was spawned with -- the scratch redirect
 *   is observable only through the child's own environment.
 */
import process from "node:process";

const scenario = process.argv[2];
let buffer = Buffer.alloc(0);

const STDERR_FLOOD_BYTES = 512 * 1024;
const FRAME_DRIP_BYTES = 5 * 1024 * 1024;
const OMA_TEST_MAX_EDITS = 2048;

/** The URI the client opened -- edits are attached to it at resolve time. */
let openedUri;

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function diagnostic(message, line = 0) {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 1 } },
    severity: 1,
    source: "hostile",
    message,
  };
}

const PULL_SCENARIOS = new Set(["stderr-flood", "stderr-flood-exit", "pull-flood", "pull-big-message", "actions-flood", "edits-flood", "edits-documentchanges-flood", "edit-bytes-flood", "edits-at-bound", "oversized-frame", "frame-drip", "env-echo"]);

/** Queue the whole flood, then call done only after every byte reached the
 * kernel pipe. Write callbacks fire on flush, so done() means the reader
 * has consumed all but a pipe's capacity -- far past its 64KiB bound, not
 * "probably, if it scheduled reads in time" the way a sleep guessed. */
function floodStderr(done) {
  const line = `${"e".repeat(4096)}\n`;
  const writes = Math.ceil(STDERR_FLOOD_BYTES / line.length);
  let flushed = 0;
  let queued = 0;
  const onFlush = () => { flushed += 1; if (flushed === writes) done(); };
  const pump = () => { while (queued < writes && process.stderr.write(line, onFlush)) queued += 1; };
  process.stderr.on("drain", pump);
  pump();
}

function dripBytes() {
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  for (let written = 0; written < FRAME_DRIP_BYTES; written += chunk.length)
    process.stdout.write(chunk);
}

function handle(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities: PULL_SCENARIOS.has(scenario)
          ? { diagnosticProvider: {}, codeActionProvider: { resolveProvider: true } }
          : {},
      },
    });
    return;
  }
  if (message.method === "textDocument/didOpen") {
    const uri = message.params.textDocument.uri;
    openedUri = uri;
    if (scenario === "push-flood")
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: Array.from({ length: 2000 }, (_v, i) => diagnostic(`flood ${i}`, i)) } });
    else if (scenario === "push-big-message")
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [diagnostic("x".repeat(20_000))] } });
    else
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
    return;
  }
  if (message.method === "textDocument/diagnostic") {
    if (scenario === "oversized-frame") {
      process.stdout.write(`Content-Length: ${6 * 1024 * 1024}\r\n\r\n{"jsonrpc":"2.0"`);
      return;
    }
    if (scenario === "frame-drip") { dripBytes(); return; }
    if (scenario === "stderr-flood" || scenario === "stderr-flood-exit") {
      floodStderr(() => {
        // Everything above is flushed to the kernel before this runs, so the
        // client's bound has provably tripped and the marker is already in
        // the sample when the error below lands. process.exit() still drops
        // writes buffered in userspace, which is why the drain comes first.
        if (scenario === "stderr-flood-exit") process.exit(1);
        else send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "intentional failure after stderr flood" } });
      });
      return;
    }
    if (scenario === "env-echo") {
      send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic(
        `env HOME=${process.env.HOME} XDG_CACHE_HOME=${process.env.XDG_CACHE_HOME} TMPDIR=${process.env.TMPDIR}`)] } });
      return;
    }
    if (scenario === "pull-flood") {
      send({ jsonrpc: "2.0", id: message.id,
        result: { items: Array.from({ length: 2000 }, (_v, i) => diagnostic(`flood ${i}`, i)) } });
      return;
    }
    if (scenario === "pull-big-message") {
      send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic("x".repeat(20_000))] } });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result: { items: [] } });
    return;
  }
  if (message.method === "textDocument/codeAction") {
    send({ jsonrpc: "2.0", id: message.id,
      result: scenario === "actions-flood"
        ? Array.from({ length: 300 }, (_v, i) => ({ title: `action ${i}`, kind: "source.fixAll", data: {} }))
        : scenario === "edits-flood" || scenario === "edit-bytes-flood"
          ? [{ title: "flood-a", kind: "source.fixAll", data: {} }, { title: "flood-b", kind: "source.fixAll", data: {} }]
          : [{ title: "fix", kind: "source.fixAll", data: {} }] });
    return;
  }
  if (message.method === "codeAction/resolve") {
    // The edit floods hide inside each resolved action's edit -- the action
    // count itself stays under the cap.
    const insert = (newText) => ({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText,
    });
    let edit;
    if (scenario === "edits-flood")
      edit = { changes: { [openedUri]: Array.from({ length: OMA_TEST_MAX_EDITS }, (_v, i) => insert(`x${i}`)) } };
    else if (scenario === "edits-documentchanges-flood")
      edit = { documentChanges: [{ textDocument: { uri: openedUri }, edits: Array.from({ length: OMA_TEST_MAX_EDITS + 1 }, () => insert("y")) }] };
    else if (scenario === "edit-bytes-flood")
      // Each resolve frame stays under the inbound bound; the byte flood is
      // the accumulation across the two actions -- 2 x 3MiB > 4MiB.
      edit = { changes: { [openedUri]: [insert("z".repeat(3 * 1024 * 1024))] } };
    else if (scenario === "edits-at-bound")
      edit = { changes: { [openedUri]: Array.from({ length: OMA_TEST_MAX_EDITS }, () => insert("x")) } };
    send({ jsonrpc: "2.0", id: message.id, result: edit === undefined ? message.params : { ...message.params, edit } });
    return;
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "exit") process.exit(0);
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator < 0) return;
    const header = buffer.subarray(0, separator).toString("utf8");
    const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
    const bodyStart = separator + 4;
    if (!Number.isFinite(length) || buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
