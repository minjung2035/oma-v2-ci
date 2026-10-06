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
 *   the exit path's stderr tail must show the truncation marker.
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
 * - `env-echo`: a benign server whose one diagnostic reports the HOME,
 *   XDG_CACHE_HOME and TMPDIR it was spawned with -- the scratch redirect
 *   is observable only through the child's own environment.
 */
import process from "node:process";

const scenario = process.argv[2];
let buffer = Buffer.alloc(0);

const STDERR_FLOOD_BYTES = 200 * 1024;
const FRAME_DRIP_BYTES = 5 * 1024 * 1024;

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

const PULL_SCENARIOS = new Set(["stderr-flood", "stderr-flood-exit", "pull-flood", "pull-big-message", "actions-flood", "oversized-frame", "frame-drip", "env-echo"]);

function floodStderr() {
  const line = `${"e".repeat(4096)}\n`;
  for (let written = 0; written < STDERR_FLOOD_BYTES; written += line.length)
    process.stderr.write(line);
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
      floodStderr();
      // exit() drops writes still buffered in the pipe; drain first so the
      // client's accumulation bound provably trips before the exit lands.
      if (scenario === "stderr-flood-exit") setTimeout(() => process.exit(1), 150);
      else send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "intentional failure after stderr flood" } });
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
        : [{ title: "fix", kind: "source.fixAll", data: {} }] });
    return;
  }
  if (message.method === "codeAction/resolve") {
    send({ jsonrpc: "2.0", id: message.id, result: message.params });
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
