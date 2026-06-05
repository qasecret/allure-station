import { cp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { StorageDriver } from "./driver.js";

export class LocalDriver implements StorageDriver {
  readonly #root: string;
  constructor(root: string) { this.#root = resolve(root); }

  #path(key: string): string {
    const p = resolve(this.#root, key);
    if (p !== this.#root && !p.startsWith(this.#root + sep)) {
      throw new Error(`key escapes storage root: ${key}`);
    }
    return p;
  }

  async putDir(key: string, localDir: string): Promise<void> {
    const dest = this.#path(key);
    await mkdir(dest, { recursive: true });
    await cp(localDir, dest, { recursive: true });
  }

  async putBuffer(key: string, data: Buffer): Promise<void> {
    const dest = this.#path(key);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }

  async read(key: string): Promise<Buffer> { return readFile(this.#path(key)); }

  async exists(key: string): Promise<boolean> {
    try { await access(this.#path(key)); return true; } catch { return false; }
  }

  async remove(key: string): Promise<void> {
    await rm(this.#path(key), { recursive: true, force: true });
  }

  async resolveLocalPath(key: string): Promise<string> { return this.#path(key); }
}
