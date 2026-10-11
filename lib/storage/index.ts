import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

/*
 * Document storage (spec Section 2): the firm's own S3 bucket with SSE-KMS
 * under the firm's key, and signed URLs that expire after five minutes.
 * Development, tests and demos use a local directory instead. Keys never
 * contain names or client data: `matters/<matter id>/<document id>`.
 */

export const SIGNED_URL_SECONDS = 300;

export interface BlobStore {
  readonly kind: "s3" | "local" | "memory";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** A URL the browser can fetch for 5 minutes, or null when the app must stream the bytes itself. */
  signedDownloadUrl(key: string, fileName: string, contentType: string): Promise<string | null>;
}

export class S3Store implements BlobStore {
  readonly kind = "s3" as const;
  private readonly client: S3Client;
  constructor(
    readonly bucket: string,
    region: string,
    private readonly kmsKeyId: string,
  ) {
    // Credentials come from the environment (AWS_*), scoped to this bucket only.
    this.client = new S3Client({ region });
  }
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.kmsKeyId,
        ChecksumAlgorithm: "SHA256",
      }),
    );
  }
  async get(key: string): Promise<Uint8Array> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!r.Body) throw new Error("empty object");
    return r.Body.transformToByteArray();
  }
  async signedDownloadUrl(key: string, fileName: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `attachment; filename="${fileName.replace(/["\\\r\n]/g, "_")}"`,
      }),
      { expiresIn: SIGNED_URL_SECONDS },
    );
  }
}

/** Local directory store. Files are named by a hash of the key, never by client data. */
export class LocalStore implements BlobStore {
  readonly kind = "local" as const;
  constructor(private readonly dir: string) {}
  private file(key: string): string {
    return path.join(this.dir, createHash("sha256").update(key).digest("hex"));
  }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.file(key), bytes, { mode: 0o600 });
  }
  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.file(key)));
  }
  async signedDownloadUrl(): Promise<null> {
    return null;
  }
}

export class MemoryStore implements BlobStore {
  readonly kind = "memory" as const;
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes, contentType });
  }
  async get(key: string): Promise<Uint8Array> {
    const o = this.objects.get(key);
    if (!o) throw new Error("not found");
    return o.bytes;
  }
  async signedDownloadUrl(): Promise<null> {
    return null;
  }
}

let override: BlobStore | null | undefined;
let shared: BlobStore | undefined;

/**
 * The firm's store, or null when none is configured. Production outside demo
 * mode requires S3: a local directory on a web server is not durable storage.
 */
export function getBlobStore(): BlobStore | null {
  if (override !== undefined) return override;
  if (shared) return shared;
  const e = env();
  if (e.S3_BUCKET && e.S3_REGION && e.KMS_KEY_ID) {
    shared = new S3Store(e.S3_BUCKET, e.S3_REGION, e.KMS_KEY_ID);
  } else if (e.NODE_ENV !== "production" || e.DEMO_MODE) {
    shared = new LocalStore(e.STORAGE_DIR ?? path.join(process.cwd(), ".storage"));
  } else {
    return null;
  }
  return shared;
}

export function setBlobStoreForTesting(store: BlobStore | null | undefined): void {
  override = store;
}
