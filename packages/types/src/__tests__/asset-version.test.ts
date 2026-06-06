import { describe, it, expect } from "vitest";
import {
  splatExtensionForKey,
  isForbiddenAssetFixtureKey,
  RegisterAssetVersionInputSchema,
  AssetVersionSchema,
  RuntimePackageSchema,
} from "../asset-version.js";

const VENUE_ID = "00000000-0000-0000-0000-000000000001";
const SHA = "a".repeat(64);
const validKey = "private/venues/trades-hall/runtime/grand-hall/scene.spz";

const validInput = {
  venueId: VENUE_ID,
  source: "runpod" as const,
  r2Key: validKey,
  sha256: SHA,
  captureDate: "2026-06-01",
};

describe("splatExtensionForKey", () => {
  it("returns the extension for every supported splat container", () => {
    expect(splatExtensionForKey("a/b/scene.ply")).toBe(".ply");
    expect(splatExtensionForKey("a/b/scene.spz")).toBe(".spz");
    expect(splatExtensionForKey("a/SCENE.SPLAT")).toBe(".splat");
    expect(splatExtensionForKey("a/scene.ksplat")).toBe(".ksplat");
    expect(splatExtensionForKey("a/scene.rad")).toBe(".rad");
    expect(splatExtensionForKey("a/scene.radc")).toBe(".radc");
  });

  it("returns null for non-splat keys", () => {
    expect(splatExtensionForKey("a/b/scene.png")).toBeNull();
    expect(splatExtensionForKey("a/b/scene")).toBeNull();
  });
});

describe("isForbiddenAssetFixtureKey", () => {
  it("flags fixture/demo markers regardless of case", () => {
    expect(isForbiddenAssetFixtureKey("dev/Splat-Fixture/scene.spz")).toBe(true);
    expect(isForbiddenAssetFixtureKey("dev/textsplats/x.ply")).toBe(true);
    expect(isForbiddenAssetFixtureKey("a/spark-fixture/y.splat")).toBe(true);
  });

  it("passes clean runtime keys", () => {
    expect(isForbiddenAssetFixtureKey(validKey)).toBe(false);
  });
});

describe("RegisterAssetVersionInputSchema", () => {
  it("accepts a valid payload and applies safe defaults", () => {
    const parsed = RegisterAssetVersionInputSchema.parse(validInput);
    expect(parsed.evidenceStatus).toBe("unverified");
    expect(parsed.publish).toBe(false);
  });

  it("rejects a fixture/demo asset key", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validInput,
      r2Key: "dev/splat-fixture/scene.spz",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-splat extension", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({ ...validInput, r2Key: "a/b/scene.png" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed sha256", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({ ...validInput, sha256: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO capture date", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({ ...validInput, captureDate: "01/06/2026" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown source", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({ ...validInput, source: "polycam" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown evidence status", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({ ...validInput, evidenceStatus: "certified" });
    expect(result.success).toBe(false);
  });
});

describe("response schemas", () => {
  const assetVersion = {
    id: "av1", venueId: VENUE_ID, spaceId: null, source: "runpod", r2Key: validKey,
    splatExtension: ".spz", sha256: SHA, captureDate: "2026-06-01", evidenceStatus: "machine_checked",
    sizeBytes: 1024, label: "Grand Hall v1", createdBy: "u1", createdAt: "2026-06-06T10:00:00.000Z",
  };

  it("parses a valid AssetVersion", () => {
    expect(AssetVersionSchema.parse(assetVersion).evidenceStatus).toBe("machine_checked");
  });

  it("rejects an AssetVersion with an invalid evidence status", () => {
    expect(AssetVersionSchema.safeParse({ ...assetVersion, evidenceStatus: "approved" }).success).toBe(false);
  });

  it("parses a valid RuntimePackage with nested asset version and resolved url", () => {
    const pkg = RuntimePackageSchema.parse({
      id: "rp1", venueId: VENUE_ID, spaceId: null, assetVersionId: "av1", status: "published",
      label: null, publishedAt: "2026-06-06T10:00:00.000Z", createdAt: "2026-06-06T10:00:00.000Z",
      assetVersion, assetUrl: "https://assets.example/scene.spz",
    });
    expect(pkg.status).toBe("published");
    expect(pkg.assetVersion.evidenceStatus).toBe("machine_checked");
  });
});
