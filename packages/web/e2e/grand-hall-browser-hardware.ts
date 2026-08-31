import { chromium, type Page } from "@playwright/test";

export const GRAND_HALL_HARDWARE_BROWSER_PROFILE_ENV =
  "GRAND_HALL_LINEAGE_BROWSER_PROFILE_V1";
export const GRAND_HALL_HARDWARE_BROWSER_PROFILE_SCHEMA =
  "venviewer.grand-hall.hardware-browser-profile.v1";
export const GRAND_HALL_HARDWARE_PREFLIGHT_MARKER =
  "VENVIEWER_BROWSER_HARDWARE_PREFLIGHT_V1:";

const BROWSER_PROBE_TIMEOUT_MS = 15_000;
const SOFTWARE_WEBGL_MARKERS = Object.freeze([
  "swiftshader",
  "llvmpipe",
  "softpipe",
  "software rasterizer",
  "microsoft basic render driver",
  "mesa offscreen",
] as const);
const HARDWARE_WEBGL_MARKERS = Object.freeze([
  "nvidia",
  "geforce",
  "amd",
  "radeon",
  "intel",
  "apple gpu",
  "adreno",
  "qualcomm",
  "mali",
  "powervr",
] as const);
const PROFILE_KEYS = Object.freeze([
  "schemaVersion",
  "candidateId",
  "browserName",
  "channel",
  "headless",
  "launchArgs",
  "browserVersion",
  "userAgent",
  "webglVendor",
  "webglRenderer",
  "webglVersion",
  "contextLost",
  "probeDurationMs",
] as const);

export const GRAND_HALL_HARDWARE_LAUNCH_ARGUMENTS = Object.freeze([
  "--use-angle=d3d11",
  "--disable-software-rasterizer",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--force-device-scale-factor=1",
] as const);

export interface GrandHallHardwareBrowserCandidate {
  readonly candidateId: string;
  readonly browserName: "chromium";
  readonly channel: "chrome" | "msedge";
  readonly headless: boolean;
  readonly launchArgs: readonly string[];
}

function browserCandidate(
  candidateId: string,
  channel: GrandHallHardwareBrowserCandidate["channel"],
  headless: boolean,
): GrandHallHardwareBrowserCandidate {
  return Object.freeze({
    candidateId,
    browserName: "chromium",
    channel,
    headless,
    launchArgs: GRAND_HALL_HARDWARE_LAUNCH_ARGUMENTS,
  });
}

export const GRAND_HALL_HARDWARE_BROWSER_CANDIDATES = Object.freeze([
  browserCandidate("chrome-stable-headless-d3d11", "chrome", true),
  browserCandidate("chrome-stable-headed-d3d11", "chrome", false),
  browserCandidate("edge-stable-headless-d3d11", "msedge", true),
  browserCandidate("edge-stable-headed-d3d11", "msedge", false),
] as const);

export interface GrandHallWebGlEvidence {
  readonly userAgent: string;
  readonly webglVendor: string;
  readonly webglRenderer: string;
  readonly webglVersion: string;
  readonly contextLost: boolean;
}

export interface GrandHallHardwareProbeEvidence extends GrandHallWebGlEvidence {
  readonly browserVersion: string;
  readonly probeDurationMs: number;
}

export interface GrandHallHardwareBrowserProfileV1 extends GrandHallHardwareProbeEvidence {
  readonly schemaVersion: typeof GRAND_HALL_HARDWARE_BROWSER_PROFILE_SCHEMA;
  readonly candidateId: string;
  readonly browserName: "chromium";
  readonly channel: "chrome" | "msedge";
  readonly headless: boolean;
  readonly launchArgs: readonly string[];
}

export interface GrandHallHardwareBrowserProbeAttempt {
  readonly candidate: GrandHallHardwareBrowserCandidate;
  readonly outcome:
    | "launch_failed"
    | "rejected_software"
    | "rejected_unknown"
    | "selected_hardware";
  readonly evidence?: GrandHallHardwareProbeEvidence;
  readonly error?: string;
}

export interface GrandHallHardwareBrowserSelection {
  readonly profile: GrandHallHardwareBrowserProfileV1;
  readonly attempts: readonly GrandHallHardwareBrowserProbeAttempt[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Hardware browser profile field ${key} must be a non-empty string.`);
  }
  return value;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function classifyWebGlRenderer(vendor: string, renderer: string): "hardware" | "software" | "unknown" {
  const identity = `${vendor} ${renderer}`.toLowerCase();
  if (SOFTWARE_WEBGL_MARKERS.some((marker) => identity.includes(marker))) return "software";
  if (HARDWARE_WEBGL_MARKERS.some((marker) => identity.includes(marker))) return "hardware";
  return "unknown";
}

function matchingCandidate(
  profile: Readonly<Record<string, unknown>>,
): GrandHallHardwareBrowserCandidate | undefined {
  const launchArgs = profile["launchArgs"];
  if (!Array.isArray(launchArgs) || launchArgs.some((value) => typeof value !== "string")) {
    return undefined;
  }
  return GRAND_HALL_HARDWARE_BROWSER_CANDIDATES.find((candidate) =>
    profile["candidateId"] === candidate.candidateId
    && profile["browserName"] === candidate.browserName
    && profile["channel"] === candidate.channel
    && profile["headless"] === candidate.headless
    && arraysEqual(launchArgs, candidate.launchArgs));
}

function profileFromEvidence(
  candidate: GrandHallHardwareBrowserCandidate,
  evidence: GrandHallHardwareProbeEvidence,
): GrandHallHardwareBrowserProfileV1 {
  const profile = {
    schemaVersion: GRAND_HALL_HARDWARE_BROWSER_PROFILE_SCHEMA,
    candidateId: candidate.candidateId,
    browserName: candidate.browserName,
    channel: candidate.channel,
    headless: candidate.headless,
    launchArgs: [...candidate.launchArgs],
    browserVersion: evidence.browserVersion,
    userAgent: evidence.userAgent,
    webglVendor: evidence.webglVendor,
    webglRenderer: evidence.webglRenderer,
    webglVersion: evidence.webglVersion,
    contextLost: evidence.contextLost,
    probeDurationMs: evidence.probeDurationMs,
  } as const;
  return parseGrandHallHardwareBrowserProfile(JSON.stringify(profile));
}

export async function readGrandHallWebGlEvidence(page: Page): Promise<GrandHallWebGlEvidence> {
  await page.setContent(
    '<!doctype html><canvas id="venviewer-webgl-probe" width="16" height="16"></canvas>',
    { waitUntil: "load", timeout: BROWSER_PROBE_TIMEOUT_MS },
  );
  return page.locator("#venviewer-webgl-probe").evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("WebGL probe is not a canvas.");
    const gl = element.getContext("webgl2") ?? element.getContext("webgl");
    if (gl === null) throw new Error("Hardware preflight could not create a WebGL context.");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      webglVendor: debug === null
        ? String(gl.getParameter(gl.VENDOR))
        : String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
      webglRenderer: debug === null
        ? String(gl.getParameter(gl.RENDERER))
        : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
      webglVersion: String(gl.getParameter(gl.VERSION)),
      contextLost: gl.isContextLost(),
    };
  });
}

export async function probeGrandHallHardwareBrowserCandidate(
  candidate: GrandHallHardwareBrowserCandidate,
): Promise<GrandHallHardwareProbeEvidence> {
  const startedAt = Date.now();
  const browser = await chromium.launch({
    channel: candidate.channel,
    headless: candidate.headless,
    args: [...candidate.launchArgs],
    timeout: BROWSER_PROBE_TIMEOUT_MS,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 64, height: 64 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const evidence = await readGrandHallWebGlEvidence(page);
    return {
      browserVersion: browser.version(),
      ...evidence,
      probeDurationMs: Date.now() - startedAt,
    };
  } finally {
    await browser.close();
  }
}

export function assertGrandHallHardwareEvidenceMatchesProfile(
  profile: GrandHallHardwareBrowserProfileV1,
  evidence: GrandHallWebGlEvidence,
): void {
  const rendererClass = classifyWebGlRenderer(evidence.webglVendor, evidence.webglRenderer);
  if (rendererClass !== "hardware" || evidence.contextLost) {
    throw new Error(
      `Grand Hall browser requires explicit hardware WebGL; classified ${rendererClass}: ${evidence.webglVendor} / ${evidence.webglRenderer}`,
    );
  }
  if (
    evidence.userAgent !== profile.userAgent
    || evidence.webglVendor !== profile.webglVendor
    || evidence.webglRenderer !== profile.webglRenderer
    || evidence.webglVersion !== profile.webglVersion
  ) {
    throw new Error("Grand Hall worker WebGL identity deviates from its selected launch preflight.");
  }
}

export function assertGrandHallBrowserVersionMatchesProfile(
  profile: GrandHallHardwareBrowserProfileV1,
  browserVersion: string,
): void {
  if (browserVersion !== profile.browserVersion) {
    throw new Error(
      `Grand Hall worker browser version ${browserVersion} deviates from selected ${profile.browserVersion}.`,
    );
  }
}

export async function selectGrandHallHardwareBrowserProfile(
  candidates: readonly GrandHallHardwareBrowserCandidate[] = GRAND_HALL_HARDWARE_BROWSER_CANDIDATES,
  probe: (
    candidate: GrandHallHardwareBrowserCandidate,
  ) => Promise<GrandHallHardwareProbeEvidence> = probeGrandHallHardwareBrowserCandidate,
): Promise<GrandHallHardwareBrowserSelection> {
  const attempts: GrandHallHardwareBrowserProbeAttempt[] = [];
  for (const candidate of candidates) {
    try {
      const evidence = await probe(candidate);
      const rendererClass = classifyWebGlRenderer(evidence.webglVendor, evidence.webglRenderer);
      if (rendererClass === "hardware" && !evidence.contextLost) {
        attempts.push({ candidate, outcome: "selected_hardware", evidence });
        return { profile: profileFromEvidence(candidate, evidence), attempts };
      }
      attempts.push({
        candidate,
        outcome: rendererClass === "software" ? "rejected_software" : "rejected_unknown",
        evidence,
      });
    } catch (error: unknown) {
      attempts.push({
        candidate,
        outcome: "launch_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw new Error(
    `Grand Hall hardware browser preflight failed: no candidate produced explicit hardware WebGL. ${JSON.stringify(attempts)}`,
  );
}

export function serializeGrandHallHardwareBrowserProfile(
  profile: GrandHallHardwareBrowserProfileV1,
): string {
  const serialized = JSON.stringify(profile);
  parseGrandHallHardwareBrowserProfile(serialized);
  return serialized;
}

export function parseGrandHallHardwareBrowserProfile(
  serialized: string,
): GrandHallHardwareBrowserProfileV1 {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed) || !arraysEqual(Object.keys(parsed).sort(), [...PROFILE_KEYS].sort())) {
    throw new Error("Hardware browser profile must contain exactly the v1 fields.");
  }
  const candidate = matchingCandidate(parsed);
  if (candidate === undefined) {
    throw new Error("Hardware browser profile does not match a known fail-closed launch candidate.");
  }
  const contextLost = parsed["contextLost"];
  const probeDurationMs = parsed["probeDurationMs"];
  const schemaVersion = requiredString(parsed, "schemaVersion");
  if (schemaVersion !== GRAND_HALL_HARDWARE_BROWSER_PROFILE_SCHEMA) {
    throw new Error("Hardware browser profile schema is invalid.");
  }
  const profile: GrandHallHardwareBrowserProfileV1 = {
    schemaVersion: GRAND_HALL_HARDWARE_BROWSER_PROFILE_SCHEMA,
    candidateId: candidate.candidateId,
    browserName: candidate.browserName,
    channel: candidate.channel,
    headless: candidate.headless,
    launchArgs: [...candidate.launchArgs],
    browserVersion: requiredString(parsed, "browserVersion"),
    userAgent: requiredString(parsed, "userAgent"),
    webglVendor: requiredString(parsed, "webglVendor"),
    webglRenderer: requiredString(parsed, "webglRenderer"),
    webglVersion: requiredString(parsed, "webglVersion"),
    contextLost: contextLost === false ? false : true,
    probeDurationMs: typeof probeDurationMs === "number" ? probeDurationMs : Number.NaN,
  };
  if (
    contextLost !== false
    || !Number.isInteger(profile.probeDurationMs)
    || profile.probeDurationMs < 0
  ) {
    throw new Error("Hardware browser profile schema, context state, or probe duration is invalid.");
  }
  assertGrandHallHardwareEvidenceMatchesProfile(profile, profile);
  return profile;
}

export function grandHallHardwarePreflightEvidenceMarker(input: {
  readonly profileSha256: string;
  readonly browserVersion: string;
}): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.profileSha256)) {
    throw new Error("Hardware browser profile SHA-256 is invalid.");
  }
  return `${GRAND_HALL_HARDWARE_PREFLIGHT_MARKER}${JSON.stringify({
    profileSha256: input.profileSha256,
    completedBeforeSourceNavigation: true,
    browserVersion: input.browserVersion,
  })}`;
}
