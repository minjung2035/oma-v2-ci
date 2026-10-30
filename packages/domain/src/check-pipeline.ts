/** Versioned pipeline grammar. Legacy checks retain independent sandboxes. */
import { checkArray, checkInt, checkObject, checkOptional, checkString, type Check } from "./validation.js";
import { isValidWirePath } from "./identifiers.js";
const command: Check = value => typeof value === "string" && !value.includes("\0") ? null : "invalid command argument";
export const pipelineEnvironmentCheck: Check = value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid environment";
  return Object.entries(value).some(([key, v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || command(v) !== null) ? "invalid environment entry" : null;
};
const path: Check = value => value === "." || isValidWirePath(value) ? null : "pipeline cwd must be a relative workspace path";
const step = checkObject({ id: checkString({ min: 1 }), argv: checkArray(command, { min: 1 }), cwd: path,
  env: pipelineEnvironmentCheck, deadlineMs: checkOptional(checkInt({ min: 1 })) });
const cache: Check = value => value && typeof value === "object" && (value as { kind?: unknown }).kind === "off"
  ? checkObject({ kind: (v: unknown) => v === "off" ? null : "invalid cache policy" })(value)
  : checkObject({ kind: (v: unknown) => v === "npm-downloads" ? null : "unsupported cache policy",
    trustScope: checkString({ min: 1 }), lockfile: (v: unknown) => isValidWirePath(v) ? null : "invalid lockfile path" })(value);
const shape = checkObject({ version: (v: unknown) => v === 2 ? null : "unsupported pipeline version",
  setupSteps: checkArray(step), checkSteps: checkArray(step, { min: 1 }), env: pipelineEnvironmentCheck,
  toolchainDigest: checkString({ re: /^[a-f0-9]{64}$/ }), cachePolicy: cache });
export const checkPipelineCheck: Check = value => {
  const problem = shape(value); if (problem) return problem;
  const pipeline = value as import("@oma/contracts/integration").CheckPipeline;
  const steps = [...pipeline.setupSteps, ...pipeline.checkSteps];
  if (new Set(steps.map(step => step.id)).size !== steps.length || steps.some(step => !step.argv[0])) return "pipeline step identities must be unique and executables nonempty";
  return null;
};
export function frozenPipeline(value: import("@oma/contracts/integration").CheckPipeline) {
  const freeze = <T>(v: T): T => { if (v && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; };
  return freeze(JSON.parse(JSON.stringify(value)) as import("@oma/contracts/integration").CheckPipeline);
}
