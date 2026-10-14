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
 *   without buffering it. The declared body is never sent in full, so the
 *   discarder is still owed bytes when the call tears down.
 * - `oversized-then-serve`: the first diagnostics request gets a COMPLETE
 *   oversized frame (declared and delivered); every later diagnostics
 *   request answers normally -- proves the refuse-a-request path drops
 *   the frame, realigns the wire, and keeps the server alive.
 * - `frame-drip`: streams more bytes than the inbound bound without ever
 *   completing a frame -- the accumulation bound must trip.
 * - `push-flood`: pushes more diagnostics for one file than the bound.
 * - `push-big-message`: pushes one diagnostic whose message is over bound.
 * - `push-uri-flood`: pushes publications for more distinct documents
 *   than the tracked-URI bound, then the opened file's own -- the opened
 *   file's publication is the drop the resolved list must name. The
 *   scenario advertises a pull provider and answers the pull with an
 *   empty list: the response is the client's ordering barrier (its reads
 *   are FIFO), so every pushed frame is stored and every drop counted
 *   before the grace wait resolves -- a push-only variant raced the whole
 *   flood against the settle window and could resolve mid-delivery.
 * - `push-flood-uri-flood`: pushes the opened file's own over-bound
 *   publication, then the URI flood, then the file's publication again --
 *   the resolved list carries the stored truncation marker AND the
 *   URI-drop marker, and the re-flagging pass must count both right. Same
 *   pull barrier: without it the settle timer could fire while the flood
 *   was still arriving, cutting the resolved list before all five drops
 *   were counted.
 * - `pull-uri-flood`: the pull path's URI flood -- publications pushed on
 *   didOpen overflow the tracked-document bound while the pull request is
 *   in flight, so the answered list must still name the drops.
 * - `uri-flood-timeout`: pushes the URI flood but never the opened file's
 *   publication -- the diagnostics waiter times out and its error must
 *   report the drops the wire already took.
 * - `partial-answers`: answers only the first two pull diagnostics
 *   requests; the rest hang until the request timeout -- the call's other
 *   files must keep their results.
 * - `oversized-notification`: sends one COMPLETE oversized NOTIFICATION
 *   (no id to sniff) while a request is pending, then answers normally --
 *   the pending request must survive; the drop is counted and rides the
 *   next error's tail.
 * - `slow-drain`: pauses its stdin briefly after the first didOpen so the
 *   client's big writes backpressure, then resumes -- the drain path must
 *   complete the call.
 * - `stdin-stall`: pauses stdin forever after the first didOpen -- a
 *   backpressured write must fail bounded (the drain budget), never hang.
 * - `marker-context`: answers diagnostics with a flood (so OMA's marker
 *   is in the list), then reports in its resolved edit how many
 *   diagnostics the codeAction context carried -- proving markers are
 *   never forwarded to the server.
 * - `pull-flood` / `pull-big-message`: same floods through the pull path.
 * - `slow-stages`: every request is answered ~600ms late -- diagnostics,
 *   codeAction, resolve -- so the call's total run exceeds a modest
 *   stall window while no single silence gap does. Only a progress-reset
 *   window lets the call finish; a fixed aggregate deadline kills it.
 * - `actions-flood`: returns more code actions than the old resolve bound;
 *   the sequential codeAction/resolve loop resolves every one.
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
 * - `env-probe`: reports which of a fixed list of environment names
 *   actually reached the spawned child -- deny-by-default is observable
 *   inside the process, not only in the map the parent computed.
 * - `pid-echo`: reports its own pid in a diagnostic (and inside a code
 *   action title), so a test can prove every call spawned a fresh
 *   process without any env channel (the PI_LSP_TEST_* channels are
 *   correctly stripped now).
 */
import process from "node:process";

const scenario = process.argv[2];
let buffer = Buffer.alloc(0);

const STDERR_FLOOD_BYTES = 512 * 1024;
const FRAME_DRIP_BYTES = 5 * 1024 * 1024;
const OMA_TEST_MAX_EDITS = 2048;

/** The URI the client opened -- edits are attached to it at resolve time. */
let openedUri;
/** oversized-then-serve fires its one complete oversized frame on the
 * first diagnostics request, then answers normally. */
let oversizedServed = false;

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

const PULL_SCENARIOS = new Set(["stderr-flood", "stderr-flood-exit", "pull-flood", "pull-big-message", "actions-flood", "edits-flood", "edits-documentchanges-flood", "edit-bytes-flood", "edits-at-bound", "oversized-frame", "oversized-then-serve", "oversized-notification", "frame-drip", "env-echo", "env-probe", "pid-echo", "slow-stages", "pull-uri-flood", "push-uri-flood", "push-flood-uri-flood", "partial-answers", "slow-drain", "stdin-stall", "marker-context"]);
/** Each slow-stages stage delay. Below the client's 1000ms request floor,
 * so no single request times out; three of them put the whole call well
 * past a ~1s observation window, which is what proves the window resets
 * on progress instead of acting as a fixed aggregate deadline. */
const SLOW_STAGE_MS = 600;
/** How long slow-drain stops reading stdin -- long enough to prove the
 * client waited on 'drain', far under any request timeout. */
const SLOW_DRAIN_MS = 350;
/** Documents pushed by push-uri-flood before the opened file's own
 * publication -- the client's tracked-document bound is 4096, so these
 * fill the map and leave later publications as counted drops. */
const URI_FLOOD_DOCS = 4100;
/** Diagnostics partial-answers answers; the rest of the fan-out hangs. */
const PARTIAL_ANSWERS = 2;
let diagnosticsAsked = 0;
/** Diagnostics the server saw inside marker-context's codeAction params. */
let markerContextCount = -1;
/** oversized-notification fires its one frame on the first didOpen only. */
let oversizedNotified = false;

/** Push publications for URI_FLOOD_DOCS distinct documents -- fills the
 * client's 4096-document bound so the last 4 become counted drops. */
function pushUriFlood() {
  for (let i = 0; i < URI_FLOOD_DOCS; i++)
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
      params: { uri: `file:///flood-${i}.tfix`, diagnostics: [diagnostic(`flood ${i}`)] } });
}

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
    else if (scenario === "push-uri-flood") {
      // Fill the tracked-document bound, then push the opened file's own
      // publication: the client's URI bound drops it and must name the
      // drop in the resolved list.
      pushUriFlood();
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [diagnostic("the opened file's own publication -- dropped past the bound")] } });
    }
    else if (scenario === "push-flood-uri-flood") {
      // The opened file's own publication is stored AND truncated first;
      // the URI flood overflows the tracked bound; the second copy of the
      // file's publication re-arms the client's settle timer, so the
      // resolved list is built only after every drop is already counted.
      // The list it resolves carries BOTH markers -- the stored truncation
      // marker and the URI-drop marker appended at settle.
      const flood = Array.from({ length: 2000 }, (_v, i) => diagnostic(`flood ${i}`, i));
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: flood } });
      pushUriFlood();
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: flood } });
    }
    else if (scenario === "pull-uri-flood") {
      // The same flood while the pull request is in flight: the drops are
      // already counted when the pull answer lands, so the early return
      // must still name them.
      pushUriFlood();
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [diagnostic("the opened file's own publication -- dropped past the bound")] } });
    }
    else if (scenario === "uri-flood-timeout") {
      // Fill the tracked map but never publish for the opened file -- the
      // diagnostics waiter times out with the drop count already taken.
      pushUriFlood();
    }
    else if (scenario === "oversized-notification") {
      // A COMPLETE oversized NOTIFICATION -- no body id to sniff -- while
      // a request pends: the pending request must survive the drop. Sent
      // once, on the first didOpen, so the counted drop stays exactly one.
      if (!oversizedNotified) {
        oversizedNotified = true;
        const body = JSON.stringify({ jsonrpc: "2.0", method: "window/logMessage",
          params: { type: 1, message: `notice ${"n".repeat(5 * 1024 * 1024)}` } });
        process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      }
    }
    else if (scenario === "slow-drain") {
      // Stop reading stdin briefly: the client's next big didOpen writes
      // backpressure into the pipe, then resume so 'drain' completes the
      // call. Deterministic -- the pause lands exactly after the first
      // parsed didOpen frame.
      process.stdin.pause();
      setTimeout(() => process.stdin.resume(), SLOW_DRAIN_MS);
    }
    else if (scenario === "stdin-stall") {
      // Never read again: a backpressured write must fail bounded, not
      // hang. The interval keeps the process alive -- without a ref'd
      // handle pause() would empty the loop and exit, closing the pipe
      // (an early EPIPE, not the stall the scenario exists to prove).
      process.stdin.pause();
      setInterval(() => {}, 60_000);
    }
    else
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } });
    return;
  }
  if (message.method === "textDocument/diagnostic") {
    diagnosticsAsked += 1;
    if (scenario === "partial-answers") {
      // Only the first files answered; the rest hang into the request
      // timeout so the call's per-file degrade is exercised.
      if (diagnosticsAsked > PARTIAL_ANSWERS) return;
      send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic(`answered ${diagnosticsAsked}`)] } });
      return;
    }
    if (scenario === "pull-uri-flood" || scenario === "slow-drain" || scenario === "stdin-stall") {
      send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic("pull answer")] } });
      return;
    }
    if (scenario === "push-uri-flood" || scenario === "push-flood-uri-flood") {
      // The empty pull answer is the ordering barrier: it is written only
      // after the client asked, and everything the server pushed on
      // didOpen is already ahead of it on the wire. When the client
      // processes this response, each publication is stored and every
      // dropped URI counted -- the settled diagnostics deterministically
      // carry the complete state instead of racing the flood's arrival
      // against the settle window.
      send({ jsonrpc: "2.0", id: message.id, result: { items: [] } });
      return;
    }
    if (scenario === "marker-context") {
      send({ jsonrpc: "2.0", id: message.id,
        result: { items: Array.from({ length: 2000 }, (_v, i) => diagnostic(`flood ${i}`, i)) } });
      return;
    }
    if (scenario === "oversized-notification") {
      // The first request is answered normally -- the pending request
      // survived the unidentifiable oversized frame. Later requests hang
      // so the client's error tail reports the counted drop.
      if (diagnosticsAsked === 1)
        send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic("answer after the dropped notification")] } });
      return;
    }
    if (scenario === "oversized-frame") {
      process.stdout.write(`Content-Length: ${6 * 1024 * 1024}\r\n\r\n{"jsonrpc":"2.0"`);
      return;
    }
    if (scenario === "oversized-then-serve") {
      // First diagnostics request gets a COMPLETE oversized frame -- the
      // body is fully sent so the client's discarder reaches the frame's
      // end and the next frame parses cleanly.
      if (!oversizedServed) {
        oversizedServed = true;
        const body = JSON.stringify({
          jsonrpc: "2.0", id: message.id,
          result: { items: [diagnostic(`pad ${"p".repeat(5 * 1024 * 1024)}`)] },
        });
        process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        return;
      }
      send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic("recovered")] } });
      return;
    }
    if (scenario === "slow-stages") {
      setTimeout(() => send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic("slow diagnostic")] } }), SLOW_STAGE_MS);
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
    if (scenario === "env-probe") {
      const names = ["OMA_SOCKET", "OMA_TOOL_SURFACE", "NODE_OPTIONS", "GOPRIVATE", "PERLLIB",
        "RUSTFLAGS", "HTTP_PROXY", "http_proxy", "PI_LSP_TEST_LOG", "SSH_AUTH_SOCK", "BASH_ENV",
        "HOME", "XDG_CACHE_HOME", "TMPDIR", "PATH", "LANG", "LC_ALL", "TERM", "PROBED_ADAPTER"];
      send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic(
        names.map(name => `${name}=${process.env[name] === undefined ? "absent" : "present"}`).join(" "))] } });
      return;
    }
    if (scenario === "pid-echo") {
      send({ jsonrpc: "2.0", id: message.id, result: { items: [diagnostic(`pid=${process.pid}`)] } });
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
    if (scenario === "marker-context") {
      // Report through the resolved edit how many diagnostics the
      // codeAction context carried -- OMA's markers must be filtered out
      // before they ever reach the server.
      markerContextCount = Array.isArray(message.params?.context?.diagnostics)
        ? message.params.context.diagnostics.length : -1;
      send({ jsonrpc: "2.0", id: message.id,
        result: [{ title: "ctx fix", kind: "source.fixAll", data: {} }] });
      return;
    }
    if (scenario === "slow-stages") {
      setTimeout(() => send({ jsonrpc: "2.0", id: message.id,
        result: [{ title: "slow fix", kind: "source.fixAll", data: {} }] }), SLOW_STAGE_MS);
      return;
    }
    send({ jsonrpc: "2.0", id: message.id,
      result: scenario === "actions-flood"
        ? Array.from({ length: 300 }, (_v, i) => ({ title: `action ${i}`, kind: "source.fixAll", data: {} }))
        : scenario === "edits-flood" || scenario === "edit-bytes-flood"
          ? [{ title: "flood-a", kind: "source.fixAll", data: {} }, { title: "flood-b", kind: "source.fixAll", data: {} }]
          : [{ title: scenario === "pid-echo" ? `fix pid=${process.pid}` : "fix", kind: "source.fixAll", data: {} }] });
    return;
  }
  if (message.method === "codeAction/resolve") {
    if (scenario === "marker-context") {
      send({ jsonrpc: "2.0", id: message.id, result: { ...message.params,
        edit: { changes: { [openedUri]: [{
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: `// context-diagnostics=${markerContextCount}\n`,
        }] } } } });
      return;
    }
    if (scenario === "slow-stages") {
      const edit = { changes: { [openedUri]: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: "// slow-fixed\n",
      }] } };
      setTimeout(() => send({ jsonrpc: "2.0", id: message.id, result: { ...message.params, edit } }), SLOW_STAGE_MS);
      return;
    }
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
