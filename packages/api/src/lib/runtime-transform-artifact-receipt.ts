import { createHash } from "node:crypto";
import {
  TransformArtifactV0Schema,
  stableCanonicalJson,
  type CanonicalJsonValue,
} from "@omnitwin/types";

function toCanonicalJson(value: unknown): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("TransformArtifactV0 canonical JSON cannot encode non-finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJson(entry));
  }
  if (typeof value === "object") {
    const canonical: Record<string, CanonicalJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        canonical[key] = toCanonicalJson(entry);
      }
    }
    return canonical;
  }
  throw new Error("TransformArtifactV0 canonical JSON contains an unsupported value.");
}

/** Validate and serialize a TransformArtifactV0 with recursively sorted object keys. */
export function canonicalRuntimeTransformArtifactJson(input: unknown): string {
  const artifact = TransformArtifactV0Schema.parse(input);
  return stableCanonicalJson(toCanonicalJson(artifact));
}

/** Bind QA approval to the exact validated TransformArtifactV0 content. */
export function runtimeTransformArtifactSha256(input: unknown): string {
  return createHash("sha256")
    .update(canonicalRuntimeTransformArtifactJson(input), "utf8")
    .digest("hex");
}
