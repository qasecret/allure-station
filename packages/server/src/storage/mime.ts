import { lookup } from "mrmime";
/** Content-type for a storage key/filename; defaults to octet-stream. */
export function contentTypeFor(key: string): string {
  return lookup(key) ?? "application/octet-stream";
}
