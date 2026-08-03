import { createHash } from "node:crypto";
import {
  CanonicalJsonValueSchema,
  RuntimeQaRecordV0Schema,
  stableCanonicalJson,
} from "@omnitwin/types";

/** Bind an admission to the exact validated runtime QA body. */
export function runtimeQaRecordSha256(input: unknown): string {
  const record = RuntimeQaRecordV0Schema.parse(input);
  return createHash("sha256")
    .update(stableCanonicalJson(CanonicalJsonValueSchema.parse(record)), "utf8")
    .digest("hex");
}
