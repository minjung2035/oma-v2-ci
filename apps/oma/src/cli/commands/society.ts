import { keyOf, parseArguments } from "../arguments.js";
import { effect, randKey } from "../request-service.js";
import { usage } from "../exit.js";

export async function runSocietyCommand(args: string[]): Promise<never> {
  const parsed = parseArguments(args, { options: { "--request": "value" }, positional: { min: 1, max: 1 } });
  const action = parsed.positional[0];
  if (action !== "open" && action !== "close") return usage();
  const state = action === "open" ? "open" : "closed";
  return effect("society.set", keyOf(parsed) ?? randKey(),
    () => ({ method: "society.set", params: { state } }), () => ({ state }));
}
