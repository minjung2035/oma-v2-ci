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

export function createPublicDispatchPorts(
  store: Store,
  mail: MailModule,
  status: Pick<StatusRefresh, "request">,
  views: ViewsModule,
  lifecycle: LifecycleModule,
  git: GitModule | null,
  reviews: PublicReviewPort | null,
  limits: ProtocolLimits,
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
    send: (auth, key, input, requestContext) =>
      mail.send(auth, key, input, requestContext),
  };
  const publicUnits: PublicUnitsPort = {
    statusSnapshot: () => status.request(),
  };
  const publicViews: PublicViewsPort = {
    status: (agent, snapshot) => views.statusOf(snapshot, agent),
  };
  const publicLifecycle: PublicLifecyclePort = {
    setSociety: (auth, state, key) => lifecycle.setSociety(auth, state, key),
    create: (auth, input, key) => lifecycle.create(auth, input, key),
    start: (auth, agent, key) => lifecycle.start(auth, agent, key),
    stop: (auth, agent, key) => lifecycle.stop(auth, agent, key),
    ack: (auth, message, key) => lifecycle.ack(auth, message, key),
    follow: (auth, topic, subscribe, key) =>
      lifecycle.follow(auth, topic, subscribe, key),
  };
  const publicGit: PublicGitPort | null =
    git === null
      ? null
      : {
          knownRefs: () => git.knownRefs(),
          isPublished: (oid) => git.isPublished(oid),
          submit: (auth, key, input, bytes) =>
            git.submit(auth, key, input, bytes),
          integrate: (auth, key, input) => git.integrate(auth, key, input),
          publishContext: (auth, key, input, bytes) =>
            git.publishContext(auth, key, input, bytes),
        };
  return {
    store: publicStore,
    mail: publicMail,
    units: publicUnits,
    views: publicViews,
    lifecycle: publicLifecycle,
    git: publicGit,
    review: reviews === null ? null : {
      record: (auth, key, input) => reviews.record(auth, key, input),
      status: (auth, name, frameBytes, responseId) => reviews.status(auth, name, frameBytes, responseId),
    },
    limits,
  };
}

export function createInternalDispatchDataPorts(
  store: Store,
  mail: MailModule,
  stateRoot: string,
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
    prepare: (auth) => mail.prepare(auth),
    complete: (auth, evidence) => mail.complete(auth, evidence),
    moveToCur: (agent, ids) => mail.moveToCur(agent, ids),
  };
  return {
    store: internalStore,
    mail: internalMail,

  };
}
