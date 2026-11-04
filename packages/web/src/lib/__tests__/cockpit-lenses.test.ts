import { describe, expect, it } from "vitest";
import { USER_ROLES, type UserRole } from "@omnitwin/types";
import { COCKPIT_MODES, type CockpitMode } from "../cockpit-modes.js";
import {
  lensAudienceOf,
  lensesFor,
  shownLens,
  VENUE_TOOLS_LABEL,
  type LensAudience,
  type LensKeys,
  type LensLayout,
  type LensRail,
  type LensViewer,
} from "../cockpit-lenses.js";

// Blake's decision 5: which lenses each viewer sees, under each of the two keys.

const ALL: readonly CockpitMode[] = ["design", "guests", "flow", "evidence", "lighting", "power", "rigging", "av", "ops", "costs", "share"];
const CLIENT_FOUR: readonly CockpitMode[] = ["design", "guests", "costs", "share"];
const HALLKEEPER_FOUR: readonly CockpitMode[] = ["design", "guests", "ops", "evidence"];
const VENUE_TOOLS: readonly CockpitMode[] = ["flow", "evidence", "lighting", "power", "rigging", "av", "ops"];

/** Every venue role, decided here: a role added to USER_ROLES fails to compile until it has an answer. */
const AUDIENCE_BY_ROLE: Readonly<Record<UserRole, LensAudience>> = {
  client: "client-side",
  planner: "client-side",
  caterer: "client-side",
  hallkeeper: "hallkeeper",
  staff: "venue-team",
  admin: "venue-team",
  manager: "venue-team",
  sales: "venue-team",
};

function signedIn(role: string, platformRole = "none", venueId: string | null = "venue-1"): LensViewer {
  return { isLoading: false, isAuthenticated: true, user: { role, platformRole, venueId } };
}

const ANONYMOUS: LensViewer = { isLoading: false, isAuthenticated: false, user: null };
const LOADING: LensViewer = { isLoading: true, isAuthenticated: false, user: null };
/** A re-check of a signed-in staff member: the user is still set, the answer is pending. */
const CHECKING_STAFF: LensViewer = { isLoading: true, isAuthenticated: true, user: { role: "staff", platformRole: "none", venueId: "venue-1" } };

/**
 * A layout open through the authenticated load, which passed the same gate as
 * Ops's compile, so the matrix keeps Ops wherever the role does. A shared
 * link's preview is the Ops cases' own.
 */
const OWN_LAYOUT: LensLayout = { venueId: "venue-1", isPublicPreview: false };

const VIEWERS: readonly { readonly name: string; readonly viewer: LensViewer; readonly audience: LensAudience }[] = [
  ...USER_ROLES.map((role) => ({ name: role, viewer: signedIn(role), audience: AUDIENCE_BY_ROLE[role] })),
  { name: "a platform admin whose venue role is planner", viewer: signedIn("planner", "admin"), audience: "venue-team" },
  { name: "a platform admin whose venue role is hallkeeper", viewer: signedIn("hallkeeper", "admin"), audience: "venue-team" },
  { name: "a platform operator whose venue role is planner", viewer: signedIn("planner", "operator"), audience: "client-side" },
  { name: "an unknown role", viewer: signedIn("unknown"), audience: "client-side" },
  { name: "an anonymous visitor to a shared link", viewer: ANONYMOUS, audience: "client-side" },
  { name: "an identity still loading", viewer: LOADING, audience: "client-side" },
  // A re-check keeps a known identity's lenses, so an open lens never jumps to Design mid-session.
  { name: "a staff identity being re-checked", viewer: CHECKING_STAFF, audience: "venue-team" },
];

const KEYS: readonly { readonly name: string; readonly keys: LensKeys }[] = [
  { name: "both off", keys: { lensesByRole: false, lensesDivider: false } },
  { name: "lensesByRole", keys: { lensesByRole: true, lensesDivider: false } },
  { name: "lensesDivider", keys: { lensesByRole: false, lensesDivider: true } },
  { name: "both on", keys: { lensesByRole: true, lensesDivider: true } },
];

interface Expected {
  readonly modes: readonly CockpitMode[];
  readonly named: boolean;
  /** The lenses under the "Venue tools" divider, or null for no divider. */
  readonly venueTools: readonly CockpitMode[] | null;
}

const TODAY: Expected = { modes: ALL, named: false, venueTools: null };
const DIVIDED: Expected = { modes: [...CLIENT_FOUR, ...VENUE_TOOLS], named: true, venueTools: VENUE_TOOLS };

function expected(audience: LensAudience, keys: LensKeys): Expected {
  if (!keys.lensesByRole && !keys.lensesDivider) return TODAY;
  if (keys.lensesByRole && audience === "client-side") return { modes: CLIENT_FOUR, named: true, venueTools: null };
  if (keys.lensesByRole && audience === "hallkeeper") return { modes: HALLKEEPER_FOUR, named: true, venueTools: null };
  if (keys.lensesDivider) return DIVIDED;
  return { modes: ALL, named: true, venueTools: null };
}

function venueToolsOf(lensRail: LensRail): readonly CockpitMode[] | null {
  const divided = lensRail.sections.filter((section) => section.label !== null);
  if (divided.length === 0) return null;
  expect(divided).toHaveLength(1);
  expect(divided[0]?.label).toBe(VENUE_TOOLS_LABEL);
  return divided[0]?.lenses.map((lens) => lens.id) ?? null;
}

describe("lensAudienceOf", () => {
  it.each(VIEWERS)("puts $name with the $audience", ({ viewer, audience }) => {
    expect(lensAudienceOf(viewer)).toBe(audience);
  });
});

describe("lensesFor: the whole matrix", () => {
  for (const { name: keysName, keys } of KEYS) {
    describe(keysName, () => {
      it.each(VIEWERS)("gives $name the expected rail", ({ viewer, audience }) => {
        const lensRail = lensesFor(viewer, keys, OWN_LAYOUT);
        const want = expected(audience, keys);
        expect(lensRail.modes).toEqual(want.modes);
        expect(lensRail.named).toBe(want.named);
        expect(venueToolsOf(lensRail)).toEqual(want.venueTools);
        // The sections draw exactly the offered lenses, in order, each once.
        expect(lensRail.sections.flatMap((section) => section.lenses.map((lens) => lens.id))).toEqual(want.modes);
        expect(new Set(lensRail.modes).size).toBe(lensRail.modes.length);
        // Design is the fallback, so every rail offers it.
        expect(lensRail.modes).toContain("design");
      });
    });
  }

  it("keeps today's rail exactly when both keys are off: eleven, unnamed, COCKPIT_MODES order", () => {
    for (const { viewer } of VIEWERS) {
      const lensRail = lensesFor(viewer, { lensesByRole: false, lensesDivider: false }, OWN_LAYOUT);
      expect(lensRail.modes).toEqual(COCKPIT_MODES.map((mode) => mode.id));
      expect(lensRail.sections).toEqual([{ label: null, lenses: COCKPIT_MODES }]);
    }
  });

  it("loses no lens to the divider: the divided rail is the eleven, reordered", () => {
    const lensRail = lensesFor(signedIn("staff"), { lensesByRole: true, lensesDivider: true }, OWN_LAYOUT);
    expect([...lensRail.modes].sort((a, b) => a.localeCompare(b))).toEqual([...ALL].sort((a, b) => a.localeCompare(b)));
  });

  it("gives the hallkeeper's own four no divider, though venue tools are among them", () => {
    const lensRail = lensesFor(signedIn("hallkeeper"), { lensesByRole: true, lensesDivider: true }, OWN_LAYOUT);
    expect(lensRail.sections).toHaveLength(1);
    expect(lensRail.sections[0]?.label).toBeNull();
  });

  it("names each lens with its COCKPIT_MODES label", () => {
    const lensRail = lensesFor(signedIn("staff"), { lensesByRole: true, lensesDivider: true }, OWN_LAYOUT);
    for (const lens of lensRail.sections.flatMap((section) => section.lenses)) {
      expect(lens.label).toBe(COCKPIT_MODES.find((mode) => mode.id === lens.id)?.label);
    }
  });

  it("answers with one constant per rail, so a store selector sees no change until the answer changes", () => {
    for (const { keys } of KEYS) {
      expect(lensesFor(signedIn("client"), keys, OWN_LAYOUT)).toBe(lensesFor(ANONYMOUS, keys, OWN_LAYOUT));
      expect(lensesFor(signedIn("staff"), keys, OWN_LAYOUT)).toBe(lensesFor(signedIn("manager"), keys, OWN_LAYOUT));
    }
  });
});

describe("lensesFor: Ops only where its compile would be answered", () => {
  // POST /ops/handoff-packs/from-configuration/:id reads canAccessResource:
  // the layout's owner, the venue floor at its venue (canManageVenue) or a
  // platform admin. A shared link's public preview has no owner.
  const SHARED_PREVIEW: LensLayout = { venueId: "venue-1", isPublicPreview: true };
  const BY_ROLE: LensKeys = { lensesByRole: true, lensesDivider: false };

  it.each([
    { name: "the venue's staff", viewer: signedIn("staff"), ops: true },
    { name: "the venue's manager", viewer: signedIn("manager"), ops: true },
    { name: "the venue's admin", viewer: signedIn("admin"), ops: true },
    { name: "the venue's hallkeeper", viewer: signedIn("hallkeeper"), ops: true },
    { name: "a platform admin with no venue", viewer: signedIn("planner", "admin", null), ops: true },
    { name: "the venue's sales, who are off its floor", viewer: signedIn("sales"), ops: false },
    { name: "another venue's staff", viewer: signedIn("staff", "none", "venue-2"), ops: false },
    { name: "another venue's hallkeeper", viewer: signedIn("hallkeeper", "none", "venue-2"), ops: false },
    { name: "staff still waiting for a venue", viewer: signedIn("staff", "none", null), ops: false },
    { name: "a staff identity being re-checked", viewer: CHECKING_STAFF, ops: true },
  ])("on a shared link's preview, offers $name Ops only if it compiles ($ops)", ({ viewer, ops }) => {
    expect(lensesFor(viewer, BY_ROLE, SHARED_PREVIEW).modes.includes("ops")).toBe(ops);
  });

  it("offers Ops on any layout open through the authenticated load, which passed the compile's own gate", () => {
    for (const viewer of [signedIn("sales"), signedIn("staff", "none", "venue-2"), signedIn("hallkeeper", "none", null)]) {
      expect(lensesFor(viewer, BY_ROLE, OWN_LAYOUT).modes).toContain("ops");
    }
  });

  it("takes only Ops away: the rest of each rail stands, in order, under the divider too", () => {
    expect(lensesFor(signedIn("sales"), BY_ROLE, SHARED_PREVIEW).modes).toEqual(ALL.filter((mode) => mode !== "ops"));
    expect(lensesFor(signedIn("hallkeeper", "none", "venue-2"), BY_ROLE, SHARED_PREVIEW).modes).toEqual(["design", "guests", "evidence"]);
    const divided = lensesFor(signedIn("sales"), { lensesByRole: true, lensesDivider: true }, SHARED_PREVIEW);
    expect(divided.modes).toEqual([...CLIENT_FOUR, ...VENUE_TOOLS.filter((mode) => mode !== "ops")]);
    expect(venueToolsOf(divided)).toEqual(VENUE_TOOLS.filter((mode) => mode !== "ops"));
  });

  it("keeps today's rails, Ops in them, while lensesByRole is off: the way back is unchanged", () => {
    expect(lensesFor(signedIn("sales"), { lensesByRole: false, lensesDivider: false }, SHARED_PREVIEW).modes).toEqual(ALL);
    expect(lensesFor(signedIn("sales"), { lensesByRole: false, lensesDivider: true }, SHARED_PREVIEW).modes).toContain("ops");
  });

  it("answers with one constant per rail without Ops too", () => {
    expect(lensesFor(signedIn("sales"), BY_ROLE, SHARED_PREVIEW)).toBe(lensesFor(signedIn("staff", "none", "venue-2"), BY_ROLE, SHARED_PREVIEW));
  });
});

describe("shownLens", () => {
  const clientRail = lensesFor(signedIn("client"), { lensesByRole: true, lensesDivider: false }, OWN_LAYOUT);

  it("shows the active lens when the rail offers it", () => {
    expect(shownLens("costs", clientRail)).toBe("costs");
  });

  it("shows Design for an active lens the viewer is not offered (a persisted Rigging, say)", () => {
    expect(shownLens("rigging", clientRail)).toBe("design");
    expect(shownLens("ops", clientRail)).toBe("design");
  });

  it("changes nothing while the keys are off", () => {
    expect(shownLens("rigging", lensesFor(signedIn("client"), { lensesByRole: false, lensesDivider: false }, OWN_LAYOUT))).toBe("rigging");
  });
});
