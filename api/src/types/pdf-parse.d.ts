declare module "pdf-parse" {
  interface PdfParseResult {
    numpages: number;
    text: string;
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export = pdfParse;
}
