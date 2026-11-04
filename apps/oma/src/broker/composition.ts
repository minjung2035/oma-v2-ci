import { listOwnedDirectory } from "@oma/storage/directory";
import { join } from "node:path";
import type { PublicDispatchPorts, InternalDispatchDataPorts } from "@oma/broker/ports";
// P18: explicit composition projections for broker dispatch boundaries.
// Factories keep concrete owners at the composition root while consumers see only
// the capabilities required by their dispatch path.
import type { ProtocolLimits } from "@oma/contracts";
import type { Store } from "@oma/storage";
import type { MailModule } from "@oma/mail";
import type { StatusRefresh } from "@oma/broker/status-refresh";
import type { ViewsModule } from "../views.js";
import type { LifecycleModule } from "@oma/lifecycle";
import type { GitModule } from "@oma/git";
import type { InternalDispatchDependencies, InternalMailPort, InternalPeerPort, InternalStorePort } from "@oma/broker/ports";
import type { PublicDispatchDependencies, PublicGitPort, PublicReviewPort, PublicLifecyclePort, PublicMailPort, PublicStorePort, PublicUnitsPort, PublicViewsPort } from "@oma/broker/ports";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";

import type { HostInvocations } from "../runtime/host-invocations.js";
export function createPublicDispatchPorts(
  store: Store,
  mail: MailModule,
  status: Pick<StatusRefresh, "request">,
  views: ViewsModule,
  lifecycle: LifecycleModule,
  git: GitModule | null,
  reviews: PublicReviewPort | null,
  limits: ProtocolLimits,
  invocations?: HostInvocations,
): PublicDispatchPorts {
  const publicStore: PublicStorePort = {
    // WP23.03: parameter checks need which names exist, not every decoded row.
    listAgents: () => store.agentNames().map((name) => ({ name })),
    getAgent: (actor) => {
      const agent = store.getAgent(actor);
      return agent === null
        ? null
        : {
            name: agent.name,
            incarnation: agent.incarnation,
            desired: agent.desired,
            specJson: agent.specJson,
          };
    },
    getReceipt: (actor, key) => {
      const operation = store.getOperation(actor, key);
      return operation === null ? null : receiptOfOperation(operation);
    },
    hasOperation: (actor, key) => store.getOperation(actor, key) !== null,
  };
  const publicMail: PublicMailPort = {
    send: async (auth, key, input, requestContext, stream) => {
      const linked = invocations?.guardMail(auth, key, input, requestContext) === true;
      const receipt = await mail.send(auth, key, input, requestContext, stream);
      if (linked) invocations!.recordMutation(auth, key, requestContext?.kind ?? "mail.send", receipt);
      return receipt;
    },
  };
  const publicUnits: PublicUnitsPort = {
    statusSnapshot: () => status.request(),
  };
  const publicViews: PublicViewsPort = {
    status: (agent, snapshot) => views.statusOf(snapshot, agent),
  };
  const publicLifecycle: PublicLifecyclePort = {
    creation: auth => lifecycle.creation(auth),
    setSociety: async (auth, state, key) => {
      const linked = invocations?.guardMutation(auth, key, "society.set", { state }) === true;
      const receipt = await lifecycle.setSociety(auth, state, key);
      if (linked) invocations!.recordMutation(auth, key, "society.set", receipt);
      return receipt;
    },
    create: async (auth, input, key, stream) => {
      const linked = invocations?.guardMutation(auth, key, "agent.create", input) === true;
      const receipt = await lifecycle.create(auth, input, key, stream, linked ? invocations!.createExpectation(auth, key) : undefined);
      if (linked) invocations!.recordMutation(auth, key, "agent.create", receipt);
      return receipt;
    },
    start: async (auth, agent, key) => {
      const linked = invocations?.guardMutation(auth, key, "agent.start", { agent }) === true;
      const receipt = await lifecycle.start(auth, agent, key);
      if (linked) invocations!.recordMutation(auth, key, "agent.start", receipt);
      return receipt;
    },
    stop: async (auth, agent, key) => {
      const linked = invocations?.guardMutation(auth, key, "agent.stop", { agent }) === true;
      const receipt = await lifecycle.stop(auth, agent, key);
      if (linked) invocations!.recordMutation(auth, key, "agent.stop", receipt);
      return receipt;
    },
    ack: (auth, message, key) => {
      const linked = invocations?.guardMutation(auth, key, "mail.ack", { message }) === true;
      const receipt = lifecycle.ack(auth, message, key);
      if (linked) invocations!.recordMutation(auth, key, "mail.ack", receipt);
      return receipt;
    },
    follow: (auth, topic, subscribe, key) => {
      const method = subscribe ? "route.follow" : "route.unfollow";
      const linked = invocations?.guardMutation(auth, key, method, { topic }) === true;
      const receipt = lifecycle.follow(auth, topic, subscribe, key);
      if (linked) invocations!.recordMutation(auth, key, method, receipt);
      return receipt;
    },
  };
  const publicGit: PublicGitPort | null =
    git === null
      ? null
      : {
          knownRefs: () => git.knownRefs(),
          isPublished: (oid) => git.isPublished(oid),
          hasSharedCommit: oid => git.hasSharedCommit(oid),
          submit: async (auth, key, input, bytes) => {
            const linked = invocations?.guardMutation(auth, key, "git.submit", input) === true;
            const receipt = await git.submit(auth, key, input, bytes);
            if (linked) invocations!.recordMutation(auth, key, "git.submit", receipt);
            return receipt;
          },
          integrate: async (auth, key, input) => {
            const linked = invocations?.guardMutation(auth, key, "git.integrate", input) === true;
            const receipt = await git.integrate(auth, key, input);
            if (linked) invocations!.recordMutation(auth, key, "git.integrate", receipt);
            return receipt;
          },
          publishContext: async (auth, key, input, bytes) => {
            const linked = invocations?.guardMutation(auth, key, "context.publish", input) === true;
            const receipt = await git.publishContext(auth, key, input, bytes);
            if (linked) invocations!.recordMutation(auth, key, "context.publish", receipt);
            return receipt;
          },
        };
  return {
    ...(invocations === undefined ? {} : { invocations }),
    store: publicStore,
    mail: publicMail,
    units: publicUnits,
    views: publicViews,
    lifecycle: publicLifecycle,
    git: publicGit,
    review: reviews === null ? null : {
      record: async (auth, key, input) => {
        const linked = invocations?.guardMutation(auth, key, "attest.record", input) === true;
        const receipt = await reviews.record(auth, key, input, linked ? invocations!.reviewExpectation(auth, key) : undefined);
        if (linked) invocations!.recordMutation(auth, key, "attest.record", receipt);
        return receipt;
      },
      status: (auth, query, frameBytes, responseId) => reviews.status(auth, query, frameBytes, responseId),
    },
    limits,
  };
}

export function createInternalDispatchDataPorts(
  store: Store,
  mail: MailModule,
  stateRoot: string,
  prepare?: InternalMailPort["prepare"],
): InternalDispatchDataPorts {
  const internalStore: InternalStorePort = {
    getAgentIdentity: (actor) => {
      const agent = store.getAgent(actor);
      return agent === null ? null : { incarnation: agent.incarnation };
    },
    pendingDeliveryCount: (agent) => store.pendingDeliveryCount(agent),
    getBatchAgent: (id) => store.getBatch(id)?.agent ?? null,
    preparedBatchIds: (agent) =>
      store.preparedBatches(agent).map((batch) => batch.id),
  };
  const internalMail: InternalMailPort = {
    prepare: (auth, deferred, responseId) => prepare ? prepare(auth, deferred, responseId) : mail.prepare(auth, deferred),
    complete: (auth, evidence) => mail.complete(auth, evidence),
    moveToCur: (agent, ids) => mail.moveToCur(agent, ids),
  };
  return {
    store: internalStore,
    mail: internalMail,

  };
}
