/** Public adapter entry; native registration owns no workload authority. */
import { darwinSetupProcess } from "@oma/process/darwin-execution";
export { darwinSetupProcess } from "@oma/process/darwin-execution";
import { submitLaunchdJob as submit, startLaunchdJob as start, type LaunchdJobDefinition, type LaunchdJobRegistration } from "@oma/native/darwin-launchd-job";
export { renderLaunchdJob, type LaunchdJobDefinition, type LaunchdJobRegistration } from "@oma/native/darwin-launchd-job";
export function submitLaunchdJob(definition: LaunchdJobDefinition, budgetMs: number): LaunchdJobRegistration { return submit(definition, budgetMs, darwinSetupProcess); }
export function startLaunchdJob(registration: LaunchdJobRegistration, budgetMs: number) { return start(registration, budgetMs, darwinSetupProcess); }
