// Test-runner parameters, never host configuration or production resource defaults.
export const EXPLORATION_PARAMETERS = Object.freeze({
  "--seed": { env: "OMA_TEST_SEED", min: 0, max: 0xffffffff },
  "--actions": { env: "OMA_TEST_ACTIONS", min: 1, max: 10000 },
  "--fuzz-cases": { env: "OMA_TEST_FUZZ_CASES", min: 1, max: 100000 },
  "--stress-cycles": { env: "OMA_TEST_STRESS_CYCLES", min: 1, max: 100000 },
  "--stress-seconds": { env: "OMA_TEST_STRESS_SECONDS", min: 1, max: 3600 },
  "--rss-bytes": { env: "OMA_TEST_RSS_BYTES", min: 1, max: Number.MAX_SAFE_INTEGER },
  "--command-timeout-ms": { env: "OMA_TEST_COMMAND_TIMEOUT_MS", min: 1, max: 10000 },
});
export function extractExplorationParameters(args) {
  const remaining = [], env = {}, parameters = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index], definition = EXPLORATION_PARAMETERS[flag];
    if (!definition) { remaining.push(flag); continue; }
    if (Object.hasOwn(parameters, flag)) throw new Error(`duplicate exploration parameter ${flag}`);
    const text = args[++index];
    const value = typeof text === "string" && /^(?:0|[1-9]\d*)$/.test(text) ? Number(text) : NaN;
    if (!Number.isSafeInteger(value) || value < definition.min || value > definition.max) throw new Error(`invalid exploration parameter ${flag}`);
    env[definition.env] = String(value); parameters[flag] = value;
  }
  return { remaining, env, parameters };
}
