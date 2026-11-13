import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as types from "../index.js";

// Two zod 4 rules a schema's author cannot see at the call site:
//
// - A default under .optional() is applied. .partial() wraps every field in
//   .optional(), so an update schema made from a create schema fills a field
//   the patch left out with the create default, over the stored value.
// - A default is returned as it is, not parsed. A default its own schema
//   would trim, transform or refuse goes through untouched.
//
// Zod 3 did neither. This walks every schema the package exports and holds
// both lines, so the upgrade's fixes cannot quietly come undone.

function children(schema: z.core.$ZodType): z.core.$ZodType[] {
  if (schema instanceof z.ZodObject) {
    const fields: z.core.$ZodType[] = Object.values(schema.shape);
    const catchall = schema._zod.def.catchall;
    return catchall === undefined ? fields : [...fields, catchall];
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodNonOptional ||
    schema instanceof z.ZodLazy ||
    schema instanceof z.ZodPromise
  ) {
    return [schema.unwrap()];
  }
  if (schema instanceof z.ZodArray) return [schema.element];
  if (schema instanceof z.ZodUnion) return [...schema.options];
  if (schema instanceof z.ZodIntersection) return [schema._zod.def.left, schema._zod.def.right];
  if (schema instanceof z.ZodTuple) {
    const { items, rest } = schema._zod.def;
    return rest === null ? [...items] : [...items, rest];
  }
  if (schema instanceof z.ZodRecord) return [schema.keyType, schema.valueType];
  if (schema instanceof z.ZodMap) return [schema.keyType, schema.valueType];
  if (schema instanceof z.ZodSet) return [schema._zod.def.valueType];
  if (schema instanceof z.ZodPipe) return [schema.in, schema.out];
  return [];
}

interface Finding {
  readonly path: string;
  readonly detail: string;
}

function walk(roots: readonly (readonly [string, z.core.$ZodType])[]): { optionalDefaults: Finding[]; unparsedDefaults: Finding[]; visited: number } {
  const seen = new Set<z.core.$ZodType>();
  const optionalDefaults: Finding[] = [];
  const unparsedDefaults: Finding[] = [];
  const stack = roots.map(([path, schema]) => ({ path, schema }));
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    const { path, schema } = next;
    if (seen.has(schema)) continue;
    seen.add(schema);
    if (schema instanceof z.ZodObject) {
      for (const [key, field] of Object.entries(schema.shape)) {
        if (field._zod.optin === "defaulted" && field._zod.optout === "optional") {
          optionalDefaults.push({ path: `${path}.${key}`, detail: "a default under .optional()" });
        }
      }
    }
    if (schema instanceof z.ZodDefault) {
      const value: unknown = schema._zod.def.defaultValue;
      const parsed = z.safeParse(schema.unwrap(), value);
      if (!parsed.success || !isDeepStrictEqual(parsed.data, value)) {
        unparsedDefaults.push({ path, detail: `default ${JSON.stringify(value)} is not its own parse` });
      }
    }
    const childSchemas = children(schema);
    childSchemas.forEach((child, index) => {
      stack.push({ path: `${path}/${String(index)}`, schema: child });
    });
  }
  return { optionalDefaults, unparsedDefaults, visited: seen.size };
}

const exportedEntries: readonly (readonly [string, unknown])[] = Object.entries(types);
const exportedSchemas: (readonly [string, z.core.$ZodType])[] = [];
for (const [name, value] of exportedEntries) {
  if (value instanceof z.ZodType) exportedSchemas.push([name, value]);
}

describe("zod 4 semantics across the exported schemas", () => {
  const result = walk(exportedSchemas);

  it("reaches the whole exported surface", () => {
    expect(exportedSchemas.length).toBeGreaterThan(1_000);
    expect(result.visited).toBeGreaterThan(exportedSchemas.length);
  });

  it("puts no default under .optional(), so a patch never writes a default it was not sent", () => {
    expect(result.optionalDefaults).toEqual([]);
  });

  it("gives every default a value its own schema returns unchanged", () => {
    expect(result.unparsedDefaults).toEqual([]);
  });

  it("finds both shapes when they are there", () => {
    const Create = z.object({ name: z.string(), currency: z.string().length(3).default("GBP") });
    const planted = walk([
      ["Patch", Create.partial()],
      ["Trimmed", z.string().trim().default(" x ")],
    ]);
    expect(planted.optionalDefaults.map((finding) => finding.path)).toEqual(["Patch.currency"]);
    expect(planted.unparsedDefaults.map((finding) => finding.path)).toEqual(["Trimmed"]);
  });
});
