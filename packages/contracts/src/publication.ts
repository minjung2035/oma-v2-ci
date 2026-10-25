/** Type identity for observed parent effects. These declarations grant no
 * authority: each effect owner alone observes, issues and consumes its token. */
declare const integrationPublicationBrand: unique symbol;
export interface IntegrationPublicationEvidence { readonly [integrationPublicationBrand]: true }
declare const submissionPublicationBrand: unique symbol;
export interface SubmissionPublicationEvidence { readonly [submissionPublicationBrand]: true }
declare const contextPublicationBrand: unique symbol;
export interface ContextPublicationEvidence { readonly [contextPublicationBrand]: true }
declare const creationPublicationBrand: unique symbol;
export interface CreationPublicationEvidence { readonly [creationPublicationBrand]: true }
export type PublicationEvidence = IntegrationPublicationEvidence | SubmissionPublicationEvidence | ContextPublicationEvidence | CreationPublicationEvidence;
