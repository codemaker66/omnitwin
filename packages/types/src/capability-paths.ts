// ---------------------------------------------------------------------------
// Capability paths: urls whose next segment opens something to whoever holds
// it. A proposal's share token reads and approves the proposal; a supplier's
// or a view-only plan's token is its whole lock; a legacy proposal share code
// answers the proposal; an unclaimed guest layout's id opens and overwrites
// it through the public routes. Error reports, breadcrumbs, spans and request
// logs keep the route and lose that segment, which becomes ":token". Paths
// such as /dashboard/proposals are left alone.
//
// A layout's id is also the segment after /configurations/ (the claim, the
// planner's own reads and saves, its live channel), /hallkeeper/ and
// /blueprint/: there it is templated when it is an id (a uuid), so the
// routes named in words (/configurations/summaries, /hallkeeper/today) stay.
// ---------------------------------------------------------------------------

/** The path prefixes, without slashes, whose next segment is a capability. */
export const CAPABILITY_PATH_PREFIXES: readonly string[] = [
  "proposal-share",
  "supplier-share",
  "plan-view",
  "proposal",
  "plan",
  "public/plan-views",
  "public/proposals",
  "public/configurations",
];

/** The path prefixes whose next segment is a layout's id when it is a uuid. */
export const LAYOUT_ID_PATH_PREFIXES: readonly string[] = ["configurations", "hallkeeper", "blueprint"];

/** What a capability segment reads as once templated. */
export const CAPABILITY_SEGMENT_MARKER = ":token";

function alternation(prefixes: readonly string[]): string {
  return prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
}

// The prefix must start a path segment and be followed by "/", so
// /floor-plan/x, /plan-views/x and /proposals/x are not mistaken for one.
// The segment stops where a path, query, fragment, quote, bracket or
// separator would, so text around a url (and a JSON string's escapes) stays.
// Case-insensitive, as the router matches paths: /Proposal-Share/x opens it.
const SEGMENT_END = "/?#\\s\"'`<>()[\\]{},;\\\\";
const CAPABILITY_SEGMENT = new RegExp(
  `(/(?:${alternation(CAPABILITY_PATH_PREFIXES)})/)[^${SEGMENT_END}]+`,
  "giu",
);
const LAYOUT_ID_SEGMENT = new RegExp(
  `(/(?:${alternation(LAYOUT_ID_PATH_PREFIXES)})/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=[${SEGMENT_END}]|$)`,
  "giu",
);

/** The same text with every capability segment in it replaced by ":token". */
export function templateCapabilityPaths(text: string): string {
  return text
    .replace(CAPABILITY_SEGMENT, `$1${CAPABILITY_SEGMENT_MARKER}`)
    .replace(LAYOUT_ID_SEGMENT, `$1${CAPABILITY_SEGMENT_MARKER}`);
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function templateValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return templateCapabilityPaths(value);
  if (typeof value !== "object" || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(templateValue(item, seen));
    return copy;
  }

  // Class instances (a date, a request, a stream) are left as they are;
  // only plain data is walked.
  if (!isPlainRecord(value)) return value;

  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = templateValue(item, seen);
  return copy;
}

/**
 * A copy of plain data (an error report, a transaction, a breadcrumb) with
 * every capability segment in every string templated, at any depth. Never
 * mutates its input; safe on cycles. The copy has the input's shape.
 */
export function templateCapabilityPathsDeep<T>(value: T): T {
  return templateValue(value, new WeakMap()) as T;
}
