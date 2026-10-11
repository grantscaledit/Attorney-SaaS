import {
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
} from "@aws-sdk/client-textract";
import { extractText } from "unpdf";
import { env } from "@/lib/env";

/*
 * Reads the text of an uploaded document before any model sees it (spec
 * Section 2: "OCR runs before the LLM so identifiers can be masked"). The
 * caller masks the result; nothing here logs or stores text.
 *
 * - textract: AWS Textract asynchronous text detection on the object in the
 *   firm's bucket, for scans and photos. VERIFY: Textract's role can decrypt
 *   with the firm's KMS key, and the page and size limits for the account.
 * - text_layer: the embedded text of a PDF. Scans have none, so their pages
 *   come back empty and are flagged for a person.
 */

export type ReadResult = {
  engine: "textract" | "text_layer";
  pages: string[];
  /** Mean confidence 0-1 when the engine reports it. */
  confidence: number | null;
  /** 1-based pages with no readable text or low confidence (B4 flags them). */
  unreadablePages: number[];
};

export type FileKind = {
  mime: "application/pdf" | "image/jpeg" | "image/png" | "image/tiff";
  ext: string;
};

/** File type from the bytes, never from the browser's claim. Null: not accepted. */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46)
    return { mime: "application/pdf", ext: "pdf" };
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47)
    return { mime: "image/png", ext: "png" };
  if (
    (b(0) === 0x49 && b(1) === 0x49 && b(2) === 0x2a && b(3) === 0x00) ||
    (b(0) === 0x4d && b(1) === 0x4d && b(2) === 0x00 && b(3) === 0x2a)
  ) {
    return { mime: "image/tiff", ext: "tif" };
  }
  return null;
}

const MIN_PAGE_CHARS = 20;
const LOW_CONFIDENCE = 0.8;

export interface TextReader {
  read(input: { key: string; bytes: Uint8Array; mime: FileKind["mime"] }): Promise<ReadResult>;
}

export class TextLayerReader implements TextReader {
  async read({ bytes, mime }: { bytes: Uint8Array; mime: FileKind["mime"] }): Promise<ReadResult> {
    if (mime !== "application/pdf") {
      return { engine: "text_layer", pages: [""], confidence: null, unreadablePages: [1] };
    }
    // unpdf takes ownership of the buffer; give it a copy.
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
    const pages = text.map((t) => t.replace(/[ \t]+/g, " ").trim());
    return {
      engine: "text_layer",
      pages,
      confidence: null,
      unreadablePages: pages.flatMap((p, i) => (p.length < MIN_PAGE_CHARS ? [i + 1] : [])),
    };
  }
}

export class TextractReader implements TextReader {
  private readonly client: TextractClient;
  constructor(
    private readonly bucket: string,
    region: string,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    this.client = new TextractClient({ region });
  }

  async read({ key }: { key: string }): Promise<ReadResult> {
    const started = await this.client.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: this.bucket, Name: key } },
      }),
    );
    const jobId = started.JobId;
    if (!jobId) throw new Error("Textract returned no job id");
    const blocks: Block[] = [];
    // Poll for up to about four minutes, then give up (the job retries later).
    for (let attempt = 0; attempt < 60; attempt++) {
      await this.sleep(attempt === 0 ? 1_000 : 4_000);
      const first = await this.client.send(new GetDocumentTextDetectionCommand({ JobId: jobId }));
      if (first.JobStatus === "FAILED")
        throw new Error(`Textract failed: ${first.StatusMessage ?? "unknown"}`);
      if (first.JobStatus !== "SUCCEEDED" && first.JobStatus !== "PARTIAL_SUCCESS") continue;
      blocks.push(...(first.Blocks ?? []));
      let next = first.NextToken;
      while (next) {
        const page = await this.client.send(
          new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: next }),
        );
        blocks.push(...(page.Blocks ?? []));
        next = page.NextToken;
      }
      return fromBlocks(blocks);
    }
    throw new Error("Textract did not finish in time");
  }
}

/** Lines per page, in reading order as Textract returns them. Exported for tests. */
export function fromBlocks(blocks: readonly Block[]): ReadResult {
  const pages = new Map<number, { lines: string[]; conf: number[] }>();
  let maxPage = 0;
  for (const b of blocks) {
    const n = b.Page ?? 1;
    maxPage = Math.max(maxPage, n);
    if (b.BlockType !== "LINE" || !b.Text) continue;
    const p = pages.get(n) ?? { lines: [], conf: [] };
    p.lines.push(b.Text);
    if (typeof b.Confidence === "number") p.conf.push(b.Confidence / 100);
    pages.set(n, p);
  }
  const out: string[] = [];
  const unreadable: number[] = [];
  const all: number[] = [];
  for (let n = 1; n <= Math.max(maxPage, 1); n++) {
    const p = pages.get(n);
    const text = p?.lines.join("\n") ?? "";
    out.push(text);
    const mean = p?.conf.length ? p.conf.reduce((a, c) => a + c, 0) / p.conf.length : 0;
    if (p?.conf.length) all.push(...p.conf);
    if (text.length < MIN_PAGE_CHARS || mean < LOW_CONFIDENCE) unreadable.push(n);
  }
  return {
    engine: "textract",
    pages: out,
    confidence: all.length ? all.reduce((a, c) => a + c, 0) / all.length : null,
    unreadablePages: unreadable,
  };
}

let override: TextReader | undefined;

export function getTextReader(): TextReader {
  if (override) return override;
  const e = env();
  const engine = e.OCR_ENGINE ?? (e.S3_BUCKET ? "textract" : "text_layer");
  return engine === "textract" && e.S3_BUCKET && e.S3_REGION
    ? new TextractReader(e.S3_BUCKET, e.S3_REGION)
    : new TextLayerReader();
}

export function setTextReaderForTesting(reader: TextReader | undefined): void {
  override = reader;
}
