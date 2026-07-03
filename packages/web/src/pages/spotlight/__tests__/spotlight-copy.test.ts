import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { RETURN_CTA_HREF } from "../../landing/rite-copy.js";
import {
  SPOTLIGHT_BASE_IMAGE,
  SPOTLIGHT_CTA_HREF,
  SPOTLIGHT_NAV_LINKS,
  SPOTLIGHT_REVEAL_IMAGE,
  allSpotlightCopy,
} from "../spotlight-copy.js";

describe("spotlight-copy — claim safety", () => {
  it("holds the entire script to the claim guard", () => {
    for (const line of allSpotlightCopy()) {
      expect(
        findUnsupportedProposalClaim(line),
        `unsupported claim in: "${line}"`,
      ).toBeNull();
    }
  });
});

describe("spotlight-copy — one door into the planner", () => {
  it("shares the rite's planner entry, so the CTA can never drift", () => {
    expect(SPOTLIGHT_CTA_HREF).toBe(RETURN_CTA_HREF);
    expect(SPOTLIGHT_CTA_HREF).toBe("/plan?space=grand-hall");
  });
});

describe("spotlight-copy — assets and routes", () => {
  it("uses the two Grand Hall photographs: dark base, dressed reveal", () => {
    expect(SPOTLIGHT_BASE_IMAGE).toBe("/images/venue/grand-hall-dark.jpg");
    expect(SPOTLIGHT_REVEAL_IMAGE).toBe("/images/venue/grand-hall-room.jpg");
    expect(SPOTLIGHT_BASE_IMAGE).not.toBe(SPOTLIGHT_REVEAL_IMAGE);
  });

  it("gives every nav link a label and a destination", () => {
    expect(SPOTLIGHT_NAV_LINKS.length).toBeGreaterThanOrEqual(3);
    for (const link of SPOTLIGHT_NAV_LINKS) {
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.href.startsWith("/")).toBe(true);
    }
    expect(SPOTLIGHT_NAV_LINKS.filter((l) => l.current)).toHaveLength(1);
  });
});
