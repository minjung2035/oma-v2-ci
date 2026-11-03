/** Git owns exact private verification and publication for accepted Mail/create roots.
 * Neither dependency creates a standalone submit receipt or notification. */
import { createHash } from "node:crypto";
import type { AuthContext, AgentCreateInput } from "@oma/contracts";
import type { AttachmentUpload, BlobDescriptor, CreateSourcePlan, MailAttachmentPlan, MailAttachmentSource, MailInput, SharedCommitReference } from "@oma/contracts/values";
import type { PreacceptArtifactOwner } from "@oma/contracts/files";
import { assertCurrentActor } from "@oma/domain/authority";
import { publicationSources } from "@oma/domain/durable";
import { mailAttachmentRootId, createRootId, createSourceRequestKey, createSourcePublicationId, attachmentPublicationId, attachmentRequestKey, exportRefForRequestKey, publishedRefFor } from "@oma/domain/derived";
import { StoreError } from "@oma/domain/errors";
import { prepareAttachmentSpool, requireFrozenBundle, withFrozenBundle } from "@oma/storage/submit-spool";
import type { GitLedger } from "./ports.js";
import type { GitRepositoryPort } from "./repository-port.js";

interface PreparationScope {
  register(input: { readonly operationId: string; readonly resource: string; readonly owner: PreacceptArtifactOwner;
    readonly observe: () => "unaccepted-known" | "accepted-referenced" | "accepted-unreferenced" }): void;
}
interface SourceInput { readonly commit: string; readonly objectFormat: "sha1" | "sha256"; readonly stage?: AttachmentUpload }
async function ingress(descriptor: BlobDescriptor, stream: AsyncIterable<Uint8Array> | undefined): Promise<Buffer> {
  if (!stream) throw new StoreError("STREAM_INVALID", "publication requires its original frozen ingress");
  const chunks: Buffer[] = [], hash = createHash("sha256"); let received = 0;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > descriptor.bytes - received)
      throw new StoreError("STREAM_INVALID", "publication ingress exceeds its descriptor");
    const copy = Buffer.from(chunk); chunks.push(copy); hash.update(copy); received += copy.byteLength;
  }
  if (received !== descriptor.bytes || hash.digest("hex") !== descriptor.sha256)
    throw new StoreError("STREAM_INVALID", "publication ingress differs from its frozen descriptor");
  return Buffer.concat(chunks, received);
}
export class MailAttachments {
  constructor(private readonly ledger: GitLedger, private readonly repository: GitRepositoryPort,
    private readonly shared: (commits: readonly string[]) => readonly SharedCommitReference[],
    private readonly writer: <T>(work: () => Promise<T>) => Promise<T>) {}

  private owner(): void {
    const owner = this.repository.submission.assertOwner;
    if (!owner || owner() !== undefined) throw new StoreError("UNSUPPORTED_PROFILE", "current broker publication owner is unavailable");
  }
  hasCreateSource(commit: string): boolean {
    if (this.ledger.inTransaction) throw new StoreError("INTERNAL_ERROR", "create source observation cannot run in T");
    this.repository.submission.verifyObjectFormat([commit]);
    return this.repository.submission.canonicalHas(commit);
  }
  async stage(auth: AuthContext, root: string, key: string, input: MailInput,
    stream: AsyncIterable<Uint8Array> | undefined, scope: PreparationScope): Promise<MailAttachmentPlan> {
    if (this.ledger.inTransaction) throw new StoreError("INTERNAL_ERROR", "publication preparation cannot run in T");
    if (!input.content || input.content.mediaType !== "application/vnd.oma.attachments-v1" || !input.collaboration ||
        input.collaboration.freeze?.operation !== root || root !== mailAttachmentRootId(auth.actor, key))
      throw new StoreError("INVALID_REQUEST", "attachment preparation requires its exact original root and ingress");
    assertCurrentActor(this.ledger, auth, "mail.send");
    const bytes = await ingress(input.content, stream);
    const sources = await this.prepare(auth, root, key, "mail.send", input.collaboration.attachments, bytes, scope);
    return { version: "collaboration-v1", sources, freeze: { ...input.collaboration.freeze }, observedAtMs: Date.now() };
  }
  async stageCreate(auth: AuthContext, root: string, key: string, input: AgentCreateInput,
    stream: AsyncIterable<Uint8Array> | undefined, scope: PreparationScope): Promise<CreateSourcePlan> {
    if (this.ledger.inTransaction) throw new StoreError("INTERNAL_ERROR", "publication preparation cannot run in T");
    if (!input.collaboration || input.collaboration.freeze.operation !== root || root !== createRootId(auth.actor, key) || auth.role !== "resident")
      throw new StoreError("INVALID_REQUEST", "create source preparation requires its exact original Worker root");
    assertCurrentActor(this.ledger, auth, "agent.create");
    if (input.collaboration.stage !== undefined && input.collaboration.stage.exportRef !== exportRefForRequestKey(createSourceRequestKey(key)))
      throw new StoreError("INVALID_REQUEST", "create export ref belongs to another original request");
    const bytes = input.content === undefined ? undefined : await ingress(input.content, stream);
    let publication: MailAttachmentSource | undefined;
    if (!this.hasCreateSource(input.from)) {
      const stage = input.collaboration.stage;
      if (!stage || !input.content || !bytes) throw new StoreError("CANDIDATE_NOT_PUBLISHED", "unavailable create source has no original frozen bundle");
      publication = (await this.prepare(auth, root, key, "agent.create", [{ commit: input.from,
        objectFormat: input.from.length === 40 ? "sha1" : "sha256", stage: { ...stage, bundle: input.content } }], bytes, scope))[0];
    }
    return { version: "collaboration-v1", freeze: { ...input.collaboration.freeze }, observedAtMs: Date.now(), ...(publication === undefined ? {} : { publication }) };
  }
  private async prepare(auth: AuthContext, root: string, key: string, kind: "mail.send" | "agent.create",
    entries: readonly SourceInput[], bytes: Buffer, scope: PreparationScope): Promise<MailAttachmentSource[]> {
    if (this.ledger.inTransaction) throw new StoreError("INTERNAL_ERROR", "publication preparation cannot run in T");
    if (auth.role !== "resident") throw new StoreError("CAPABILITY_DENIED", "local publication belongs to Workers");
    if (!this.ledger.attachmentRoots) throw new StoreError("UNSUPPORTED_PROFILE", "accepted root publication provenance reader is unavailable");
    const authorize = () => { assertCurrentActor(this.ledger, auth, "git.submit"); this.owner(); };
    assertCurrentActor(this.ledger, auth, kind);
    const sources: MailAttachmentSource[] = []; let offset = 0;
    for (const [ordinal, source] of entries.entries()) {
      const start = offset, expectedExport = exportRefForRequestKey(kind === "mail.send" ? attachmentRequestKey(key, ordinal) : createSourceRequestKey(key));
      if (source.stage !== undefined) offset += source.stage.bundle.bytes;
      if (offset > bytes.byteLength || source.stage !== undefined && (source.stage.exportRef !== expectedExport ||
          createHash("sha256").update(bytes.subarray(start, offset)).digest("hex") !== source.stage.bundle.sha256))
        throw new StoreError("STREAM_INVALID", "publication slice differs from its original identity or digest");
      // Canonical availability may advance after freezing; reuse never transfers authorship.
      if (kind === "agent.create" && this.hasCreateSource(source.commit)) continue;
      let reused: SharedCommitReference | undefined;
      if (kind === "mail.send") {
        try { reused = this.shared([source.commit])[0]; }
        catch (error) { if (!(error instanceof StoreError) || error.code !== "CANDIDATE_NOT_PUBLISHED") throw error; }
      }
      if (reused !== undefined) { sources.push(reused); continue; }
      const stage = source.stage;
      if (!stage) throw new StoreError("CANDIDATE_NOT_PUBLISHED", "unpublished source has no original frozen bundle");
      authorize();
      this.repository.submission.verifyObjectFormat([source.commit, ...stage.prerequisites]);
      const spool = await prepareAttachmentSpool(this.repository.stateRoot, root, ordinal, stage.bundle,
        (async function* () { yield bytes.subarray(start, offset); })());
      const bundle = spool.bundle;
      if (bundle === null) throw new StoreError("INTERNAL_ERROR", "publication spool lost its frozen bundle");
      const dependency = kind === "mail.send" ? attachmentPublicationId(root, ordinal) : createSourcePublicationId(root);
      scope.register({ operationId: root, resource: bundle.path,
        owner: { path: bundle.path, retainForOperation: () => spool.retainForOperation(), discardUnaccepted: () => spool.discardUnaccepted() },
        observe: () => {
          const operation = this.ledger.getOperationById(root);
          if (operation === null) return "unaccepted-known";
          return operation.kind === kind && publicationSources(operation.plan).some(item => item.local?.dependency === dependency &&
            item.local.bundle.path === bundle.path && item.local.bundle.sha256 === bundle.sha256) ? "accepted-referenced" : "accepted-unreferenced";
        } });
      const verify = this.repository.submission.quarantineVerify;
      if (!verify) throw new StoreError("UNSUPPORTED_PROFILE", "private preaccept quarantine verification is unavailable");
      await withFrozenBundle(bundle, fd => verify(fd, source.commit, stage.exportRef, stage.prerequisites, authorize));
      requireFrozenBundle(bundle);
      sources.push({ commit: source.commit, objectFormat: source.objectFormat, publication: root, publicationOrdinal: ordinal,
        publishedRef: publishedRefFor(auth.actor, dependency), local: { dependency, exportRef: stage.exportRef,
          prerequisites: [...stage.prerequisites], bundle: { ...bundle } } });
    }
    if (offset !== bytes.byteLength) throw new StoreError("STREAM_INVALID", "publication ingress has unclaimed trailing bytes");
    if (sources.some(source => source.local !== undefined)) authorize(); else assertCurrentActor(this.ledger, auth, kind);
    return sources;
  }
  finalize(plan: MailAttachmentPlan): MailAttachmentPlan {
    if (this.ledger.inTransaction) throw new StoreError("INTERNAL_ERROR", "publication validation cannot run in T");
    const sources = plan.sources.map(source => {
      if (!source.local) return source;
      requireFrozenBundle(source.local.bundle);
      try { return this.shared([source.commit])[0] ?? source; }
      catch (error) { if (!(error instanceof StoreError) || error.code !== "CANDIDATE_NOT_PUBLISHED") throw error; }
      return source;
    });
    return { ...plan, sources, observedAtMs: Date.now() };
  }
  finalizeCreate(plan: CreateSourcePlan): CreateSourcePlan {
    if (this.ledger.inTransaction) throw new StoreError("INTERNAL_ERROR", "create publication validation cannot run in T");
    if (!plan.publication?.local) return plan;
    requireFrozenBundle(plan.publication.local.bundle);
    if (!this.hasCreateSource(plan.publication.commit)) return plan;
    const { publication: _unused, ...reused } = plan;
    return { ...reused, observedAtMs: Date.now() };
  }
  complete(root: string): Promise<void> {
    if (this.ledger.inTransaction) throw new StoreError("INTERNAL_ERROR", "accepted publication cannot run in T");
    const rootOperation = this.ledger.getOperationById(root);
    if (!rootOperation || (rootOperation.kind !== "mail.send" && rootOperation.kind !== "agent.create"))
      throw new StoreError("STORE_CORRUPT", "accepted publication root is unavailable");
    if (!publicationSources(rootOperation.plan).some(source => source.local !== undefined)) return Promise.resolve();
    return this.writer(async () => {
      if (this.ledger.inTransaction) throw new StoreError("INTERNAL_ERROR", "accepted publication cannot run in T");
      const original = this.ledger.getOperationById(root);
      if (!original || (original.kind !== "mail.send" && original.kind !== "agent.create"))
        throw new StoreError("STORE_CORRUPT", "accepted publication root is unavailable");
      const local = publicationSources(original.plan).filter(source => source.local !== undefined);
      const authorize = () => {
        const current = this.ledger.getOperationById(root);
        if (!current || current.kind !== original.kind || current.planJson !== original.planJson ||
            (current.state !== "pending" && current.state !== "unknown"))
          throw new StoreError("STORE_CORRUPT", "accepted publication delegation changed or is terminal");
        this.owner(); // Exact accepted delegation, never reconstructed sender authority.
      };
      for (const source of local) {
        const preparation = source.local!;
        let observed = this.repository.submission.observeRef(source.publishedRef);
        if (observed.kind === "present") {
          if (observed.value !== source.commit) throw new StoreError("STORE_CORRUPT", "accepted publication ref contains a third OID");
        } else if (observed.kind === "absent") {
          authorize();
          await withFrozenBundle(preparation.bundle, fd => this.repository.submission.quarantineImport(fd, source.commit,
            preparation.exportRef, preparation.prerequisites, authorize));
          requireFrozenBundle(preparation.bundle);
          observed = this.repository.submission.observeRef(source.publishedRef);
          if (observed.kind === "absent") { authorize(); this.repository.submission.publishRef(source.publishedRef, source.commit); }
          else if (observed.kind !== "present" || observed.value !== source.commit)
            throw new StoreError(observed.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "publication changed during import");
        } else throw new StoreError(observed.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", "publication is unobserved");
        if (!this.repository.submission.canonicalHas(source.commit)) throw new StoreError("STORE_CORRUPT", "accepted published source lost its commit");
      }
    });
  }
}
