/** Actor-only receipt observations. This projection never sends, checkpoints
 * linkage, settles an operation, acknowledges delivery or grants authority. */
import { dirname, join } from "node:path";
import type { AuthContext } from "@oma/contracts/runtime";
import type { Store } from "@oma/storage";
import { assertActorIdentity } from "@oma/domain/authority";
import { ownedMessages } from "@oma/domain/durable";
import { collaborationRecordRootPathAt } from "@oma/domain/paths";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { sha256Hex } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { publishNoReplace, replaceDerivedFile } from "@oma/storage/durable-fs";
import { observeImmutableFile } from "@oma/storage/immutable-file";
import { receiptFactConflict } from "@oma/protocol/receipt-codec";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { decodeSubmissionPublication } from "@oma/protocol/invocation-submission";
import { invocationRejectionGuidance } from "@oma/protocol/invocation-rejection";
import type { InvocationRecordObservation } from "../runtime/host-invocations.js";
import { recordCell } from "./collaboration-mail.js";

interface PreviousObservation { readonly signature: string; readonly observedAt: string }
export class CollaborationReceiptViews {
  private readonly previous = new Map<string, ReadonlyMap<string, PreviousObservation>>();
  private readonly pageBytes: number;
  constructor(private readonly store: Store, private readonly stateRoot: string, frameBytes = 64 * 1024) {
    if (!Number.isSafeInteger(frameBytes) || frameBytes < 1) throw new RangeError("invalid receipt page budget");
    this.pageBytes = Math.min(frameBytes, 64 * 1024);
  }

  publish(auth: AuthContext, observations: Iterable<InvocationRecordObservation>, permittedReviews: ReadonlySet<string>, publishedMail: (id: string) => boolean, observedAt: string): number {
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "invocation receipt records cannot publish in T");
    const actor = assertActorIdentity(this.store, auth), root = collaborationRecordRootPathAt(this.stateRoot, actor.name);
    const display = actor.role === "resident" ? RESIDENT_PATHS.records : root;
    const previous = this.previous.get(actor.name), next = new Map<string, PreviousObservation>();
    const buckets = new Map<string, string[]>(), seen = new Set<string>();
    for (const observation of observations) {
      if (observation.actor !== actor.name || !/^inv1-[a-f0-9]{64}$/.test(observation.key) || seen.has(observation.key))
        throw new StoreError("BROKER_UNAVAILABLE", "receipt observation belongs to another actor or repeats an invocation");
      seen.add(observation.key);
      const operation = this.store.getOperation(actor.name, observation.key);
      if (operation !== null && (operation.kind !== observation.method || observation.receipt === null ||
          receiptFactConflict(observation.receipt, receiptOfOperation(operation)) || observation.resolution !== undefined || observation.rejection !== undefined))
        throw new StoreError("STORE_CORRUPT", "receipt projection contradicts the original operation");
      if (operation === null && observation.receipt !== null)
        throw new StoreError("STORE_CORRUPT", "accepted receipt lost its original operation");
      let sourcePublication = null;
      if (observation.publication !== undefined) {
        const decoded = decodeSubmissionPublication(observation.publication, observation.key);
        if (!decoded.ok || actor.role !== "resident" || observation.method !== "attest.record")
          throw new StoreError("STORE_CORRUPT", "publication observation has no permitted Worker submission scope");
        const child = this.store.getOperation(actor.name, decoded.value.key);
        if (child !== null && (child.kind !== "git.submit" || decoded.value.receipt === null ||
            receiptFactConflict(decoded.value.receipt, receiptOfOperation(child))) || child === null && decoded.value.receipt !== null)
          throw new StoreError("STORE_CORRUPT", "source publication observation differs from its canonical child operation");
        sourcePublication = { ...decoded.value,
          candidate: child?.kind === "git.submit" ? child.plan.candidate : null,
          publishedRef: child?.kind === "git.submit" ? child.plan.publishedRef : null,
          source: "original publication receipt; not a fresh ref observation and not acceptance of the review request" };
      }
      const messages = operation === null ? [] : ownedMessages(operation.plan);
      const rows = operation === null ? [] : this.store.deliveriesForOperation(operation.id);
      const expected = new Set(messages.flatMap(message => message.recipients.map(recipient => `${message.id}/${recipient}`)));
      if (rows.length !== expected.size || rows.some(row => row.operationId !== operation?.id || !expected.delete(`${row.messageId}/${row.recipient}`)) || expected.size !== 0)
        throw new StoreError("STORE_CORRUPT", "receipt delivery observations differ from the accepted recipient snapshot");
      // Principal receipts cannot become a Worker roster or workers-only thread
      // index. Its full broker receipt still retains the original public counts.
      const visibleMessages = messages.filter(message => actor.role !== "principal" || message.audience !== "workers" && message.recipients.includes(actor.name));
      const visibleIds = new Set(visibleMessages.map(message => message.id));
      const delivery = rows.filter(row => visibleIds.has(row.messageId) && (actor.role !== "principal" || row.recipient === actor.name))
        .map(row => ({ message: row.messageId, recipient: row.recipient, materialized: row.materialized === 1,
          presented: row.presented === 1, historicalAcknowledged: row.acknowledged === 1,
          materializedAtMs: row.materializedAtMs, presentedAtMs: row.presentedAtMs, acknowledgedAtMs: row.acknowledgedAtMs }))
        .sort((a, b) => a.message < b.message ? -1 : a.message > b.message ? 1 : a.recipient < b.recipient ? -1 : a.recipient > b.recipient ? 1 : 0);
      const request = operation?.kind !== "attest.record" ? null : operation.plan.fact.kind === "merge.open" || operation.plan.fact.kind === "challenge.open"
        ? operation.id : operation.plan.fact.request;
      const review = request !== null && permittedReviews.has(request) ? join(display, "reviews", request, "status.md") : null;
      const paths = visibleMessages.filter(message => publishedMail(message.id)).map(message => join(display, "mail", "messages", `${message.id}.md`));
      if (review !== null) paths.push(review);
      const disposition = observation.rejection !== undefined ? "refused" : observation.resolution !== undefined ? "existing" : observation.receipt === null ? "new" : "replayed";
      const acceptance = observation.resolution !== undefined || observation.rejection !== undefined ? "not-submitted" : observation.receipt === null ? "unknown" : "accepted";
      const execution = observation.resolution !== undefined || observation.rejection !== undefined ? "not-applicable" : observation.receipt?.state ?? "unknown";
      let creation = null;
      if (operation?.kind === "agent.create") {
        if (actor.role !== "resident") throw new StoreError("STORE_CORRUPT", "selected create observations belong to Workers");
        const original = operation.plan.existingCreation === null ? operation : this.store.getOperationById(operation.plan.existingCreation);
        if (original?.kind !== "agent.create" || original.plan.initialMessage === null || original.plan.specHash !== operation.plan.specHash)
          throw new StoreError("STORE_CORRUPT", "creation observation lost its original physical plan");
        const child = this.store.getAgent(operation.plan.spec.name), brief = original.plan.initialMessage;
        if (!child || child.specHash !== operation.plan.specHash) throw new StoreError("STORE_CORRUPT", "creation observation lost its exact child identity");
        const briefDelivery = this.store.getDelivery(brief.id, child.name), source = original.plan.source?.publication;
        if (!briefDelivery || briefDelivery.operationId !== original.id)
          throw new StoreError("STORE_CORRUPT", "creation observation lost its original brief delivery");
        creation = { actor: child.name, from: original.plan.spec.from, specHash: original.plan.specHash, originalCreation: original.id,
          sourcePublication: source === undefined ? { phase: "canonical source observed before acceptance; no fresh Git observation" } : {
            commit: source.commit, objectFormat: source.objectFormat, originalPublisher: original.actor, publishedRef: source.publishedRef,
            dependency: source.local?.dependency ?? null, phase: briefDelivery.materialized === 1 || original.state === "succeeded" ?
              "publication required before observed provisioning/delivery; not a fresh ref observation" : "accepted source dependency; physical publication not observed here" },
          registry: { desired: child.desired, incarnation: child.incarnation },
          execution: { state: "not observed by this receipt projection", records: join(display, "peers", "index.md") },
          initialBrief: { message: brief.id, emlSha256: brief.sha256, emlBytes: brief.bytes,
            materialized: briefDelivery.materialized === 1, materializedAtMs: briefDelivery.materializedAtMs,
            presented: briefDelivery.presented === 1, presentedAtMs: briefDelivery.presentedAtMs },
          source: "original accepted create/spec/brief and separately observed registry/delivery facts; not execution authority" };
        paths.push(join(display, "peers", "index.md"));
        if (publishedMail(brief.id)) paths.push(join(display, "mail", "messages", `${brief.id}.md`));
      }
      const evidence = { version: "collaboration-v1", invocation: { actor: observation.actor, societyBirth: observation.societyBirth,
        key: observation.key, tool: observation.tool, method: observation.method, session: observation.session,
        branch: observation.branch, toolCall: observation.toolCall }, linkagePhase: observation.phase,
        disposition, acceptance, execution, operation: observation.receipt?.operation ?? null,
        receipt: observation.receipt, existing: observation.resolution ?? null, rejection: observation.rejection ?? null, delivery,
        publication: sourcePublication, creation,
        deliveryScope: actor.role === "principal" ? "only this Principal's own permitted deliveries; other recipient identities withheld" : "accepted operation recipient snapshots",
        attachments: operation?.kind === "git.submit" ? [{ candidate: operation.plan.candidate, publishedRef: operation.plan.publishedRef,
          publicationObservation: operation.state, source: "original git.submit receipt; no fresh ref observation" }] :
          operation?.kind === "mail.send" && operation.plan.attachments !== undefined ? operation.plan.attachments.sources.map(source => ({
            candidate: source.commit, objectFormat: source.objectFormat, publishedRef: source.publishedRef, sourcePublication: source.publication,
            sourcePublicationOrdinal: source.publicationOrdinal ?? null,
            ...(source.reachableFrom === undefined ? {} : { reachableFrom: source.reachableFrom }),
            observedAtMs: operation.plan.attachments!.observedAtMs,
            publicationObservation: source.publication === null ? "canonical-main reachability observed before mail acceptance; no prior accepted publication is asserted" : source.local === undefined ? "shared reference verified before mail acceptance" :
              "accepted exact publication dependency; publication is required before delivery, not freshly observed here",
            source: source.local === undefined ? "accepted shared attachment manifest; no fresh ref observation and no new submitter provenance" :
              "accepted private bundle closure and original publisher; no fresh ref observation or separate submit notification" })) : [],
        review, records: paths };
      const bytes = JSON.stringify(evidence, null, 2) + "\n", signature = sha256Hex(bytes);
      const old = previous?.get(observation.key), time = old?.signature === signature ? old.observedAt : observedAt;
      const exact = join("receipts", "observations", `${signature}.json`);
      this.immutable(join(root, exact), bytes);
      const text = ["# Original invocation observation", `Invocation: ${observation.key}`, `Tool: ${recordCell(observation.tool)}`,
        `Disposition: ${disposition}`, `Original operation: ${observation.receipt?.operation ?? "none observed"}`,
        `Acceptance: ${acceptance}`, `Execution: ${execution}`, `Observed at: ${time}`,
        `Linkage phase: ${observation.phase}`, `Exact observation: ${join(display, exact)}`,
        "Attachments and delivery: see the exact observation; materialized/presented are not proof that a Human or model read the message.",
        `Source publication: ${observation.publication === undefined ? "no separate child in this observation" : `${observation.publication.key}; ${observation.publication.receipt?.state ?? "acceptance unknown"}`}. This never establishes review acceptance.`,
        ...(creation === null ? [] : [`Created Worker: ${creation.actor}; frozen starting commit: ${creation.from}; original physical creation: ${creation.originalCreation}`,
          `Current desired/incarnation observation: ${creation.registry.desired}/${creation.registry.incarnation}. This is not execution or task-completion proof.`,
          `Initial brief: ${creation.initialBrief.message}; materialized: ${creation.initialBrief.materialized}; presented: ${creation.initialBrief.presented}. No read or ACK is inferred.`,
          `Source/provisioning facts: see the exact observation. Execution observations are separately timed in ${creation.execution.records}.`]),
        `Review: ${review ?? "no currently permitted status link observed"}`,
        "Operation success is limited to that operation: accepting a proposal or vote does not prove main was updated.",
        observation.rejection !== undefined ? `Next: ${invocationRejectionGuidance(observation.rejection.reason)}` : observation.resolution !== undefined
          ? "Next: no new operation, revision or attempt was submitted. The existing receipt belongs to the explicitly referenced request, not this invocation."
          : observation.receipt === null
            ? observation.publication?.receipt?.state === "succeeded"
              ? "Next: publication succeeded; no review acceptance is established here. Continuation requires an authorized activation with the original frozen invocation. Do not substitute HEAD, delete the published source or use a new key."
              : "Next: acceptance is unknown here. Preserve the original invocation; do not escape through another key, wording, proposal or Worker name."
            : observation.receipt.state === "pending" || observation.receipt.state === "unknown"
              ? "Next: observe the original operation and allow its existing owner to recover; do not submit a replacement invocation."
              : "Next: retain the original receipt. Inspect current permitted records before making a distinct later decision.",
        "Disposition describes this receipt observation, not a new execution. A missing operation is not a proved rejection.",
        "Reading this file neither refreshes it nor acknowledges mail, authorizes a retry, or settles an effect.", ""].join("\n");
      this.derived(join(root, "receipts", `${observation.key}.md`), this.bounded(text));
      next.set(observation.key, { signature, observedAt: time });
      const bucket = observation.key.slice(5, 7), items = buckets.get(bucket) ?? [];
      items.push(`- ${observation.key} | ${acceptance} | ${execution} | ${join(display, "receipts", `${observation.key}.md`)}`);
      buckets.set(bucket, items);
    }
    const links: string[] = [];
    for (const [bucket, rows] of [...buckets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      rows.sort();
      links.push(`- ${bucket}: ${this.pages(root, display, rows)}`);
    }
    const first = links.length === 0 ? null : this.pages(root, display, links);
    this.derived(join(root, "receipts", "index.md"), this.bounded(["# Your invocation receipts", `Observed at: ${observedAt}`,
      `Invocations: ${seen.size}`, "Coverage: this actor's protected collaboration invocation bindings and independently observed original operations.",
      "Legacy unlinked operations are not claimed to be absent. This is not a transaction snapshot across all invocations.",
      `Records: ${first ?? "none observed in this coverage"}`, "No read, ACK, execution, authority grant or receipt settlement is performed by this projection.", ""].join("\n")));
    this.previous.set(actor.name, next);
    return seen.size;
  }

  private bounded(text: string): string {
    if (Buffer.byteLength(text) > this.pageBytes) throw new StoreError("LIMIT_EXCEEDED", "receipt presentation exceeds its page budget; no truncation");
    return text;
  }
  private derived(path: string, text: string): void {
    ensureOwnedDirectory(dirname(path), this.stateRoot);
    const known = observeImmutableFile(path, sha256Hex(text), Buffer.byteLength(text));
    if (known.kind === "unavailable") throw new StoreError("BROKER_UNAVAILABLE", "receipt observation file is unavailable");
    if (known.kind !== "present") replaceDerivedFile(path, text, 0o444);
  }
  private immutable(path: string, text: string): void {
    ensureOwnedDirectory(dirname(path), this.stateRoot);
    const existing = observeImmutableFile(path, sha256Hex(text), Buffer.byteLength(text));
    if (existing.kind === "present") return;
    if (existing.kind !== "absent") throw new StoreError("BROKER_UNAVAILABLE", "immutable receipt observation is unavailable or conflicts with canonical evidence");
    if (publishNoReplace(path, text, 0o444) === "existing" && observeImmutableFile(path, sha256Hex(text), Buffer.byteLength(text)).kind !== "present")
      throw new StoreError("BROKER_UNAVAILABLE", "immutable receipt observation conflicts with canonical evidence");
  }
  /** Key-prefix buckets limit repacking to the changed invocation partition.
   * Page size is a presentation bound, never a retention limit. */
  private pages(root: string, display: string, rows: readonly string[]): string {
    let next: string | null = null, end = rows.length;
    while (end > 0) {
      const footer = `\nMore: ${next ?? "none"}\n`, header = "# Your invocation receipt links\nCoverage: this page's explicit links only; independently observed mutable records.\n";
      let begin = end, size = Buffer.byteLength(header + footer);
      while (begin > 0 && size + Buffer.byteLength(rows[begin - 1]! + "\n") <= this.pageBytes) size += Buffer.byteLength(rows[--begin]! + "\n");
      if (begin === end) throw new StoreError("LIMIT_EXCEEDED", "one receipt index row exceeds its page budget");
      const text = this.bounded(header + rows.slice(begin, end).join("\n") + "\n" + footer);
      const path = join("receipts", "pages", `${sha256Hex(text)}.md`);
      this.immutable(join(root, path), text);
      next = join(display, path); end = begin;
    }
    if (next === null) throw new StoreError("INTERNAL_ERROR", "receipt page has no rows");
    return next;
  }
}
