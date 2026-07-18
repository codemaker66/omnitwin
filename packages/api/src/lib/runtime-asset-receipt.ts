import { createHash } from "node:crypto";

/** Canonical object key used for private runtime-member identity. */
export function canonicalRuntimeAssetStorageKey(r2Key: string): string {
  return r2Key.replace(/^r2:/u, "").replace(/^\/+/, "");
}

/** Bind a server-only object location without putting that location in a manifest. */
export function runtimeAssetStorageKeySha256(r2Key: string): string {
  return createHash("sha256")
    .update(canonicalRuntimeAssetStorageKey(r2Key), "utf8")
    .digest("hex");
}
