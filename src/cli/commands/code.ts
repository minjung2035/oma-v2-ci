import { readCode, type CodeView } from "../effects/code.js";
import { parseArguments } from "../arguments.js";
import { fail, finishRead } from "../exit.js";

export async function runCodeCommand(args: string[]): Promise<never> {
  const parsed = parseArguments(args, { options: { "--revision": "value", "--base": "value", "--path": "value", "--pattern": "value" },
    positional: { min: 1, max: 1 } });
  const repository = process.env.OMA_PROJECT_GIT;
  if (!repository) fail("no canonical code repository was provided", 2);
  const optional = (name: string) => parsed.value(name) ?? undefined;
  const base = optional("--base"), path = optional("--path"), pattern = optional("--pattern");
  const result = readCode(repository, { action: parsed.positional[0] as CodeView["action"], revision: parsed.value("--revision") ?? "main",
    ...(base === undefined ? {} : { base }), ...(path === undefined ? {} : { path }), ...(pattern === undefined ? {} : { pattern }) });
  return finishRead(result);
}
