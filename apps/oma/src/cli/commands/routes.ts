import { isValidTopicName } from "@oma/domain/identifiers";
import { keyOf, parseArguments } from "../arguments.js";
import { fail } from "../exit.js";
import { effect, randKey } from "../request-service.js";

const ROUTE = { options: { "--request": "value" }, positional: { min: 1, max: 1 } } as const;

export function runRouteCommand(args: string[], subscribe: boolean): Promise<never> {
  if (args.length === 0) fail("invalid topic", 2);
  const parsed = parseArguments(args, ROUTE);
  const topic = parsed.positional[0]!;
  if (!isValidTopicName(topic)) fail("invalid topic", 2);
  const key = keyOf(parsed) ?? randKey();
  const method = subscribe ? "route.follow" : "route.unfollow";
  return effect(
    method,
    key,
    () => ({ method, params: { topic } }),
    () => ({ topic }),
  );
}
