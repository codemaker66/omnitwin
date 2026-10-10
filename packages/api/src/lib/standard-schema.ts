import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { ZodType, ZodTypeDef } from "zod";

// ---------------------------------------------------------------------------
// A Zod 3 schema as the MCP SDK's tool input contract (T-649).
//
// @modelcontextprotocol/server v2 accepts any Standard Schema that can also
// describe itself as JSON Schema: it advertises the JSON Schema in
// `tools/list` and calls `validate` on every `tools/call` before the handler
// runs. This repository pins Zod 3.24, which has no JSON Schema converter, so
// the adapter pairs a Zod schema (the validator — the runtime boundary, and
// the source of the handler's argument types) with a JSON Schema document
// written beside it (what the model reads). Only Zod decides what reaches a
// handler; the public-mcp tests hold the two to the same accept/reject cases.
// ---------------------------------------------------------------------------

/** A JSON Schema document as plain data. */
export type JsonSchemaDocument = Readonly<Record<string, unknown>>;

export function zodToolSchema<Output, Input>(
  schema: ZodType<Output, ZodTypeDef, Input>,
  jsonSchema: JsonSchemaDocument,
): StandardSchemaWithJSON<Input, Output> {
  // A fresh copy per call: the SDK may annotate what it is handed.
  const document = (): Record<string, unknown> => structuredClone(jsonSchema);
  return {
    "~standard": {
      version: 1,
      vendor: "zod",
      validate: (value) => {
        const parsed = schema.safeParse(value);
        if (parsed.success) return { value: parsed.data };
        return {
          issues: parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        };
      },
      jsonSchema: { input: document, output: document },
    },
  };
}
