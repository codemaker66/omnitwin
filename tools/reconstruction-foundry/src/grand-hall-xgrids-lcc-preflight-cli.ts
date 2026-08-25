import type {
  GrandHallXgridsLccPreflightReceiptV1,
  GrandHallXgridsMachineObservationV1,
  GrandHallXgridsVerifiedSourceV1,
} from "./grand-hall-xgrids-lcc-preflight.js";
import {
  GrandHallXgridsPreflightError,
  createGrandHallXgridsLccPreflightReceipt,
  verifyGrandHallXgridsSource,
} from "./grand-hall-xgrids-lcc-preflight.js";
import { collectGrandHallWindowsMachineObservation } from "./grand-hall-xgrids-lcc-windows.js";

export const GRAND_HALL_XGRIDS_LCC_PREFLIGHT_USAGE = [
  "Read-only Grand Hall XGRIDS/LCC estimator preflight.",
  "",
  "Usage:",
  "  pnpm --silent --filter @omnitwin/reconstruction-foundry-cli grand-hall-lcc-preflight -- --source <absolute-capture-root> --scratch <absolute-empty-scratch-directory> --lcc-install <absolute-lcc-install-root>",
  "",
  "The command re-hashes the exact 12-file, 41.3 GB source project, probes Windows hardware,",
  "and prints one canonical JSON receipt to stdout. It never writes the capture, starts LCC,",
  "starts reconstruction, uploads, stages, publishes, or serializes the supplied absolute paths.",
  "",
  "Exit 0: eligible only to open LCC's resource estimator.",
  "Entrypoint exit 2: safe blocked receipt; pnpm may normalize it to wrapper exit 1.",
  "Exit 1: integrity or invocation failure; no receipt was issued.",
].join("\n");

export interface GrandHallXgridsLccPreflightCliArguments {
  readonly sourceRoot: string;
  readonly scratchRoot: string;
  readonly lccInstallRoot: string;
}

export interface GrandHallXgridsLccPreflightCliDependencies {
  readonly verifySource?: (sourceRoot: string) => Promise<GrandHallXgridsVerifiedSourceV1>;
  readonly collectMachine?: (input: {
    readonly scratchRoot: string;
    readonly lccInstallRoot: string;
  }) => Promise<GrandHallXgridsMachineObservationV1>;
  readonly createReceipt?: (
    source: GrandHallXgridsVerifiedSourceV1,
    machine: GrandHallXgridsMachineObservationV1,
  ) => GrandHallXgridsLccPreflightReceiptV1;
  readonly write: (text: string) => void;
}

const INVALID_INVOCATION_MESSAGE = "Invalid Grand Hall XGRIDS preflight invocation.";

function invalidInvocation(): never {
  throw new Error(INVALID_INVOCATION_MESSAGE);
}

/**
 * Formats fatal CLI failures without reflecting argv, filesystem paths, child-process output,
 * exception messages, or exception causes. Error codes are closed internal literals.
 */
export function formatGrandHallXgridsLccPreflightFailure(error: unknown): string {
  const code = error instanceof GrandHallXgridsPreflightError
    ? error.code
    : "INTERNAL_OR_INVOCATION_FAILURE";
  return [
    `Grand Hall XGRIDS preflight stopped safely (${code}). No receipt was issued.`,
    "",
    GRAND_HALL_XGRIDS_LCC_PREFLIGHT_USAGE,
    "",
  ].join("\n");
}

export function parseGrandHallXgridsLccPreflightArguments(
  arguments_: readonly string[],
): GrandHallXgridsLccPreflightCliArguments | null {
  if (
    arguments_.length === 0 ||
    (arguments_.length === 1 && (arguments_[0] === "--help" || arguments_[0] === "-h"))
  ) return null;
  if (arguments_.length % 2 !== 0) {
    return invalidInvocation();
  }
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (
      flag === undefined || value === undefined ||
      !["--source", "--scratch", "--lcc-install"].includes(flag) ||
      !flag.startsWith("--") || value.startsWith("--") || value.trim().length === 0
    ) {
      return invalidInvocation();
    }
    if (values.has(flag)) return invalidInvocation();
    values.set(flag, value);
  }
  const sourceRoot = values.get("--source");
  const scratchRoot = values.get("--scratch");
  const lccInstallRoot = values.get("--lcc-install");
  if (sourceRoot === undefined || scratchRoot === undefined || lccInstallRoot === undefined) {
    return invalidInvocation();
  }
  return Object.freeze({ sourceRoot, scratchRoot, lccInstallRoot });
}

export async function runGrandHallXgridsLccPreflightCli(
  arguments_: readonly string[],
  dependencies: GrandHallXgridsLccPreflightCliDependencies,
): Promise<0 | 2> {
  const parsed = parseGrandHallXgridsLccPreflightArguments(arguments_);
  if (parsed === null) {
    dependencies.write(`${GRAND_HALL_XGRIDS_LCC_PREFLIGHT_USAGE}\n`);
    return 0;
  }
  const source = await (dependencies.verifySource ?? ((sourceRoot) =>
    verifyGrandHallXgridsSource({ sourceRoot })))(parsed.sourceRoot);
  const machine = await (dependencies.collectMachine ?? collectGrandHallWindowsMachineObservation)({
    scratchRoot: parsed.scratchRoot,
    lccInstallRoot: parsed.lccInstallRoot,
  });
  const receipt = (dependencies.createReceipt ?? createGrandHallXgridsLccPreflightReceipt)(
    source,
    machine,
  );
  dependencies.write(`${JSON.stringify(receipt, null, 2)}\n`);
  return receipt.decision.status === "eligible_for_lcc_estimator_only" ? 0 : 2;
}
