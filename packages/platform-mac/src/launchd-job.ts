/** Per-execution launchd user-job mechanics. Shared execution policy decides
 * when a scope is admitted, stopped or recovered; this module only provisions
 * and removes a kernel-owned process leader with a new audit session. */
import { load } from "koffi";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withCleanup } from "@oma/native/cleanup";
import type { CommandSpec } from "@oma/process/command";

interface LaunchCalls {
  dictionary(type: number): unknown;
  array(type: number): unknown;
  string(value: string): unknown;
  boolean(value: boolean): unknown;
  integer(value: bigint): unknown;
  machport(value: number): unknown;
  insert(dictionary: unknown, value: unknown, key: string): boolean;
  append(array: unknown, index: number, value: unknown): boolean;
  count(array: unknown): number;
  message(value: unknown): unknown;
  type(value: unknown): number;
  errno(value: unknown): number;
  free(value: unknown): void;
}
let calls: LaunchCalls | undefined;
function native(): LaunchCalls {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "launchd scopes require the Darwin 64-bit backend");
  calls ??= (() => {
    const library = load(null);
    return { dictionary: library.func("void *launch_data_alloc(int)"),
      array: library.func("void *launch_data_alloc(int)"),
      string: library.func("void *launch_data_new_string(const char *)"),
      boolean: library.func("void *launch_data_new_bool(bool)"),
      integer: library.func("void *launch_data_new_integer(long long)"),
      machport: library.func("void *launch_data_new_machport(unsigned int)"),
      insert: library.func("bool launch_data_dict_insert(void *, void *, const char *)"),
      append: library.func("bool launch_data_array_set_index(void *, size_t, void *)"),
      count: library.func("size_t launch_data_array_get_count(void *)"),
      message: library.func("void *launch_msg(void *)"), type: library.func("int launch_data_get_type(void *)"),
      errno: library.func("int launch_data_get_errno(void *)"), free: library.func("void launch_data_free(void *)") };
  })();
  return calls;
}
export interface LaunchdJobDefinition {
  readonly label: string;
  readonly command: CommandSpec;
  readonly sessionCreate: boolean;
  readonly keepAlive: boolean;
  readonly abandonProcessGroup: boolean;
  readonly machServices?: readonly string[];
}
function job(definition: LaunchdJobDefinition): unknown {
  if (!/^com\.oma\.execution\.[0-9a-f-]{36}$/.test(definition.label)) throw new TypeError("invalid launchd execution label");
  if (!definition.sessionCreate || definition.keepAlive || !definition.abandonProcessGroup || definition.command.timeoutMs !== null)
    throw new StoreError("UNSUPPORTED_PROFILE", "an execution requires one unthrottled launchd session and one completion");
  const api = native(), result = api.dictionary(1);
  if (result === null) throw new Error("launchd dictionary allocation failed");
  const owned = new Set<unknown>([result]);
  try {
    const put = (key: string, value: unknown): void => {
      owned.add(value);
      if (!api.insert(result, value, key)) throw new Error(`launchd field rejected: ${key}`);
    };
    put("Label", api.string(definition.label)); put("SessionCreate", api.boolean(true));
    put("KeepAlive", api.boolean(false)); put("AbandonProcessGroup", api.boolean(true));
    put("RunAtLoad", api.boolean(true)); put("Program", api.string(definition.command.executable));
    put("StandardInPath", api.string("/dev/null")); put("StandardOutPath", api.string("/dev/null")); put("StandardErrorPath", api.string("/dev/null"));
    const argv = api.array(2); owned.add(argv);
    definition.command.argv.forEach((value, index) => {
      const item = api.string(value); owned.add(item);
      if (!api.append(argv, index, item)) throw new Error("launchd argument rejected");
    });
    put("ProgramArguments", argv);
    const environment = api.dictionary(1); owned.add(environment);
    const environmentEntries: [string, string][] = Object.entries(definition.command.env)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string");
    for (const entry of environmentEntries) {
      const key = entry[0], value = entry[1];
      if (typeof value !== "string") continue;
      const item = api.string(value); owned.add(item);
      if (!api.insert(environment, item, key)) throw new Error("launchd environment rejected");
    }
    put("EnvironmentVariables", environment);
    if (definition.command.cwd !== undefined) put("WorkingDirectory", api.string(definition.command.cwd));
    if (definition.machServices !== undefined && definition.machServices.length > 0) {
      const services = api.dictionary(1); owned.add(services);
      for (const name of definition.machServices) if (!api.insert(services, api.dictionary(1), name)) throw new Error("launchd Mach service rejected");
      put("MachServices", services);
    }
    const request = api.dictionary(1); owned.add(request);
    if (!api.insert(request, result, "SubmitJob")) throw new Error("launchd submission assembly failed");
    const response = api.message(request);
    if (response === null) throw new Error("launchd submission was not answered");
    if (api.type(response) !== 9 /* LAUNCH_DATA_ERRNO */ || api.errno(response) !== 0) {
      api.free(response);
      throw Object.assign(new Error("launchd execution job was refused"), { code: "BROKER_UNAVAILABLE" });
    }
    api.free(response);
    return result;
  } finally { cleanupAll([...owned].map(value => () => api.free(value))); }
}
export function submitLaunchdJob(definition: LaunchdJobDefinition): void {
  job(definition);
}
export function removeLaunchdJob(label: string): void {
  const api = native(), request = api.dictionary(1);
  if (request === null) throw new Error("launchd removal allocation failed");
  const jobLabel = api.string(label);
  if (jobLabel === null || !api.insert(request, jobLabel, "RemoveJob")) {
    if (jobLabel !== null) api.free(jobLabel); api.free(request);
    throw new Error("launchd removal assembly failed");
  }
  const response = api.message(request); api.free(jobLabel); api.free(request);
  if (response === null) throw new Error("launchd removal returned no observation");
  try {
    if (api.type(response) !== 9 || api.errno(response) !== 0)
      throw Object.assign(new Error("launchd execution removal was not confirmed"), { code: "RUN_TERMINATION_UNKNOWN" });
  } finally { api.free(response); }
}
