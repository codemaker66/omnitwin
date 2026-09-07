**Read this when:** debugging a Zod input/output mismatch at an API boundary, especially
with defaults, transforms or passthrough metadata.

# Zod input and output are different types

A default or transform can make a schema's input type differ from its parsed
output. Check both sides before weakening a schema or adding an assertion.

The current [API client](../../packages/web/src/api/client.ts) declares
`ResponseSchema<T> = ZodType<T, ZodTypeDef, unknown>`: it accepts untrusted input
and returns validated `T`. This fixes the older helper assumption that input and
output must be identical. Prefer a precise boundary schema with the correct generic
input type; do not replace validation with `unknown` just to silence inference.

Some metadata is intentionally transported as an opaque optional JSON value and
validated by the consuming domain schema. The configuration metadata path is one
such existing design. Use that pattern only when the contract intentionally owns
validation at the consumer, and test invalid/unknown data there.

After parsing, defaults are present according to the output type. Do not add
fallbacks that contradict that validated contract. Verify the installed Zod version
and existing client tests when changing generic helpers; no `any` or double casts.
