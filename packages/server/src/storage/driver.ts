import type { Readable } from "node:stream";

export interface StorageDriver {
  putDir(key: string, localDir: string): Promise<void>;     // recursive upload; sets per-file ContentType
  putBuffer(key: string, data: Buffer): Promise<void>;      // sets ContentType from key ext
  read(key: string): Promise<Buffer>;                       // full read; throws if absent
  exists(key: string): Promise<boolean>;                    // true if key OR any object under prefix exists
  remove(key: string): Promise<void>;                       // recursive delete of key/prefix
  /** Hydrate everything under `prefix` to a temp local dir; caller MUST dispose(). Local = real dir, no-op dispose. */
  materializeDir(prefix: string): Promise<{ dir: string; dispose(): Promise<void> }>;
  /** Open one object for HTTP serving; rejects with a not-found error (NoSuchKey/ENOENT) when absent. */
  readStream(key: string): Promise<{ body: Readable; contentType?: string; contentLength?: number }>;
}
