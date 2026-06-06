import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { StorageDriver } from "./driver.js";
import { contentTypeFor } from "./mime.js";

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** Recursively enumerate all files under a directory (no glob dependency). */
async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

export class S3Driver implements StorageDriver {
  readonly #c: S3Client;
  readonly #bucket: string;

  constructor(cfg: S3Config) {
    this.#bucket = cfg.bucket;
    this.#c = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle ?? true,
      credentials: cfg.credentials,
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  }

  async putBuffer(key: string, data: Buffer): Promise<void> {
    await this.#c.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: data,
        ContentType: contentTypeFor(key),
      }),
    );
  }

  async putDir(key: string, localDir: string): Promise<void> {
    const files = await walkFiles(localDir);
    for (const file of files) {
      const rel = relative(localDir, file).split(sep).join("/");
      const up = new Upload({
        client: this.#c,
        params: {
          Bucket: this.#bucket,
          Key: `${key}/${rel}`,
          Body: createReadStream(file),
          ContentType: contentTypeFor(rel),
        },
      });
      await up.done();
    }
  }

  async read(key: string): Promise<Buffer> {
    const r = await this.#c.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    return Buffer.from(
      await (
        r.Body as { transformToByteArray(): Promise<Uint8Array> }
      ).transformToByteArray(),
    );
  }

  async exists(key: string): Promise<boolean> {
    const r = await this.#c.send(
      new ListObjectsV2Command({
        Bucket: this.#bucket,
        Prefix: key,
        MaxKeys: 1,
      }),
    );
    return (r.KeyCount ?? 0) > 0;
  }

  async remove(key: string): Promise<void> {
    for await (const batch of this.#listKeys(key)) {
      if (batch.length) {
        await this.#c.send(
          new DeleteObjectsCommand({
            Bucket: this.#bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })) },
          }),
        );
      }
    }
  }

  async materializeDir(
    prefix: string,
  ): Promise<{ dir: string; dispose(): Promise<void> }> {
    const norm = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const dir = await mkdtemp(join(tmpdir(), "s3mat-"));
    try {
      for await (const batch of this.#listKeys(norm)) {
        for (const k of batch) {
          const rel = k.slice(norm.length);
          if (!rel) continue;
          const dest = join(dir, rel);
          await mkdir(dirname(dest), { recursive: true });
          const obj = await this.#c.send(
            new GetObjectCommand({ Bucket: this.#bucket, Key: k }),
          );
          await pipeline(obj.Body as Readable, createWriteStream(dest));
        }
      }
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
    return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
  }

  async readStream(key: string): Promise<{
    body: Readable;
    contentType?: string;
    contentLength?: number;
  }> {
    // GetObjectCommand throws NoSuchKey if absent
    const r = await this.#c.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
    );
    return {
      body: r.Body as Readable,
      contentType: r.ContentType ?? contentTypeFor(key),
      contentLength: r.ContentLength,
    };
  }

  async *#listKeys(prefix: string): AsyncGenerator<string[]> {
    let token: string | undefined;
    do {
      const r = await this.#c.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      yield (r.Contents ?? [])
        .map((o) => o.Key!)
        .filter(Boolean);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  }

  // test-only helpers
  async ensureBucket(): Promise<void> {
    try {
      await this.#c.send(new CreateBucketCommand({ Bucket: this.#bucket }));
    } catch {
      /* already exists */
    }
  }

  async dropBucket(): Promise<void> {
    await this.remove("");
    try {
      await this.#c.send(new DeleteBucketCommand({ Bucket: this.#bucket }));
    } catch {
      /* ignore */
    }
  }
}
