/** MCS-T01..T09 authored model-facing help. No execution/authority lives here. */
import type { CollaborationRole } from "@oma/domain/collaboration-surface";

interface Help { readonly label: string; readonly description: string; readonly promptSnippet: string }
const help: Readonly<Record<string, Help>> = Object.freeze({
  oma_send: {
    label: "Send a message or committed work",
    description: "Send a durable message with inline text or the contents of a file. Add commit attachments to share code or documents without requesting a merge; OMA freezes and publishes the exact commits as needed. Use replyTo to continue a thread, and choose recipients explicitly. Recipients select delivery, not a new confidentiality boundary. Acceptance, attachment publication, mailbox delivery, and recipient action are different outcomes. If acceptance is unknown, OMA reconnects the original invocation; do not resend to escape uncertainty. Workers may use @self alone for a continuation note, without subject, replyTo, attachments, or urgent.",
    promptSnippet: "Send messages, file contents, or exact commit attachments through one delivery action.",
  },
  oma_spawn: {
    label: "Create an independent Worker",
    description: "Create an autonomous Worker with its own clone at an exact commit and a self-contained brief. OMA publishes the committed starting point if needed and authorized, then provisions the Worker and delivers the brief. Use an existing peer when that avoids unnecessary setup, but choose collaboration freely. Creation requires a delegable child profile and available enabled-Worker capacity; idle or waiting Workers still occupy slots. An accepted or enabled Worker is not proof of execution or task completion. Do not create another name to bypass an unresolved creation.",
    promptSnippet: "Create an independent colleague from a committed starting point and a useful brief.",
  },
  oma_merge: {
    label: "Submit a change for integration",
    description: "Submit committed code for integration, or resubmit your existing proposal. For a new proposal, omitted change uses HEAD and the recorded base. With proposal, omitted change keeps that proposal's frozen commits; it never means your current HEAD. Supplying changed commits creates a new revision and invalidates approvals that do not bind that revision. Repeating unchanged code observes an active proposal, or requests a new attempt only after its exact attempt has definitively failed. OMA publishes missing commits. A submission receipt is not proof that main changed. Read the returned status and exact review records; do not create a fresh proposal to escape an unknown integration.",
    promptSnippet: "Submit a coherent commit, or update the same proposal with an exact proposal reference.",
  },
  oma_challenge: {
    label: "Propose a correction to an applied merge",
    description: "Challenge an exact applied merge with evidence and a proposed correction. For a new challenge, omit replacement to request OMA's prepared revert, or provide both replacement commits. With proposal, resubmit that same challenge; omitted replacement retains its frozen correction instead of generating another revert. A HIGH merge cannot be challenged at LOW. Challenges require the broker's recorded review conditions, including LOW challenges. Opening or approving a challenge is not proof that the correction was applied.",
    promptSnippet: "Propose an evidence-based revert or replacement of an exact applied merge.",
  },
  oma_review: {
    label: "Record a decision or withdraw your own record",
    description: "Record approve or reject for the exact review target you inspected, or withdraw a specific proposal or vote that you own. Use a review target for a verdict, a submission target to cancel your proposal, and a vote target to withdraw your vote. Authors cannot supply independent votes for their own change. A newer verdict preserves the earlier history. Ordinary discussion belongs in mail. Stale targets are refused rather than rebound to the latest code. Withdrawal cannot undo an applied Git change; use a challenge for that.",
    promptSnippet: "Record an evidence-based verdict or retract an exact record you own.",
  },
  oma_wait: {
    label: "Yield this activation",
    description: "Yield the current activation at a safe boundary after this tool batch is recorded. Use when progress depends on new input and no useful independent work remains. This is not a blocking receive, acknowledgment, task completion, Worker stop, or capacity release. Accepted operations continue under their existing owners. Processes and temporary files do not survive the activation; preserve needed results before yielding.",
    promptSnippet: "Yield when new input is needed and no useful independent work remains.",
  },
  oma_follow: {
    label: "Choose topic delivery",
    description: "Enable or disable delivery of future messages for one topic to yourself. This changes your subscription, not another Worker's. Reading or posting to a topic does not subscribe you. Following does not create deliveries for old messages; permitted history remains readable in the topic index. Unfollowing does not cancel deliveries whose recipient snapshots were already accepted.",
    promptSnippet: "Choose which topic conversations deliver future messages to you.",
  },
  oma_goal: {
    label: "Publish the shared goal",
    description: "Publish the complete shared GOAL and its notification while preserving other context files. Use the Human's objective, constraints, priorities, and observable completion criteria. expectedRevision compares the current context commit; null means no context is expected, not unconditional overwrite. A mismatch is refused. Ordinary mail does not publish or replace the GOAL. File content is read only from paths the Principal is allowed to inspect.",
    promptSnippet: "Publish the complete shared objective with an exact context-revision check.",
  },
  oma_society: {
    label: "Open or close Worker execution",
    description: "Open or close Worker execution for this Society. Close for a justified execution stop, including after verified project completion; it does not itself prove the project is complete. Only a succeeded close receipt confirms Worker execution has ended. Opening preserves mail, sessions, and individual stop ownership; it does not release a separate Principal-imposed stop. This is not routine task scheduling or individual Worker control.",
    promptSnippet: "Control the Society execution gate without treating it as project-completion evidence.",
  },
});
export function collaborationHelp(name: string, role: CollaborationRole): Help {
  if (!Object.hasOwn(help, name)) throw new TypeError("unknown collaboration action");
  const result = help[name]!;
  if (role !== "principal") return { ...result };
  if (name === "oma_send") return { ...result, description: "Send a durable message with inline text or the contents of a permitted file. Reference already accessible published commits to share supporting work; the Principal cannot publish a new local candidate. Use replyTo to continue a thread and choose recipients explicitly. Recipients select delivery, not a new confidentiality boundary. Acceptance, mailbox delivery, and recipient action are different outcomes. If acceptance is unknown, OMA reconnects the original invocation; do not resend to escape uncertainty. Ordinary mail does not publish a GOAL or record an approval." };
  if (name === "oma_review") return { ...result, description: "Approve or reject the exact broker-issued approval target you inspected, or withdraw your own still-retractable approval using its vote target. The target includes the current approval-message identity; ordinary mail cannot authorize a decision. A Principal rejection permanently closes that request. You cannot cancel Worker proposals, withdraw another actor's vote, or use withdrawal to reopen a rejected or applied request. Approval is not proof of integration. Stale targets must be reviewed again, not overridden." };
  return { ...result };
}
