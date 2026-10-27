export interface DeclaredWebLink {
    url: string;
    relations: string[];
    type?: string;
}
export declare function discoverDeclaredWebLinks(document: Document, linkHeader: string | null, responseUrl: string): DeclaredWebLink[];
export declare function appendDeclaredWebLinks(content: string, links: DeclaredWebLink[]): string;
