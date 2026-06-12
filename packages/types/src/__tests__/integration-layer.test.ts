import { describe, expect, it } from "vitest";
import {
  IntegrationConnectionRecordSchema,
  WebsiteEmbedConfigSchema,
  clientSafeWebsiteEmbedConfig,
  integrationPayloadHash,
  redactIntegrationConnection,
} from "../integration-layer.js";

const VENUE_ID = "00000000-0000-4000-8000-000000006001";
const ROOM_ID = "00000000-0000-4000-8000-000000006002";
const USER_ID = "00000000-0000-4000-8000-000000006003";
const NOW = "2026-06-12T14:00:00.000Z";

describe("integration layer contracts", () => {
  it("redacts credential references from public connection output", () => {
    const record = IntegrationConnectionRecordSchema.parse({
      id: "00000000-0000-4000-8000-000000006010",
      venueId: VENUE_ID,
      provider: "salesforce",
      label: "Salesforce CRM",
      status: "pending_setup",
      credentialMode: "env_ref",
      credentialRef: "SALESFORCE_API_KEY",
      config: { object: "Lead" },
      healthStatus: "Not connected",
      lastCheckedAt: null,
      createdBy: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const publicRecord = redactIntegrationConnection(record);
    expect(publicRecord.credentialConfigured).toBe(true);
    expect(JSON.stringify(publicRecord)).not.toContain("SALESFORCE_API_KEY");
  });

  it("builds a client-safe website embed shape without internal IDs", () => {
    const record = WebsiteEmbedConfigSchema.parse({
      id: "00000000-0000-4000-8000-000000006020",
      venueId: VENUE_ID,
      roomId: ROOM_ID,
      embedKey: "trades-grand-hall",
      venueName: "Trades Hall",
      roomName: "Grand Hall",
      ctaLabel: "Enquire with the venue team",
      ctaUrl: "https://example.com/enquire",
      safeMode: true,
      analyticsMode: "stub",
      status: "draft",
      createdBy: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const safe = clientSafeWebsiteEmbedConfig(record);
    expect(safe).toMatchObject({
      venue: "Trades Hall",
      room: "Grand Hall",
      safeMode: true,
      analytics: { mode: "stub", enabled: false },
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(VENUE_ID);
    expect(serialized).not.toContain(ROOM_ID);
    expect(serialized).not.toContain("createdBy");
  });

  it("hashes webhook payloads deterministically", () => {
    const left = integrationPayloadHash({ event: "lead.created", count: 1 });
    const right = integrationPayloadHash({ count: 1, event: "lead.created" });
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });
});
