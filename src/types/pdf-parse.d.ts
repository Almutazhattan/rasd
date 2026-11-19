/**
 * pdf-parse ships no types. We declare only what we use: the default export,
 * and the pagerender hook we rely on to keep page boundaries.
 */
declare module 'pdf-parse' {
  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => Promise<string>;
    max?: number;
    version?: string;
  }
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdfParse(data: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}
