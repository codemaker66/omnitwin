import { describe, expect, it } from "vitest";
import {
  IDENTITY_MATRIX4D,
  RUNTIME_VENUE_MANIFEST_V0_VERSION,
  RuntimeAssetUriSchema,
  RuntimeVenueManifestV0Schema,
  isRuntimeAssetUri,
  type RuntimeVenueManifestV0Input,
} from "../runtime-venue-manifest.js";

const VALID_MANIFEST_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const VALID_VENUE_ID = "33333333-3333-4333-8333-333333333333";
const VALID_SPACE_ID = "44444444-4444-4444-8444-444444444444";
const VALID_SHA256 = `sha256:${"a".repeat(64)}`;

function validManifest(overrides: Partial<RuntimeVenueManifestV0Input> = {}): RuntimeVenueManifestV0Input {
  return {
    schemaVersion: RUNTIME_VENUE_MANIFEST_V0_VERSION,
    manifestId: VALID_MANIFEST_ID,
    runtimePackageId: VALID_PACKAGE_ID,
    venueId: VALID_VENUE_ID,
    venueSlug: "trades-hall",
    spaceId: VALID_SPACE_ID,
    spaceSlug: "grand-hall",
    createdAt: "2026-04-30T12:00:00.000Z",
    units: "meters",
    coordinateSystem: "rhs_y_up_meters",
    bounds: {
      min: [-10.5, 0, -5.25],
      max: [10.5, 7, 5.25],
    },
    assets: [
      {
        id: "grand-hall-splat",
        role: "radiance",
        format: "spz",
        uri: "./assets/grand-hall.splat.spz",
        sha256: VALID_SHA256,
        byteLength: 123456,
        mimeType: "application/octet-stream",
      },
    ],
    layers: [
      {
        id: "grand-hall-splat-layer",
        kind: "gaussian_splat",
        renderer: "spark",
        assetId: "grand-hall-splat",
        format: "spz",
        coordinateSystem: "rhs_y_up_meters",
        transform: [...IDENTITY_MATRIX4D],
        visibleByDefault: true,
      },
    ],
    defaultLayerId: "grand-hall-splat-layer",
    ...overrides,
  };
}

describe("RuntimeAssetUriSchema", () => {
  it.each([
    "./assets/grand-hall.splat.spz",
    "../shared/grand-hall.ply",
    "/runtime/trades-hall/grand-hall.spz",
    "assets/grand-hall.glb",
    "dev://fixtures/trades-hall/grand-hall.spz",
    "r2://venviewer-runtime/trades-hall/grand-hall.spz",
    "https://cdn.example.com/trades-hall/grand-hall.spz",
  ])("accepts %s", (uri) => {
    expect(RuntimeAssetUriSchema.safeParse(uri).success).toBe(true);
    expect(isRuntimeAssetUri(uri)).toBe(true);
  });

  it.each([
    "",
    " ./assets/grand-hall.spz",
    "//cdn.example.com/grand-hall.spz",
    "javascript:alert(1)",
    "data:application/octet-stream;base64,AA==",
    "C:\\captures\\grand-hall.spz",
    "r2://bucket",
    "dev://fixture",
  ])("rejects %s", (uri) => {
    expect(RuntimeAssetUriSchema.safeParse(uri).success).toBe(false);
    expect(isRuntimeAssetUri(uri)).toBe(false);
  });
});

describe("RuntimeVenueManifestV0Schema", () => {
  it("accepts the first T-091A shape: one Spark gaussian splat layer with a relative asset reference", () => {
    const parsed = RuntimeVenueManifestV0Schema.parse(validManifest());

    expect(parsed.schemaVersion).toBe(RUNTIME_VENUE_MANIFEST_V0_VERSION);
    expect(parsed.layers[0]?.kind).toBe("gaussian_splat");
    const layer = parsed.layers[0];
    expect(layer?.kind).toBe("gaussian_splat");
    if (layer?.kind !== "gaussian_splat") {
      throw new Error("expected gaussian splat layer");
    }
    expect(layer.renderer).toBe("spark");
    expect(parsed.assets[0]?.uri).toBe("./assets/grand-hall.splat.spz");
  });

  it("accepts R2-backed asset references without requiring URL syntax", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        assets: [
          {
            id: "grand-hall-splat",
            role: "radiance",
            format: "spz",
            uri: "r2://venviewer-runtime/trades-hall/grand-hall.splat.spz",
            sha256: VALID_SHA256,
          },
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it("defaults layer transform and visibility when omitted", () => {
    const result = RuntimeVenueManifestV0Schema.parse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "spz",
            coordinateSystem: "rhs_y_up_meters",
          },
        ],
      }),
    );

    expect(result.layers[0]?.transform).toEqual([...IDENTITY_MATRIX4D]);
    expect(result.layers[0]?.visibleByDefault).toBe(true);
  });

  it("rejects malformed SHA-256 digests", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        assets: [
          {
            id: "grand-hall-splat",
            role: "radiance",
            format: "spz",
            uri: "./assets/grand-hall.splat.spz",
            sha256: "sha256:ABC",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects transforms that are not 16-number Matrix4d arrays", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "spz",
            coordinateSystem: "rhs_y_up_meters",
            transform: [1, 0, 0, 0],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects layers that reference undeclared assets", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "missing-splat",
            format: "spz",
            coordinateSystem: "rhs_y_up_meters",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects layer format mismatches against the referenced asset", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "ply",
            coordinateSystem: "rhs_y_up_meters",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects gaussian splat layers that point at non-radiance assets", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        assets: [
          {
            id: "grand-hall-splat",
            role: "geometry",
            format: "spz",
            uri: "./assets/grand-hall.splat.spz",
            sha256: VALID_SHA256,
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects defaultLayerId when it does not reference a declared layer", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        defaultLayerId: "missing-layer",
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects inverted bounds", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        bounds: {
          min: [1, 0, -1],
          max: [1, 7, 1],
        },
      }),
    );

    expect(result.success).toBe(false);
  });
});
