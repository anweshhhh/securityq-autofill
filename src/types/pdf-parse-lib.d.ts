declare module "pdf-parse/lib/pdf-parse.js" {
  type TextContentItem = {
    str?: string;
    transform?: number[];
    hasEOL?: boolean;
  };

  type PdfPageData = {
    getTextContent: (params: {
      normalizeWhitespace: boolean;
      disableCombineTextItems: boolean;
    }) => Promise<{ items: TextContentItem[] }>;
  };

  type PdfParseOptions = {
    pagerender?: (pageData: PdfPageData) => Promise<string>;
  };

  type PdfParseResult = {
    text: string;
  };

  const pdfParse: (dataBuffer: Buffer, options?: PdfParseOptions) => Promise<PdfParseResult>;

  export default pdfParse;
}
