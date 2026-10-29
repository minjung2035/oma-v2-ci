/** Principal-only safety control and explicit GOAL publication. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isValidFullOid } from "@oma/domain/identifiers";
import { REQUEST_PARAMETER_HELP, refused, requestKeyOf, textResult, registerTypedTool, stringEnum } from "@oma/tool-runtime/shared";
import type { Client } from "@oma/client";

const request = Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP }));
export function registerPrincipalTools(pi: ExtensionAPI, client: Client): void {
  registerTypedTool(pi, {
    name: "oma_society", label: "Open or close Worker execution",
    description: "Close Worker execution after project completion or when execution must stop; reopen it to permit work again. Closing preserves mail, sessions and per-agent stop state. Only a succeeded close receipt confirms Workers have ended; it does not prove the project is complete. Opening does not release Workers stopped by the Principal.",
    parameters: Type.Object({
      action: { ...stringEnum(["open", "close"]), description: "open permits Worker execution; close ends it while preserving durable state." }, request,
    }),
    async execute(id, params, signal, _update, context) {
      const key = requestKeyOf(params.request, { id, tool: "oma_society", params, context });
      const payload = { state: params.action === "open" ? "open" : "closed" };
      return textResult(await client.effect("society.set", key, () => ({ method: "society.set", params: payload }), () => payload, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_goal_publish", label: "Publish the shared GOAL",
    description: "Publish an inline GOAL.md and notify Workers atomically, preserving other context files from expectedRevision. Supply the complete goal body, notice subject and expected context revision. null asserts no existing context; a mismatch refuses publication rather than overwriting concurrent updates. Ordinary mail does not publish the shared goal.",
    parameters: Type.Object({
      body: Type.String({ minLength: 1, pattern: "\\S", description: "Complete new GOAL.md text: objective, constraints, priorities and observable completion criteria." }),
      subject: Type.String({ minLength: 1, maxLength: 998, description: "Subject of the shared-goal publication notice." }),
      expectedRevision: Type.Union([Type.String(), Type.Null()], { description: "Full current context commit OID to compare before publication; null only when no context is expected." }), request,
    }),
    async execute(id, params, signal, _update, context) {
      if (params.expectedRevision !== null && !isValidFullOid(params.expectedRevision)) refused("expected revision", params.expectedRevision);
      const key = requestKeyOf(params.request, { id, tool: "oma_goal_publish", params, context });
      return textResult(await client.publishGoal(params.body, params.expectedRevision, params.subject, key, signal), { request: key });
    },
  });
}
