/** Storage abstraction. Phase 1 = local FS; Phase 2 adds S3 behind the same interface. */
export interface StorageDriver {
  /** Recursively copy a local directory tree to `key`. */
  putDir(key: string, localDir: string): Promise<void>;
  /** Write a single object. */
  putBuffer(key: string, data: Buffer): Promise<void>;
  /** Read a single object; throws if absent. */
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  /**
   * Return an on-disk path for `key` so Fastify static can stream it.
   * For local this is the real path; the S3 driver will hydrate to a temp dir.
   */
  resolveLocalPath(key: string): Promise<string>;
  /** Atomically replace destKey with the contents at srcKey (used to publish a finished report dir). */
  move(srcKey: string, destKey: string): Promise<void>;
}
