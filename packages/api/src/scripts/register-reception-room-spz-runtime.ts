/**
 * Retired operator entrypoint.
 *
 * This command used to upload assets and then overwrite the latest Reception
 * Room runtime package. Runtime packages are immutable revisions now, so
 * keeping the old implementation callable would bypass the safety contract.
 */

const CODE = "RETIRED_RUNTIME_PACKAGE_MUTATOR";
process.stderr.write([
  `${CODE}: this command is retired because it overwrote runtime-package history.`,
  "Use one of these read-only dry-run commands from the repository root:",
  "  pnpm --filter @omnitwin/api assets:register-reception-room-mobile-frontier -- --manifest \"C:\\absolute\\path\\Reception Room Mobile.lcc2\"",
  "  pnpm --filter @omnitwin/api assets:register-reception-room-quality-frontier",
  "Do not add --apply until migration 0052 and the full migration tail are reviewed, deployed, verified, and an administrator approves the exact payload.",
  "No files, object storage, or database rows were changed.",
  "",
].join("\n"));
process.exitCode = 1;
