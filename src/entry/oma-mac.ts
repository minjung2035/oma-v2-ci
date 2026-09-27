/** `oma` on the Mac (macos-platform §2.4): the Human's command. It speaks
 * only the Host API; the society's screen is drawn by the society's own `oma`
 * in the engine, and this command carries it.
 *
 * usage: oma attach <society> [--takeover] | oma status | oma list
 *        oma open <society> --project <id> | oma stop
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:net";
import { constants } from "node:os";
import { encodeFrame } from "../frame.js";
import { PlatformError, readLeadingFrame } from "../platform/rpc.js";
import { attachTerminal } from "../platform/host/attach-client.js";
import { HOST_API_VERSION } from "../protocol/host-api.js";
import { PLATFORM_FRAME_BYTES } from "../protocol/host-guest.js";

function say(line: string, code: number): never { process.stderr.write(`${line}\n`); process.exit(code); }
const userHome = process.env.HOME;
if (process.env.OMA_HOST_HOME === undefined && (userHome === undefined || !userHome.startsWith("/"))) say("HOME is not set", 2);
const home = process.env.OMA_HOST_HOME ?? join(userHome!, "Library", "Application Support", "OMA");
const socketPath = join(home, "run", "hostapi.sock");
let token: string;
try { token = readFileSync(join(home, "run", "token"), "utf8").trim(); }
catch { say("OMA가 실행 중이 아닙니다. OMA 앱을 여세요.", 3); }

const STATES: Record<string, string> = { stopped: "멈춤", booting: "준비 중", handshaking: "준비 중", ready: "실행 중",
  draining: "멈추는 중", forced: "멈추는 중", crashed: "다시 시작하는 중", failed: "복구 필요" };

async function call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const socket = connect(socketPath);
  await new Promise<void>((ok, fail) => { socket.once("connect", ok); socket.once("error", fail); });
  socket.write(encodeFrame({ v: 1, id: "h", method: "hello", params: { api: { min: Math.max(1, HOST_API_VERSION - 1), max: HOST_API_VERSION }, token, client: "oma-cli" } }));
  const hello = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 10_000);
  if (hello.frame.ok !== true) { socket.destroy(); throw new PlatformError(hello.frame.error as never); }
  if (hello.rest.length > 0) socket.unshift(hello.rest);
  socket.write(encodeFrame({ v: 1, id: "r", method, params }));
  const answer = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 180_000);
  socket.destroy();
  if (answer.frame.ok !== true) throw new PlatformError(answer.frame.error as never);
  return answer.frame.result as Record<string, unknown>;
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, society] = argv;
  if (command === "status") { const { state } = await call("engine.status", {}); say(`OMA 엔진: ${STATES[String(state)] ?? "알 수 없음"}`, 0); }
  if (command === "list") {
    const { societies } = await call("society.list", {}) as { societies: { society: string; running: boolean }[] };
    for (const entry of societies) process.stdout.write(`${entry.society}\t${entry.running ? "실행 중" : "멈춤"}\n`);
    return;
  }
  if (command === "stop") { const { result } = await call("engine.stop", {}); say(result === "forced" ? "OMA 엔진을 강제로 멈췄습니다. 다음 실행 때 복구합니다." : "OMA 엔진을 멈췄습니다.", 0); }
  if (command === "open" && society !== undefined) {
    const at = argv.indexOf("--project");
    await call("society.open", { society, projectId: at > 0 ? argv[at + 1] : undefined });
  } else if (command !== "attach" || society === undefined) say("usage: oma attach <society> [--takeover] | status | list | open <society> --project <id> | stop", 2);
  const end = await attachTerminal({ socketPath, token, society: society!, takeover: argv.includes("--takeover"),
    frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 180_000,
    terminal: { input: process.stdin, output: process.stdout,
      onResize: listener => { process.stdout.on("resize", listener); return () => { process.stdout.off("resize", listener); }; } } });
  if (end.kind === "exit") process.exit(end.code ?? 1);
  // Asked to end: the conventional status of a process a signal ended.
  if (end.kind === "stopped") process.exit(128 + (constants.signals[end.signal as NodeJS.Signals] ?? 0));
  if (end.kind === "detached") say("다른 화면이 이 society를 가져갔습니다.", 0);
  if (end.kind === "refused") say(end.code === "ATTACH_CONFLICT" ? "이 society는 다른 화면에서 열려 있습니다. 여기서 계속하려면 --takeover를 붙이세요." : end.message, 1);
  // P0-5: the connection ended without a word; the society may still run.
  say("OMA 엔진과의 연결이 끊겼습니다. society는 계속 실행 중일 수 있습니다.", 3);
}
main(process.argv.slice(2)).catch(error => {
  if (error instanceof PlatformError) say(error.failure.retry === "same-key" ? "결과를 확인하는 중입니다. 잠시 뒤 다시 시도하세요." : error.failure.message, 1);
  say(error instanceof Error ? error.message : String(error), 1);
});
