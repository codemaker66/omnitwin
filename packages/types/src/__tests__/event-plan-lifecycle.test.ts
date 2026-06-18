import { describe, expect, it } from "vitest";
import {
  ChangeFeedItemSchema,
  CreateHallkeeperAcknowledgementInputSchema,
  NotificationSchema,
  RecordEventPlanChangeInputSchema,
  RuntimeAssetStateSchema,
  type ChangeFeedItem,
  type Notification,
} from "../event-plan-lifecycle.js";

const NOW = "2026-06-18T09:00:00.000Z";
const EVENT_ID = "00000000-0000-4000-8000-000000004001";
const VENUE_ID = "00000000-0000-4000-8000-000000004002";
const CHANGE_ID = "00000000-0000-4000-8000-000000004003";
const USER_ID = "00000000-0000-4000-8000-000000004004";

function changeFixture(): ChangeFeedItem {
  return {
    id: CHANGE_ID,
    eventId: EVENT_ID,
    venueId: VENUE_ID,
    configurationId: "00000000-0000-4000-8000-000000004005",
    proposalId: "00000000-0000-4000-8000-000000004006",
    handoffPackId: null,
    actorUserId: USER_ID,
    actorRole: "staff",
    actorLabel: "Venue team",
    sourceKind: "proposal_response",
    sourceId: "proposal-share-response",
    title: "Client requested changes",
    summary: "Client asked for the dinner layout to support 130 guests. Human review is required before operations rely on the update.",
    beforeSummary: "120 guests",
    afterSummary: "130 guests requested",
    affectedSurfaces: ["guest_count", "proposal", "ops_tasks"],
    audienceRoles: ["staff", "hallkeeper"],
    riskLevel: "attention",
    requiresHallkeeperAcknowledgement: true,
    createdAt: NOW,
  };
}

describe("event plan lifecycle contracts", () => {
  it("accepts a cross-role change feed item for client edits that affect hallkeepers", () => {
    expect(ChangeFeedItemSchema.safeParse(changeFixture()).success).toBe(true);
  });

  it("requires every recorded change to name affected surfaces and audiences", () => {
    expect(RecordEventPlanChangeInputSchema.safeParse({
      eventId: EVENT_ID,
      venueId: VENUE_ID,
      actorRole: "client",
      actorLabel: "Client",
      sourceKind: "proposal_comment",
      sourceId: "comment-1",
      title: "Client comment",
      summary: "Could we move the bar away from the entrance?",
      affectedSurfaces: [],
      audienceRoles: ["staff"],
    }).success).toBe(false);
  });

  it("models per-user notification read state without making unsafe public claims", () => {
    const notification: Notification = {
      id: "00000000-0000-4000-8000-000000004007",
      changeId: CHANGE_ID,
      eventId: EVENT_ID,
      venueId: VENUE_ID,
      audienceRole: "hallkeeper",
      recipientUserId: null,
      title: "Plan changed since handoff",
      body: "Review the changed setup tasks before marking the room ready.",
      severity: "attention",
      actionPath: `/ops/events/${EVENT_ID}`,
      createdAt: NOW,
      readAt: null,
    };
    expect(NotificationSchema.safeParse(notification).success).toBe(true);
    expect(notification.body.toLowerCase()).not.toContain("certified safe");
  });

  it("requires a valid change id for hallkeeper acknowledgements", () => {
    expect(CreateHallkeeperAcknowledgementInputSchema.safeParse({
      changeId: "not-a-uuid",
      note: "Seen by setup lead.",
    }).success).toBe(false);
  });

  it("keeps the Reception Room SPZ visual staged and unverified until evidence signs it", () => {
    const state = RuntimeAssetStateSchema.parse({
      runtimePackageId: null,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      displayName: "Reception Room",
      visualAssetType: "spz",
      evidenceStatus: "unverified",
      runtimeStatus: "staged/internal",
      copy: "Runtime asset loaded, not yet verified/signed.",
    });
    expect(state.visualAssetType).toBe("spz");
    expect(state.copy).toBe("Runtime asset loaded, not yet verified/signed.");
  });
});
