import { createHash } from "node:crypto";
import { FoundryIntegrityError } from "./errors.js";

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

export function toCanonicalJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FoundryIntegrityError("NON_FINITE_CANONICAL_NUMBER", "Canonical JSON cannot contain non-finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalJson);
  if (typeof value === "object") {
    const output: Record<string, CanonicalJson> = {};
    for (const [key, member] of Object.entries(value)) {
      if (member === undefined) {
        throw new FoundryIntegrityError("UNDEFINED_CANONICAL_MEMBER", `Canonical JSON member ${key} is undefined.`);
      }
      output[key] = toCanonicalJson(member);
    }
    return output;
  }
  throw new FoundryIntegrityError("UNSUPPORTED_CANONICAL_VALUE", `Unsupported canonical JSON value: ${typeof value}`);
}

function canonicalize(value: CanonicalJson): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FoundryIntegrityError("NON_FINITE_CANONICAL_NUMBER", "Canonical JSON cannot contain non-finite numbers.");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as { readonly [key: string]: CanonicalJson };
  return `{${Object.keys(object)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key] ?? null)}`)
    .join(",")}}`;
}

export function stableCanonicalJson(value: CanonicalJson): string {
  return canonicalize(value);
}

export function domainSeparatedSha256(domain: string, value: CanonicalJson): string {
  if (!/^[A-Z0-9_.-]{8,120}$/u.test(domain)) {
    throw new FoundryIntegrityError("INVALID_DIGEST_DOMAIN", "Digest domains must be explicit uppercase ASCII identifiers.");
  }
  return createHash("sha256")
    .update(domain, "ascii")
    .update(Buffer.from([0]))
    .update(stableCanonicalJson(value), "utf8")
    .digest("hex");
}
