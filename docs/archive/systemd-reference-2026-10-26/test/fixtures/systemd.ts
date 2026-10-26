import { spawnSync } from "node:child_process";
import { readdirSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface SystemdResult {
  status: number | null;
  signal: string | null;
  error?: Error;
  stdout: string;
  stderr: string;
}
export type SystemdCommand = (args: readonly string[]) => SystemdResult;
const systemctl: SystemdCommand = (args) => {
  if (process.env.OMA_TEST_SYSTEMD !== "1")
    throw new Error(
      "BLOCKED: real user-manager tests require OMA_TEST_SYSTEMD=1 and a disposable test user",
    );
  return spawnSync("systemctl", ["--user", ...args], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 65536,
    killSignal: "SIGKILL",
  });
};
function succeeded(result: SystemdResult, action: string): string {
  if (result.error || result.signal || result.status !== 0)
    throw new Error(`systemd test ${action} failed: ${result.stderr}`);
  return result.stdout;
}
export function requireSystemdTestManager(): void {
  const version = succeeded(
    systemctl(["show", "--property=Version", "--value"]),
    "preflight",
  ).trim();
  if (!version)
    throw new Error("BLOCKED: systemd user manager returned no version");
}
function observation(
  name: string,
  run: SystemdCommand,
): { load: string; fragment: string } {
  const result = run([
    "show",
    name,
    "--property=LoadState,FragmentPath",
    "--no-pager",
  ]);
  const fields = new Map<string, string>();
  for (const line of result.stdout.trim().split("\n")) {
    const equals = line.indexOf("=");
    if (equals < 1 || fields.has(line.slice(0, equals)))
      throw new Error(`unavailable systemd test observation: ${name}`);
    fields.set(line.slice(0, equals), line.slice(equals + 1));
  }
  const load = fields.get("LoadState");
  const fragment = fields.get("FragmentPath");
  if (
    result.error ||
    result.signal ||
    load === undefined ||
    fragment === undefined ||
    (result.status !== 0 &&
      !(result.status === 1 && load === "not-found" && fragment === ""))
  )
    throw new Error(`unavailable systemd test observation: ${name}`);
  return { load, fragment };
}
/** Only definitions physically created under this fixture's owned root are candidates.
 * These fixtures retain their generated definitions until this call snapshots
 * their exact names. Do not remove definitions/root before verified cleanup.
 * The manager's FragmentPath must match before any unit is stopped/disabled.
 * Keep the fixture root if cleanup fails; never substitute a society-wide glob.
 */
export function cleanupOwnedSystemdUnits(
  root: string,
  society: string,
  run: SystemdCommand = systemctl,
): void {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(society))
    throw new Error("invalid test society");
  const definitions = new Map<string, string>();
  const walk = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        entry.isFile() &&
        entry.name.startsWith(`oma-${society}-`) &&
        /\.(?:service|path|timer)$/.test(entry.name)
      ) {
        if (
          !/^oma-[a-z0-9-]+\.(?:service|path|timer)$/.test(entry.name) ||
          definitions.has(entry.name)
        )
          throw new Error(`ambiguous test unit ownership: ${entry.name}`);
        definitions.set(entry.name, path);
      }
    }
  };
  walk(root);
  if (!definitions.size) return;
  const present: string[] = [];
  // Validate every owner before issuing any mutation.
  for (const [name, path] of definitions) {
    const observed = observation(name, run);
    if (observed.load === "not-found" && observed.fragment === "") continue;
    if (
      !observed.fragment ||
      realpathSync(observed.fragment) !== realpathSync(path)
    )
      throw new Error(`refusing cleanup of a foreign unit: ${name}`);
    present.push(name);
  }
  // Stop while the definitions are still loaded: systemd 257 removes the link
  // before `disable --now` stops, and an inactive unit is then "not loaded".
  if (present.length) {
    succeeded(run(["stop", ...present]), "stop exact owned units");
    succeeded(run(["disable", ...present]), "disable exact owned units");
  }
  for (const path of definitions.values()) unlinkSync(path);
  succeeded(run(["daemon-reload"]), "reload after cleanup");
  for (const name of definitions.keys()) {
    // systemd reports a pattern that matches no unit file with status 1 and no
    // output (observed on 257); any other failure is still unavailable.
    const query = run(["list-unit-files", name, "--no-legend", "--no-pager"]);
    const listed = !query.error && !query.signal && query.status === 1 && query.stdout.trim() === ""
      ? ""
      : succeeded(query, "verify unit-file absence").trim();
    const observed = observation(name, run);
    if (listed || observed.load !== "not-found" || observed.fragment !== "")
      throw new Error(
        `test unit remains in manager lookup after cleanup: ${name}`,
      );
  }
}
