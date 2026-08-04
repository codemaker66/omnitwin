type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

export function toCanonicalJson(value: unknown): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical number must be finite.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(toCanonicalJson);
  if (typeof value === "object") {
    const output: Record<string, CanonicalJson> = {};
    for (const [key, member] of Object.entries(value)) {
      if (member === undefined) throw new Error("Canonical member must be defined.");
      output[key] = toCanonicalJson(member);
    }
    return output;
  }
  throw new Error("Unsupported canonical JSON value.");
}

export function stableCanonicalJson(value: CanonicalJson): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(",")}]`;
  const object = value as { readonly [key: string]: CanonicalJson };
  return `{${Object.keys(object)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(object[key] ?? null)}`)
    .join(",")}}`;
}
