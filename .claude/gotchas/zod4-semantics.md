**Read this when:** writing or changing a zod schema that uses `.default()` or
`.partial()`, `.omit()`/`.pick()`/`.merge()` on a refined object, an object key typed
`z.unknown()`/`z.any()`, a request array, test UUIDs, or code that reads zod issue
codes or messages.

# zod 4 changed meanings that compile cleanly

The repo moved from zod 3.24.2 to 4.6.7 on 25-26 Oct 2026 (PR #179, for
GHSA-mrhx-c7xc-m3w5). Each item below was measured against both versions; the
probes are in `D:/claude/zod4-upgrade/scripts/`.

## A default under `.optional()` is applied

`.partial()` wraps every field in `.optional()`, so an update schema built from a
create schema fills a field the patch left out with the create default, over the
stored value. Under zod 3 the field stayed absent. Three patches did this before the
upgrade fixed them: pricing rules (`isActive` back to true, currency to GBP),
opportunities (currency to GBP) and the proposal-share approve body.

Override each defaulted field after `.partial()`:

```ts
const Update = Create.partial().extend({ currency: Create.shape.currency.unwrap().optional() });
```

`packages/types/src/__tests__/zod-semantics.test.ts` walks every exported schema and
fails on a default under `.optional()`. Route-local schemas are not covered by it.

## A default is not parsed

`.default(x)` returns `x` as it is. A default that its own schema would trim,
transform or refuse goes through untouched. The same test checks every exported
default against its own schema. Use `.prefault(x)` for the zod 3 behaviour.

## An absent `z.unknown()` key is refused

Since zod 4.4 an object key is optional only if its schema says so. `z.unknown()`,
`z.any()`, `z.undefined()`, `z.custom()` and unions containing `z.undefined()`
accept `undefined` but still refuse a missing key ("expected nonoptional"). Write
`.optional()` where the key may be absent. Over HTTP, a missing key is the only form
`undefined` can take.

## Refined objects refuse `.omit()`, `.pick()`, `.partial()` and `.merge()`

A `.refine()` or `.superRefine()` now stays on the object instead of wrapping it, and
these methods throw at module load when it is there. `.extend()` throws when it
overwrites a key. zod 3 code reached the bare object with `.innerType()`. Start from
the shape and re-apply the check:
`z.object(Refined.shape).omit({...}).strict().superRefine(check)`.

`.merge(B)` takes B's strictness and refinements; `.extend(B.shape)` keeps the first
schema's. They are the same only when both sides share strictness and B has no
refinement.

## `z.uuid()` checks the RFC version and variant

The third group must start 1-8 and the fourth 8, 9, a or b. Production ids come from
`gen_random_uuid()`, `crypto.randomUUID()` or the v5/v4 helpers that set those bits.
Hand-written test ids need the same shape: `00000000-0000-4000-8000-000000000001`,
not `00000000-0000-0000-0000-000000000001`. Use `z.guid()` only for a field that
must accept non-RFC ids, and say why.

## Issues are shaped differently

- Codes: `invalid_string` is `invalid_format`; `invalid_enum_value` and
  `invalid_literal` are `invalid_value`; `invalid_union_discriminator` is
  `invalid_union`; `invalid_date` is `invalid_type`.
- Default messages changed ("Required" is now "Invalid input: expected string,
  received undefined"). Custom messages are unchanged.
- `issue.path` is `PropertyKey[]`, and `invalid_type` issues have no `received`.
- `ctx.addIssue(issue)` with an issue from another parse needs `{ ...issue }`.

## Only a bounded array stops early

For an array with `.max(n)` or `.length(n)`, zod 4.6.7 reports one issue and stops.
An unbounded array still reports one issue per bad element: 1 MiB of `{}` against
`z.array(z.uuid())` is 349,525 issues and about +100 MB of heap in either version.
Give every request array an upper bound; `public-config.test.ts` replays the attack
on the anonymous batch route.

## Spelling

`no-deprecated` lint fails on the zod 3 spellings (`z.string().uuid()`,
`z.ZodIssueCode.custom`, `.passthrough()`, `.finite()`, `.safe()`, `.merge()`).
`node tools/zod4-modernize.mjs --write <files>` rewrites all of them except
`.merge()` to the identical zod 4 form. `z.record()` takes two arguments:
`z.record(z.string(), V)`. An enum key makes the record exhaustive; use
`z.partialRecord()` for optional keys.
