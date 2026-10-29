import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Client } from "@oma/client";
import { Type } from "typebox";
import { isValidActorName, isValidFullOid, isValidTopicName, isValidRequestKey } from "@oma/domain/identifiers";
import { isLogicalAddress } from "@oma/domain/mail-values";
import { logicalFromDisplay } from "@oma/domain/display-address";
import { REQUEST_PARAMETER_HELP, actorNameOf, refused, registerTypedTool, requestKeyOf, stringEnum, textResult } from "@oma/tool-runtime/shared";

const request = Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP }));
const text = Type.String({ minLength: 1, pattern: "\\S" });
const expectedRevision = Type.Union([Type.String(), Type.Null()], {
  description: "Full expected context commit OID; null asserts that no context has been published. A mismatch refuses publication.",
});

export function registerAgentTools(pi: ExtensionAPI, client: Client, principal: boolean, society: string | undefined): void {
  registerTypedTool(pi, {
    name: "oma_agent_control", label: "Start or stop an agent",
    description: principal ? "Emergency-stop a Worker or release a stop imposed by the Principal. Supply action and name. This is a safety control, not routine task scheduling; starting does not itself prove the Worker is running."
      : "Start or stop yourself or a descendant you are authorized to manage. Supply action and name. This cannot control unrelated peers or release a Principal stop; starting does not itself prove the Worker is running.",
    parameters: Type.Object({
      action: { ...stringEnum(["start", "stop"]), description: "Requested execution state: start or stop." },
      name: { ...text, description: "Existing Worker name or its displayed address in this project." }, request,
    }),
    async execute(id, params, signal, _update, context) {
      const name = actorNameOf(params.name, society, "agent name");
      const key = requestKeyOf(params.request, { id, tool: "oma_agent_control", params, context });
      return textResult(await client.controlAgent(params.action, name, key, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_operation_status", label: "Observe your original operation",
    description: "Look up your original operation by request key without resubmitting it. Use after an interrupted call or an accepted/unknown receipt. Preserve that key and its frozen inputs: if replay is needed, repeat the original tool call with the same key, never a fresh key to bypass uncertainty.",
    parameters: Type.Object({ key: { ...text, description: "Original request key returned by the mutation, or the explicit key supplied to it." } }),
    async execute(_id, params, signal) {
      if (!isValidRequestKey(params.key)) refused("request key", params.key);
      return textResult(await client.queryText("operation.get", { key: params.key }, signal), { request: params.key });
    },
  });
  if (principal) return;
  registerTypedTool(pi, {
    name: "oma_agent_create", label: "Create a Worker with an inline brief",
    description: "Create a Worker with its own workspace at a canonical commit and an inline task brief. Requires agent.create capability and a delegable child profile. maxWorkers limits currently activated Workers (enabled resident identities), including idle or mail-waiting Workers; the Principal occupies no slot. oma_status.creation reports maxWorkers and workerCount, the current active count. Stopped and retired history does not consume slots; slot reuse requires confirmed execution termination. Provisioning does not consume a slot. Fresh creation or stopped-Worker start at full capacity fails with LIMIT_EXCEEDED before acceptance. If an already accepted creation loses a slot to another activation, it stays pending and existing recovery completes it after release. Prefer an available, suitable peer when it avoids duplicate context and startup cost. The receipt is not task completion or proof of execution.",
    promptSnippet: "Create an autonomous Worker with name, from and a self-contained brief defining scope, interfaces and completion evidence.",
    parameters: Type.Object({
      name: { ...text, description: "New unique Worker name, not an email address." },
      from: { ...text, description: "Canonical project commit or local revision resolving to it; the Worker starts from this committed state." },
      brief: { ...text, description: "Inline assignment: objective, scope and ownership, required context, interface contracts, completion criteria and evidence to return. Give enough context for autonomous implementation, testing, research or coordination; this is not a command or a brief-file path." },
      request,
    }),
    async execute(id, params, signal, _update, context) {
      if (!isValidActorName(params.name)) refused("new Worker name", params.name);
      const key = requestKeyOf(params.request, { id, tool: "oma_agent_create", params, context });
      return textResult(await client.createAgent(params, key, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_agent_continue", label: "Schedule your continuation",
    description: "Send yourself a durable continuation note for a later delivery. Record the next action and context needed to resume. This is not polling, a timer, or a way to start another Worker.",
    parameters: Type.Object({ note: { ...text, description: "Inline continuation context, remaining work and next concrete action." }, request }),
    async execute(id, params, signal, _update, context) {
      const key = requestKeyOf(params.request, { id, tool: "oma_agent_continue", params, context });
      return textResult(await client.continueAgent(params.note, key, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_agent_wait", label: "Yield this run",
    description: "Yield the current live run after this tool batch is safely recorded. Use when no useful independent work remains and progress needs new mail. This is not blocking receive, polling, mail acknowledgment or task completion; it does not mark pending deliveries handled.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      await client.query("agent.wait", {}, signal);
      return textResult("Yield requested; this run ends at the next safe tool boundary.");
    },
  });
  registerTypedTool(pi, {
    name: "oma_status", label: "Read project and Worker state",
    description: "Read the Worker roster or one named agent, including observed creation capability and child-profile information. For roster pages, pass next as after until null. Pending counts describe deliveries, not unfinished tasks or completion; state observations do not grant authority.",
    parameters: Type.Object({
      agent: Type.Optional({ ...text, description: "Existing agent name or displayed address; omit to list the roster." }),
      after: Type.Optional({ ...text, description: "Roster cursor from the previous page's next field; omit on the first page." }),
    }),
    async execute(_id, params, signal) {
      return textResult(await client.queryText("status.get", {
        ...(params.agent === undefined ? {} : { agent: actorNameOf(params.agent, society, "agent") }),
        ...(params.after === undefined ? {} : { after: actorNameOf(params.after, society, "roster cursor") }),
      }, signal));
    },
  });
  registerTypedTool(pi, {
    name: "oma_logs", label: "Read recent Worker logs",
    description: "Read an agent's recent logs over a bounded lookback interval. Supply agent and sinceSeconds. The result reports truncation; a partial log is not evidence that omitted events never occurred.",
    parameters: Type.Object({
      agent: { ...text, description: "Existing agent name or displayed address whose logs to read." },
      sinceSeconds: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "Positive lookback interval in seconds." }),
    }),
    async execute(_id, params, signal) {
      return textResult(await client.queryText("logs.read", { agent: actorNameOf(params.agent, society, "agent"), sinceSeconds: params.sinceSeconds }, signal));
    },
  });
  registerTypedTool(pi, {
    name: "oma_topic_subscription", label: "Follow or unfollow a topic",
    description: "Follow or unfollow a topic for durable mail routing. Supply the topic name and action. This changes your subscription, not another Worker's subscription.",
    parameters: Type.Object({
      action: { ...stringEnum(["follow", "unfollow"]), description: "follow subscribes you; unfollow removes your subscription." },
      topic: { ...text, description: "Topic name, without the topic/ address prefix." }, request,
    }),
    async execute(id, params, signal, _update, context) {
      if (!isValidTopicName(params.topic)) refused("topic", params.topic);
      const key = requestKeyOf(params.request, { id, tool: "oma_topic_subscription", params, context });
      return textResult(await client.subscribe(params.action, params.topic, key, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_context_publish", label: "Publish a context directory",
    description: "Publish the context files from a local directory using an expected-revision check. Requires context.publish capability and a GOAL.md in the directory. This publishes actual file contents, not a reference to the directory; null asserts no existing context and never allows unconditional overwrite.",
    parameters: Type.Object({
      directory: { ...text, description: "Local directory containing the context snapshot to publish, including GOAL.md." },
      expectedRevision, request,
    }),
    async execute(id, params, signal, _update, context) {
      if (params.expectedRevision !== null && !isValidFullOid(params.expectedRevision)) refused("expected revision", params.expectedRevision);
      const key = requestKeyOf(params.request, { id, tool: "oma_context_publish", params, context });
      return textResult(await client.publishContext(params.directory, params.expectedRevision, key, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_candidate_publish", label: "Share a committed candidate",
    description: "Publish an exact committed candidate and send a sharing notice, to commons by default. Use for standalone sharing; oma_merge_open publishes its candidate automatically. Uncommitted edits are excluded. paths only summarizes the change and does not restrict the published tree. Publication is not merge application or a review vote.",
    parameters: Type.Object({
      candidate: { ...text, description: "Commit OID or local revision resolving to the exact candidate to publish." },
      subject: Type.String({ maxLength: 998, description: "Subject of the candidate-sharing notice." }),
      body: Type.String({ description: "Inline summary, intended use and reusable evidence for recipients." }),
      to: Type.Optional(Type.Array({ ...text, description: "Logical recipient or displayed address." }, { minItems: 1, description: "Notice recipients; defaults to commons." })),
      paths: Type.Optional(Type.Array(Type.String(), { description: "Optional changed-path summary metadata; never a publication filter." })), request,
    }),
    async execute(id, params, signal, _update, context) {
      const to = params.to?.map(value => {
        const address = logicalFromDisplay(value, society) ?? value;
        return isLogicalAddress(address) ? address : refused("address", value);
      });
      const key = requestKeyOf(params.request, { id, tool: "oma_candidate_publish", params, context });
      return textResult(await client.publishCandidate({ ...params, ...(to === undefined ? {} : { to }) }, key, signal), { request: key });
    },
  });
}
