import { isValidTopicName } from "../../ids.js";
import { keyOf } from "../arguments.js";
import { fail } from "../exit.js";
import { effect, randKey } from "../request-service.js";

export function runRouteCommand(args: string[], subscribe: boolean): Promise<never> {
  const topic = args[0];
  if (!topic || !isValidTopicName(topic)) fail("invalid topic", 2);
  const key = keyOf(args) ?? randKey();
  const method = subscribe ? "route.follow" : "route.unfollow";
  return effect(
    method,
    key,
    () => ({ method, params: { topic } }),
    () => ({ topic }),
  );
}
