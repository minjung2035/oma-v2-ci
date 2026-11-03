/** Validate caller-frozen sources against the original action. Caller source paths
 * are never opened here; exact targets use only this actor's own no-follow record root. */
import { join } from "node:path";
import type { ProtocolLimits } from "@oma/contracts";
import type { MailModule } from "@oma/mail";
import { StoreError } from "@oma/domain/errors";
import { agentRootPathAt, collaborationRecordRootPathAt, modelWorkspacePathAt } from "@oma/domain/paths";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { collaborationArguments, collaborationMutationMethod } from "@oma/domain/collaboration-inputs";
import { contextFileCheck } from "@oma/domain/context-policy";
import { contextPublishParamsCheck, mailParamsCheck } from "@oma/domain/validation";
import { sha256Hex } from "@oma/domain/canonical-json";
import { decodeUtf8 } from "@oma/domain/utf8";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { prepareCollaborationSources, validateCollaborationSources } from "../runtime/collaboration-sources.js";
import type { InvocationSourcePort } from "../runtime/host-invocations.js";
import type { AuthContext, Json } from "@oma/contracts";
import type { ReviewModule } from "@oma/review";
import type { GitModule } from "@oma/git";
import { collaborationReviewManifest } from "@oma/domain/collaboration-review";
import { reviewState } from "@oma/domain/review-evaluation";
import { collaborationTargetPath } from "@oma/domain/collaboration-review";
import { decodeCollaborationTarget, type CollaborationTarget } from "@oma/domain/collaboration-targets";
import { readBoundedWithin } from "@oma/tool-files";
import { decodeExistingPreparation } from "@oma/protocol/invocation-resolution";
import { createRootId, createSourceRequestKey, attachmentRequestKey, mailAttachmentRootId, exportRefForRequestKey } from "@oma/domain/derived";
import { decodeFrozenSubmission, submissionPublicationSubject } from "@oma/protocol/invocation-submission";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";

export function createInvocationSources(stateRoot: string, society: string, limits: ProtocolLimits, mail: MailModule,
  reviews: Pick<ReviewModule, "exactTargetGuard" | "proposalMetadata" | "targetSource" | "existingResolution"> | null = null,
  git: Pick<GitModule, "hasCreateSource" | "isPublished" | "sharedAttachments" | "knownRefs" | "readReviewDiffRecord"> | null = null, lifecycle: Pick<import("@oma/lifecycle").LifecycleModule, "freezeCreation"> | null = null): InvocationSourcePort {
  const sharedCandidate = (oid: string): boolean => {
    if (!git) return false;
    const refs = git.knownRefs();
    return refs.main === oid || refs.published.includes(oid);
  };
  const target = (auth: AuthContext, reference: string): CollaborationTarget => {
    const root = collaborationRecordRootPathAt(stateRoot, auth.actor), displayRoot = auth.role === "resident" ? RESIDENT_PATHS.records : root;
    const address = collaborationTargetPath(reference, displayRoot);
    const decoded = decodeCollaborationTarget(readBoundedWithin(root, address.relative, limits.frameBytes), address.name);
    if (decoded.request !== address.request) throw new StoreError("INVALID_REQUEST", "exact target path names a different request");
    return decoded;
  };
  const inspectedTarget = (auth: AuthContext, reference: string, societyBirth: string) => {
    if (!reviews) throw new StoreError("UNSUPPORTED_PROFILE", "exact review facts are unavailable");
    const decoded = target(auth, reference);
    let appliedManifestSha256: string | undefined;
    if (decoded.kind === "applied") {
      if (auth.role !== "resident" || !git) throw new StoreError("CAPABILITY_DENIED", "applied source artifacts belong to Workers");
      const input = reviews.targetSource(auth, decoded.request), state = reviewState(input), integration = input.integration;
      if (integration?.state !== "succeeded" || integration.diff === undefined || !integration.identity)
        throw new StoreError("INVALID_REQUEST", "STALE_TARGET: exact applied artifact is unavailable");
      const recorded = git.readReviewDiffRecord(integration.diff);
      appliedManifestSha256 = sha256Hex(collaborationReviewManifest({ request: decoded.request, revision: state.revision,
        kind: "applied", integration: integration.operation, identity: integration.identity }, integration.diff, recorded.paths));
      if (appliedManifestSha256 !== decoded.manifestSha256)
        throw new StoreError("INVALID_REQUEST", "applied target differs from the canonical frozen artifact manifest");
    }
    return { target: decoded, guard: reviews.exactTargetGuard(auth, decoded, societyBirth, appliedManifestSha256) };
  };
  const reviewGuard = (auth: AuthContext, tool: string, args: Json, societyBirth: string): (() => undefined) => {
    const raw = collaborationArguments(tool, args), checks: (() => undefined)[] = [];
    if (tool === "oma_review" && typeof raw.target === "string") checks.push(inspectedTarget(auth, raw.target, societyBirth).guard);
    else if (tool === "oma_merge" || tool === "oma_challenge") {
      if (typeof raw.proposal === "string") checks.push(inspectedTarget(auth, raw.proposal, societyBirth).guard);
      if (tool === "oma_challenge" && typeof raw.merge === "string") checks.push(inspectedTarget(auth, raw.merge, societyBirth).guard);
    } else throw new StoreError("UNSUPPORTED_PROFILE", "this exact review action driver is unavailable");
    return (): undefined => { for (const check of checks) check(); return undefined; };
  };
  return {
    streamBytes: limits.contextBytes,
    bundleBytes: limits.bundleBytes,
    freezeCreation: (auth, params) => {
      if (!lifecycle) throw new StoreError("UNSUPPORTED_PROFILE", "original child policy resolution is unavailable");
      return lifecycle.freezeCreation(auth, decodeMutationPayload("agent.create", params));
    },
    validate: (auth, tool, args, societyBirth) => {
      validateCollaborationSources(tool, args, auth.role);
      if (["oma_review", "oma_merge", "oma_challenge"].includes(tool)) {
        if (societyBirth === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "original review preflight requires its Society birth");
        reviewGuard(auth, tool, args, societyBirth)();
      }
    },
    reviewGuard,
    prepare: (auth, tool, args, frozen, bytes, societyBirth, originalKey) => {
      const method = collaborationMutationMethod(tool, args);
      const compound = method === "attest.record" ? decodeFrozenSubmission(frozen, originalKey) : undefined;
      if (frozen !== null && typeof frozen === "object" && !Array.isArray(frozen) && frozen.kind === "collaboration.submission" && !compound?.ok)
        throw new StoreError("INVALID_REQUEST", compound && !compound.ok ? compound.reason : "invalid submission preparation");
      const payload = compound?.ok ? JSON.parse(canonicalCollaborationJson(compound.value.review)) : frozen;
      if (compound?.ok) {
        const publication = compound.value.publication.params;
        if (auth.role !== "resident" || publication.to[0] !== auth.actor || originalKey === undefined)
          throw new StoreError("CAPABILITY_DENIED", "local source publication requires its exact Worker invocation");
        if (publication.subject !== submissionPublicationSubject(compound.value.review, limits.subjectBytes))
          throw new StoreError("INVALID_REQUEST", "publication notice differs from the original submission");
        if (sharedCandidate(publication.candidate))
          throw new StoreError("INVALID_REQUEST", "SOURCE_CHANGED: candidate became shared before its original submission freeze; inspect the original invocation");
        if (!publication.bundle || !bytes || bytes.byteLength !== publication.bundle.bytes || sha256Hex(bytes) !== publication.bundle.sha256)
          throw new StoreError("STREAM_INVALID", "original publication bundle differs from its frozen descriptor");
      }
      const existing = method === "attest.record" && frozen !== null && typeof frozen === "object" && !Array.isArray(frozen) && frozen.kind === "collaboration.existing";
      if (existing) {
        const decoded = decodeExistingPreparation(frozen);
        if (!decoded.ok || (tool !== "oma_merge" && tool !== "oma_challenge")) throw new StoreError("INVALID_REQUEST", "invalid existing-proposal preparation");
      } else decodeMutationPayload(method, payload);
      let submittedSource: { readonly candidate: string; readonly base: string } | undefined;
      let spawnSource: string | undefined;
      if (method === "agent.create") {
        const input = decodeMutationPayload("agent.create", frozen);
        spawnSource = input.from;
        if (auth.role !== "resident" || originalKey === undefined || input.collaboration?.freeze.operation !== createRootId(auth.actor, originalKey))
          throw new StoreError("INVALID_REQUEST", "creation source has no exact original Worker root");
        if (input.content !== undefined) {
          if (!bytes || bytes.byteLength !== input.content.bytes || sha256Hex(bytes) !== input.content.sha256 ||
              input.collaboration.stage?.exportRef !== exportRefForRequestKey(createSourceRequestKey(originalKey)))
            throw new StoreError("STREAM_INVALID", "original create source differs from its frozen identity or bundle");
        } else if (git?.hasCreateSource(spawnSource) !== true)
          throw new StoreError("CANDIDATE_NOT_PUBLISHED", "the frozen create source has no accessible canonical commit or original bundle");
      }
      if (existing) {
        const decoded = decodeExistingPreparation(frozen);
        if (!decoded.ok) throw new StoreError("INVALID_REQUEST", "invalid existing proposal source");
        submittedSource = decoded.value.target.source;
      }
      if (method === "attest.record" && !existing) {
        const input = decodeMutationPayload("attest.record", payload);
        if ((input.kind === "merge.open" || input.kind === "review.revise" || input.kind === "challenge.open") && input.candidate !== undefined && input.base !== undefined)
          submittedSource = { candidate: input.candidate, base: input.base };
        if (!compound?.ok && (input.kind === "merge.open" || input.kind === "review.revise" || input.kind === "challenge.open") &&
            input.candidate !== undefined && !sharedCandidate(input.candidate))
          throw new StoreError("CANDIDATE_NOT_PUBLISHED", "local candidate publication requires its protected source driver");
      }
      let text: string | undefined;
      let context: ReturnType<typeof decodeMutationPayload<"context.publish">> | undefined;
      if (method === "context.publish") {
        context = decodeMutationPayload("context.publish", frozen);
        const problem = contextPublishParamsCheck(limits)(context);
        if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
        if (!bytes || bytes.byteLength !== context.content.bytes || sha256Hex(bytes) !== context.content.sha256)
          throw new StoreError("STREAM_INVALID", "original context bytes do not match their frozen descriptor");
        let offset = 0;
        for (const entry of context.entries) {
          const data = bytes.subarray(offset, offset + entry.bytes);
          if (data.byteLength !== entry.bytes || sha256Hex(data) !== entry.sha256 || contextFileCheck(entry.path, data) !== null)
            throw new StoreError("STREAM_INVALID", "original context entry does not match its frozen manifest");
          if (entry.path === "GOAL.md") text = decodeUtf8(data);
          offset += entry.bytes;
        }
        if (offset !== bytes.byteLength || text === undefined) throw new StoreError("STREAM_INVALID", "original context manifest is incomplete");
      } else if (method === "mail.send") text = decodeMutationPayload("mail.send", frozen).body;
      else if (method === "agent.continue") text = decodeMutationPayload("agent.continue", frozen).note;
      else if (method === "agent.create") text = decodeMutationPayload("agent.create", frozen).brief;
      // The first host freeze owns these exact submitted bytes. Their source path
      // is only original intent metadata, not a request for host filesystem access.
      const workspace = modelWorkspacePathAt(stateRoot, auth.actor), home = join(agentRootPathAt(stateRoot, auth.actor), "home");
      const records = collaborationRecordRootPathAt(stateRoot, auth.actor);
      const views = auth.role === "principal" ? [workspace, records] : [workspace, home, records,
        RESIDENT_PATHS.workspace, RESIDENT_PATHS.home, RESIDENT_PATHS.records, RESIDENT_PATHS.archive,
        RESIDENT_PATHS.workerArchive, RESIDENT_PATHS.world, join(stateRoot, "mail", "archive"), join(stateRoot, "mail", "workers"), join(stateRoot, "world")];
      // Canonical original arguments, not the caller's normalized effect object.
      const raw = collaborationArguments(tool, args), attachmentRevisions = new Map<string, string>();
      if (method === "mail.send") {
        const submitted = decodeMutationPayload("mail.send", frozen).collaboration;
        const resolutions = submitted?.resolutions ?? [], originals = Array.isArray(raw.attachments) ? raw.attachments : [];
        if (resolutions.length !== originals.length) throw new StoreError("INVALID_REQUEST", "frozen attachment resolutions differ from the original invocation");
        for (const [index, source] of originals.entries()) {
          if (source === null || typeof source !== "object" || Array.isArray(source) || typeof source.commit !== "string")
            throw new StoreError("INVALID_REQUEST", "invalid original attachment source");
          const commit = resolutions[index]!, previous = attachmentRevisions.get(source.commit);
          if (previous !== undefined && previous !== commit) throw new StoreError("INVALID_REQUEST", "one original attachment spelling resolved to different OIDs");
          attachmentRevisions.set(source.commit, commit);
        }
        if (submitted !== undefined) for (const source of submitted.attachments) {
          if (source.stage !== undefined) continue; // Git's private verifier owns closure validation before root acceptance.
          if (!git) throw new StoreError("UNSUPPORTED_PROFILE", "shared attachment observations are unavailable");
          git.sharedAttachments([source.commit]);
        }
      }
      let frozenMail: ReturnType<typeof decodeMutationPayload<"mail.send">> | undefined;
      if (method === "mail.send") {
        const input = decodeMutationPayload("mail.send", frozen), problem = mailParamsCheck(limits)(input);
        if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
        if (originalKey === undefined || input.collaboration?.freeze?.operation !== mailAttachmentRootId(auth.actor, originalKey))
          throw new StoreError("INVALID_REQUEST", "mail root differs from its original invocation");
        if (input.content !== undefined) {
          if (auth.role !== "resident") throw new StoreError("CAPABILITY_DENIED", "local attachments require their exact Worker invocation");
          if (!bytes || bytes.byteLength !== input.content.bytes || sha256Hex(bytes) !== input.content.sha256)
            throw new StoreError("STREAM_INVALID", "original attachment ingress differs from its frozen descriptor");
          let offset = 0;
          for (const [ordinal, source] of input.collaboration!.attachments.entries()) {
            if (source.stage === undefined) continue;
            const end = offset + source.stage.bundle.bytes;
            if (source.stage.exportRef !== exportRefForRequestKey(attachmentRequestKey(originalKey, ordinal)) || end > bytes.byteLength ||
                sha256Hex(bytes.subarray(offset, end)) !== source.stage.bundle.sha256)
              throw new StoreError("STREAM_INVALID", "original attachment slice differs from its frozen identity or bytes");
            offset = end;
          }
          if (offset !== bytes.byteLength) throw new StoreError("STREAM_INVALID", "original attachment ingress contains unclaimed bytes");
        }
        frozenMail = input;
      }
      const prepared = prepareCollaborationSources(tool, args, { role: auth.role, society, actor: auth.actor,
        cwd: auth.role === "resident" ? RESIDENT_PATHS.workspace : workspace,
        recordRoot: auth.role === "resident" ? RESIDENT_PATHS.records : records,
        roots: views.map(view => ({ view, physical: view })), limits,
        resolveRevision: (_revision, field) => {
          const oid = field === "attachment" ? attachmentRevisions.get(_revision) : field === "from" ? spawnSource : submittedSource?.[field];
          if (oid === undefined) throw new StoreError("INVALID_REQUEST", "the original frozen committed source is unavailable");
          return oid;
        },
        recordedBase: () => submittedSource?.base ?? null,
        target: reference => {
          if (societyBirth === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "exact review birth is unavailable");
          const original = inspectedTarget(auth, reference, societyBirth).target;
          if (original.kind === "proposal" && submittedSource === undefined) submittedSource = original.source;
          return original;
        },
        proposalMetadata: request => {
          if (!reviews) throw new StoreError("UNSUPPORTED_PROFILE", "proposal metadata is unavailable");
          return reviews.proposalMetadata(auth, request);
        },
        readFile: (_path, maximum) => {
          if (text === undefined || Buffer.byteLength(text, "utf8") > maximum)
            throw new StoreError("INVALID_REQUEST", "frozen source bytes are missing or exceed their effective bound");
          return text;
        },
        goal: (body, expected) => {
          if (!context || !bytes || context.expected !== expected || body !== text)
            throw new StoreError("INVALID_REQUEST", "GOAL does not match the original frozen context");
          // The existing context owner still validates preservation against the
          // exact expected commit and performs CAS; this is not acceptance.
          return { entries: context.entries, content: Buffer.from(bytes), digest: { bytes: bytes.byteLength, sha256: sha256Hex(bytes) } };
        },
        reply: id => {
          const source = mail.readRecord(auth.actor, id);
          if (source.state !== "published") throw new StoreError("BROKER_UNAVAILABLE", "SOURCE_UNREADABLE: accepted reply source is not published");
          return { id: source.record.message, subject: source.record.subject };
        },
      });
      if (compound?.ok) {
        if (canonicalCollaborationJson(prepared.params) !== canonicalCollaborationJson(compound.value.review))
          throw new StoreError("INVALID_REQUEST", "publication changed the original frozen review intent");
        const bundle = compound.value.publication.params.bundle;
        if (!bundle || !bytes) throw new StoreError("STREAM_INVALID", "original publication bytes are unavailable");
        return { method, params: JSON.parse(canonicalCollaborationJson(compound.value)),
          digest: { bytes: bundle.bytes, sha256: bundle.sha256 }, stream: Buffer.from(bytes) };
      }
      if (method === "agent.create") {
        const input = decodeMutationPayload("agent.create", frozen), { content, collaboration, ...logical } = input;
        if (canonicalCollaborationJson(prepared.params) !== canonicalCollaborationJson(logical))
          throw new StoreError("INVALID_REQUEST", "create source preparation changed its original name, commit or brief");
        return { method, params: JSON.parse(canonicalCollaborationJson(input)), ...(content === undefined ? {} : {
          digest: { bytes: content.bytes, sha256: content.sha256 }, stream: Buffer.from(bytes!),
        }) };
      }
      if (frozenMail !== undefined) {
        const { content, collaboration, ...ordinary } = frozenMail;
        const { freeze: _freeze, ...logicalCollaboration } = collaboration!;
        const logical = { ...ordinary, collaboration: { ...logicalCollaboration, attachments: collaboration!.attachments.map(({ stage: _stage, ...source }) => source) } };
        if (canonicalCollaborationJson(prepared.params) !== canonicalCollaborationJson(logical))
          throw new StoreError("INVALID_REQUEST", "mail source preparation changed the original frozen mail intent");
        return { method, params: JSON.parse(canonicalCollaborationJson(frozenMail)), ...(content === undefined ? {} : {
          digest: { bytes: content.bytes, sha256: content.sha256 }, stream: Buffer.from(bytes!),
        }) };
      }
      if (!existing) return prepared;
      const completed = decodeExistingPreparation(prepared.params);
      if (!completed.ok || !reviews || societyBirth === undefined) throw new StoreError("INVALID_REQUEST", "existing proposal resolution is unavailable");
      return { ...prepared, resolution: reviews.existingResolution(auth, completed.value.target, societyBirth) };
    },
  };
}
