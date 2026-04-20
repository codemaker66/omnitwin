# Zod generic-inference trap

**Read this when:** writing or modifying a Zod schema that combines `.passthrough()` with `.default()` or `.nullable()` members, passing a schema as the generic argument to a `ZodType<T>`-typed client helper (e.g. `api.get<T>(path, schema)`), or debugging cascading `objectInputType vs objectOutputType is not assignable` errors at the api client boundary.

---

Schemas that combine `.passthrough()` with `.default()` / `.nullable()` members
make `input` ≠ `output` in Zod's inferred type. When you then pass that schema
as the argument to a helper typed `ZodType<T>` (e.g. `api.get<T>(path, schema)`),
TypeScript blows up with cascading `objectInputType vs objectOutputType is not
assignable` errors deep in the inference chain — the error points at the
assignment site, not at the schema.

**Escape hatch (use this — do not re-type the response field as the rich schema):**

1. Boundary schema: declare the field as `z.unknown().optional()` (or
   `.nullable().optional()`) so the transport layer preserves JSONB without
   stripping keys.
2. Consumer-side narrowing:
   `RichSchema.nullable().safeParse(value ?? null)` and read `parsed.data`.

Canonical example: `packages/web/src/api/configurations.ts` declares
`metadata: z.unknown().optional()`; `packages/web/src/components/editor/EventDetailsPanel.tsx:72`
narrows with `ConfigurationMetadataSchema.nullable().safeParse(config.metadata ?? null)`.

**Corollary:** when a Zod schema has `.default(...)` on a field, the parsed
output is never `undefined`. `parsed.phaseDeadlines ?? []` and
`parsed.dayOfContact ?? null` are unnecessary-condition lints under
`strictTypeChecked` — spread the parsed blob verbatim.
