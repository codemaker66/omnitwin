# @omnitwin/types

Shared TypeScript and Zod contract package for Venviewer. This package is the
source of truth for cross-package vocabulary: IDs, enums, request/response
schemas, runtime asset metadata, venue geometry, event instructions, planner
objects, and evidence-state labels.

## Owns

- Exported schemas and types in `src/index.ts`.
- Runtime-validated API contracts consumed by `@omnitwin/api` and
  `@omnitwin/web`.
- Shared geometry, asset, review, hallkeeper, pricing, and runtime-package
  vocabulary.
- Tests that pin schema behavior and prevent contract drift.

## Does Not Own

- Database queries, migrations, or provider SDK usage.
- Browser components, route loaders, stores, or rendering.
- Server route implementation.
- Generated fixtures that pretend to be verified room captures.

## Commands

Run from the repository root:

```bash
pnpm --filter @omnitwin/types lint
pnpm --filter @omnitwin/types typecheck
pnpm --filter @omnitwin/types test
pnpm --filter @omnitwin/types build
```

Build `@omnitwin/types` before running API or web code that imports the package
through its compiled `dist` entry:

```bash
pnpm --filter @omnitwin/types build
```

## Contract Rules

- Add a Zod schema and exported TypeScript type together.
- Prefer deriving types with `z.infer` instead of duplicating interfaces.
- Add focused tests for every new enum, parser, guard, or manifest shape.
- Mark future-facing exports as aspirational in `src/index.ts` until runtime
  packages consume them.
- Do not use `any`.
- Do not let web or API packages redeclare a shared vocabulary locally when it
  belongs here.
- Keep asset and evidence vocabulary conservative: fixture/demo data must not
  parse as a real published runtime asset.

## When To Change This Package

Change `@omnitwin/types` first when a behavior crosses package boundaries: API
responses, web request payloads, runtime package manifests, venue room registry,
asset evidence states, export descriptors, or hallkeeper sheet contracts.
