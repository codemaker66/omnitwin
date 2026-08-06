import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  buildApprovedRoomRuntimePresentationContract,
  type ApprovedRoomRuntimePresentationContract,
  type ApprovedRoomRuntimeProfile,
  type RuntimePackagePreview,
  type RuntimePackagePreviewVisualAsset,
} from "@omnitwin/types";

const getApprovedRoomRuntimeProfileMock = vi.hoisted(() => vi.fn());
const getRuntimePackagePreviewMock = vi.hoisted(() => vi.fn());

vi.mock("../../../api/runtime-packages.js", () => ({
  getApprovedRoomRuntimeProfile: getApprovedRoomRuntimeProfileMock,
  getRuntimePackagePreview: getRuntimePackagePreviewMock,
}));

import { useLivingHallRuntimeAsset } from "../useLivingHallRuntimeAsset.js";
import { RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT } from
  "../reception-presentation-contract.js";

const PACKAGE_ID = "20000000-0000-4000-8000-000000000001";
const QUALITY_VISUAL_ASSETS = [
  {
    assetVersionId: "411cee79-f698-4945-ab0f-1267e6e74c2f",
    fileName: "0_15_0_0.sog",
    fileExt: ".sog",
    sha256: "1".repeat(64),
    sizeBytes: 10_279_160,
  },
  {
    assetVersionId: "47d8e638-4ce1-415e-9c3c-941c91b1ac30",
    fileName: "0_1_0_5.sog",
    fileExt: ".sog",
    sha256: "2".repeat(64),
    sizeBytes: 11_000_000,
  },
  {
    assetVersionId: "a4d9ff60-62f7-4bee-a7de-e128778325ae",
    fileName: "0_6_0_0.sog",
    fileExt: ".sog",
    sha256: "3".repeat(64),
    sizeBytes: 12_000_000,
  },
  {
    assetVersionId: "24637593-577e-4507-b73c-8cd3c8e30039",
    fileName: "0_7_0_0.sog",
    fileExt: ".sog",
    sha256: "4".repeat(64),
    sizeBytes: 13_000_000,
  },
] as const satisfies readonly RuntimePackagePreviewVisualAsset[];

const MOBILE_VISUAL_ASSETS = [
  {
    assetVersionId: "511cee79-f698-4945-ab0f-1267e6e74c2f",
    fileName: "0_13_0_0.spz",
    fileExt: ".spz",
    sha256: "5".repeat(64),
    sizeBytes: 5_000_000,
  },
  {
    assetVersionId: "57d8e638-4ce1-415e-9c3c-941c91b1ac30",
    fileName: "0_3_0_0.spz",
    fileExt: ".spz",
    sha256: "6".repeat(64),
    sizeBytes: 5_100_000,
  },
  {
    assetVersionId: "b4d9ff60-62f7-4bee-a7de-e128778325ae",
    fileName: "0_7_0_1.spz",
    fileExt: ".spz",
    sha256: "7".repeat(64),
    sizeBytes: 5_200_000,
  },
  {
    assetVersionId: "34637593-577e-4507-b73c-8cd3c8e30039",
    fileName: "0_8_0_0.spz",
    fileExt: ".spz",
    sha256: "8".repeat(64),
    sizeBytes: 5_300_000,
  },
] as const satisfies readonly RuntimePackagePreviewVisualAsset[];

const VALID_RUNTIME_URLS = [
  "http://localhost:3001/assets/runtime-profiles/quality-sog-fine-v1/members/0/content.sog",
  "http://localhost:3001/assets/runtime-profiles/quality-sog-fine-v1/members/1/content.sog",
  "http://localhost:3001/assets/runtime-profiles/quality-sog-fine-v1/members/2/content.sog",
  "http://localhost:3001/assets/runtime-profiles/quality-sog-fine-v1/members/3/content.sog",
] as const;

function makeApprovedProfile(
  overrides: Partial<ApprovedRoomRuntimeProfile> = {},
): ApprovedRoomRuntimeProfile {
  return {
    scope: "approved_room_runtime_profile",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    profileId: "quality-sog-fine-v1",
    presentationContract: RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT,
    visualAssetUrls: [...VALID_RUNTIME_URLS],
    ...overrides,
  };
}

function changedPresentationContract(
  mismatch: "transform" | "camera" | "renderer" | "route",
): ApprovedRoomRuntimePresentationContract {
  const current = RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT;
  return buildApprovedRoomRuntimePresentationContract({
    schemaVersion: current.schemaVersion,
    groupTransform: mismatch === "transform"
      ? { ...current.groupTransform, position: [1, 0, 0] }
      : current.groupTransform,
    cameraPolicy: {
      ...current.cameraPolicy,
      route: mismatch === "route" ? "/different-route" : current.cameraPolicy.route,
      pathDigest: mismatch === "camera"
        ? "d".repeat(64)
        : current.cameraPolicy.pathDigest,
    },
    rendererProfile: {
      ...current.rendererProfile,
      digest: mismatch === "renderer"
        ? "e".repeat(64)
        : current.rendererProfile.digest,
    },
  });
}

function makeReceptionPreview(
  profileId: NonNullable<RuntimePackagePreview["reviewedProfileId"]> = "quality-sog-fine-v1",
  overrides: Partial<RuntimePackagePreview> = {},
): RuntimePackagePreview {
  const assets = profileId === "mobile-spz-fine-v1"
    ? MOBILE_VISUAL_ASSETS
    : QUALITY_VISUAL_ASSETS;
  const primary = assets[0];

  return {
    scope: "exact_private_runtime_package_preview",
    runtimePackageId: PACKAGE_ID,
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    revision: 7,
    identityKind: "content_sha256",
    contentDigest: "b".repeat(64),
    manifestJson: {
      schemaVersion: "venviewer.runtime-package.v1",
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      packageType: "room-runtime",
      assets: {
        primaryVisualAssetVersionId: primary.assetVersionId,
        semanticMeshAssetVersionId: null,
        collisionAssetVersionId: null,
        pointCloudAssetVersionId: null,
        visualAssetVersionIds: assets.map((asset) => asset.assetVersionId),
        visualAssetReceipts: assets.map((asset, index) => ({
          ...asset,
          storageKeySha256: String(index + 5).repeat(64),
        })),
      },
    },
    evidenceStatus: "machine_checked",
    runtimeStatus: "internal_ready",
    reviewedProfileId: profileId,
    issuedAt: "2026-07-14T08:00:00.000Z",
    visualAssets: assets.map((asset) => ({ ...asset })),
    ...overrides,
  };
}

function RuntimeProbe({
  isDevelopment,
  sceneParameter = null,
  previewPackageId = null,
}: {
  readonly isDevelopment: boolean;
  readonly sceneParameter?: string | null;
  readonly previewPackageId?: string | null;
}): React.ReactElement {
  const asset = useLivingHallRuntimeAsset({ isDevelopment, sceneParameter, previewPackageId });
  return (
    <output
      data-testid="runtime-probe"
      data-status={asset.status}
      data-urls={asset.splatUrls.join("|")}
      data-source-ids={asset.splatSources.map((source) => source.id).join("|")}
      data-source-kinds={asset.splatSources.map((source) => source.kind).join("|")}
    />
  );
}

function probe(): HTMLElement {
  return screen.getByTestId("runtime-probe");
}

afterEach(() => {
  cleanup();
  getApprovedRoomRuntimeProfileMock.mockReset();
  getRuntimePackagePreviewMock.mockReset();
});

describe("Living Hall reviewed runtime profile gate", () => {
  it("fetches the redacted approved Quality profile in production", async () => {
    getApprovedRoomRuntimeProfileMock.mockResolvedValue(makeApprovedProfile());

    const view = render(<RuntimeProbe isDevelopment={false} />);

    expect(probe().dataset.status).toBe("loading");
    await waitFor(() => {
      expect(probe().dataset.status).toBe("ready");
    });
    expect(getApprovedRoomRuntimeProfileMock).toHaveBeenCalledWith({
      venue: "trades-hall",
      room: "reception-room",
    }, expect.any(AbortSignal));
    expect(probe().dataset.urls?.split("|")).toEqual(VALID_RUNTIME_URLS);
    expect(probe().dataset.urls).not.toContain("/splats/reception/");
    const signal = getApprovedRoomRuntimeProfileMock.mock.calls[0]?.[1] as
      AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("does not expose the reviewed Mobile profile on the public Living Hall", async () => {
    getApprovedRoomRuntimeProfileMock.mockResolvedValue(makeApprovedProfile({
      profileId: "mobile-spz-fine-v1",
      visualAssetUrls: MOBILE_VISUAL_ASSETS.map((asset) =>
        `https://api.example/assets/runtime-assets/${asset.assetVersionId}/${asset.fileName}`
      ),
    }));

    render(<RuntimeProbe isDevelopment={false} />);

    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
    expect(probe().dataset.urls).toBe("");
  });

  it("rejects an approved profile for the wrong venue or room", async () => {
    getApprovedRoomRuntimeProfileMock.mockResolvedValue(makeApprovedProfile({
      roomSlug: "grand-hall",
    }));

    const view = render(<RuntimeProbe isDevelopment={false} />);
    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
    view.unmount();

    getApprovedRoomRuntimeProfileMock.mockResolvedValue(makeApprovedProfile({
      venueSlug: "another-venue",
    }));
    render(<RuntimeProbe isDevelopment={false} />);
    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
  });

  it("rejects self-consistent transform, camera, renderer, and route contract drift", async () => {
    for (const mismatch of ["transform", "camera", "renderer", "route"] as const) {
      getApprovedRoomRuntimeProfileMock.mockResolvedValueOnce(makeApprovedProfile({
        presentationContract: changedPresentationContract(mismatch),
      }));
      const view = render(<RuntimeProbe isDevelopment={false} />);
      await waitFor(() => {
        expect(probe().dataset.status, mismatch).toBe("fallback");
      });
      expect(probe().dataset.urls).toBe("");
      view.unmount();
    }
  });

  it("requires exactly four unique approved URLs", async () => {
    getApprovedRoomRuntimeProfileMock.mockResolvedValueOnce(makeApprovedProfile({
      visualAssetUrls: VALID_RUNTIME_URLS.slice(0, 3),
    }));

    const partial = render(<RuntimeProbe isDevelopment={false} />);
    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
    partial.unmount();

    getApprovedRoomRuntimeProfileMock.mockResolvedValueOnce(makeApprovedProfile({
      visualAssetUrls: [
        VALID_RUNTIME_URLS[0],
        VALID_RUNTIME_URLS[0],
        VALID_RUNTIME_URLS[2],
        VALID_RUNTIME_URLS[3],
      ],
    }));
    render(<RuntimeProbe isDevelopment={false} />);
    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
    expect(probe().dataset.urls).toBe("");
  });

  it("rejects URLs outside the anonymous reviewed-profile member route", async () => {
    getApprovedRoomRuntimeProfileMock.mockResolvedValue(makeApprovedProfile({
      visualAssetUrls: [
        `https://api.example/assets/runtime-assets/${QUALITY_VISUAL_ASSETS[0].assetVersionId}/0_0.sog`,
        ...VALID_RUNTIME_URLS.slice(1),
      ],
    }));

    render(<RuntimeProbe isDevelopment={false} />);
    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
    expect(probe().dataset.urls).toBe("");
  });

  it("rejects reordered, mixed-origin, insecure, or decorated member URLs", async () => {
    const invalidSets = [
      [VALID_RUNTIME_URLS[1], VALID_RUNTIME_URLS[0], ...VALID_RUNTIME_URLS.slice(2)],
      [VALID_RUNTIME_URLS[0], VALID_RUNTIME_URLS[1], VALID_RUNTIME_URLS[2],
        VALID_RUNTIME_URLS[3].replace("localhost:3001", "other.example")],
      VALID_RUNTIME_URLS.map((url) => url.replace("localhost:3001", "other.example")),
      [VALID_RUNTIME_URLS[0].replace("http:", "https:"), ...VALID_RUNTIME_URLS.slice(1)],
      [VALID_RUNTIME_URLS[0] + "?token=unexpected", ...VALID_RUNTIME_URLS.slice(1)],
    ];

    for (const visualAssetUrls of invalidSets) {
      getApprovedRoomRuntimeProfileMock.mockResolvedValueOnce(makeApprovedProfile({
        visualAssetUrls,
      }));
      const view = render(<RuntimeProbe isDevelopment={false} />);
      await waitFor(() => {
        expect(probe().dataset.status).toBe("fallback");
      });
      expect(probe().dataset.urls).toBe("");
      view.unmount();
    }
  });

  it("keeps the fallback when no approved profile exists or the request fails", async () => {
    getApprovedRoomRuntimeProfileMock.mockResolvedValueOnce(null);
    const missing = render(<RuntimeProbe isDevelopment={false} />);
    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
    missing.unmount();

    getApprovedRoomRuntimeProfileMock.mockRejectedValueOnce(new Error("registry unavailable"));
    render(<RuntimeProbe isDevelopment={false} />);
    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
    expect(probe().dataset.urls).toBe("");
  });

  it("uses only the four direct leaves in development and skips the registry", () => {
    const view = render(<RuntimeProbe isDevelopment={true} />);

    expect(probe().dataset.status).toBe("direct-preview");
    expect(probe().dataset.urls?.split("|")).toEqual([
      "/splats/reception/0_15_0_0.sog",
      "/splats/reception/0_1_0_5.sog",
      "/splats/reception/0_6_0_0.sog",
      "/splats/reception/0_7_0_0.sog",
    ]);
    expect(getApprovedRoomRuntimeProfileMock).not.toHaveBeenCalled();

    view.rerender(<RuntimeProbe isDevelopment={true} sceneParameter="0" />);
    expect(probe().dataset.status).toBe("fallback");
    expect(probe().dataset.urls).toBe("");
    expect(getApprovedRoomRuntimeProfileMock).not.toHaveBeenCalled();
  });

  it("ignores a late approved-profile response after switching to development", async () => {
    let resolveFirstRequest: ((value: ApprovedRoomRuntimeProfile | null) => void) | undefined;
    const firstRequest = new Promise<ApprovedRoomRuntimeProfile | null>((resolve) => {
      resolveFirstRequest = resolve;
    });
    getApprovedRoomRuntimeProfileMock
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(null);

    const view = render(<RuntimeProbe isDevelopment={false} />);
    expect(probe().dataset.status).toBe("loading");

    view.rerender(<RuntimeProbe isDevelopment={true} />);
    expect(probe().dataset.status).toBe("direct-preview");

    await act(async () => {
      resolveFirstRequest?.(makeApprovedProfile());
      await firstRequest;
    });
    expect(probe().dataset.status).toBe("direct-preview");
    expect(probe().dataset.urls).not.toContain("http://localhost:3001/");

    view.rerender(<RuntimeProbe isDevelopment={false} />);
    expect(probe().dataset.status).toBe("loading");
    await waitFor(() => {
      expect(probe().dataset.status).toBe("fallback");
    });
    expect(getApprovedRoomRuntimeProfileMock).toHaveBeenCalledTimes(2);
  });

  it("trusts the authenticated server's Quality profile attestation", async () => {
    const preview = makeReceptionPreview();
    getRuntimePackagePreviewMock.mockResolvedValue(preview);

    render(
      <RuntimeProbe isDevelopment={true} previewPackageId={preview.runtimePackageId} />,
    );

    expect(probe().dataset.status).toBe("private-preview-loading");
    await waitFor(() => {
      expect(probe().dataset.status).toBe("private-preview-ready");
    });
    expect(probe().dataset.urls).toBe("");
    expect(probe().dataset.sourceKinds?.split("|")).toEqual([
      "private-stream",
      "private-stream",
      "private-stream",
      "private-stream",
    ]);
    expect(probe().dataset.sourceIds?.split("|")).toEqual(
      QUALITY_VISUAL_ASSETS.map((asset) => `${preview.runtimePackageId}:${asset.assetVersionId}`),
    );
    expect(getRuntimePackagePreviewMock).toHaveBeenCalledWith(
      preview.runtimePackageId,
      expect.any(AbortSignal),
    );
    expect(getApprovedRoomRuntimeProfileMock).not.toHaveBeenCalled();
  });

  it("trusts the separately reviewed Mobile profile in private preview", async () => {
    const preview = makeReceptionPreview("mobile-spz-fine-v1");
    getRuntimePackagePreviewMock.mockResolvedValue(preview);

    render(<RuntimeProbe isDevelopment={false} previewPackageId={preview.runtimePackageId} />);

    await waitFor(() => {
      expect(probe().dataset.status).toBe("private-preview-ready");
    });
    expect(probe().dataset.sourceIds?.split("|")).toEqual(
      MOBILE_VISUAL_ASSETS.map((asset) => `${preview.runtimePackageId}:${asset.assetVersionId}`),
    );
    expect(getApprovedRoomRuntimeProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a private preview without a server-reviewed profile attestation", async () => {
    const preview = makeReceptionPreview("quality-sog-fine-v1", {
      reviewedProfileId: null,
    });
    getRuntimePackagePreviewMock.mockResolvedValue(preview);

    render(<RuntimeProbe isDevelopment={false} previewPackageId={preview.runtimePackageId} />);

    await waitFor(() => {
      expect(probe().dataset.status).toBe("private-preview-fallback");
    });
    expect(probe().dataset.sourceIds).toBe("");
  });

  it("rejects a reviewed private preview for another room", async () => {
    const preview = makeReceptionPreview("quality-sog-fine-v1", {
      roomSlug: "grand-hall",
    });
    getRuntimePackagePreviewMock.mockResolvedValue(preview);

    render(<RuntimeProbe isDevelopment={false} previewPackageId={preview.runtimePackageId} />);

    await waitFor(() => {
      expect(probe().dataset.status).toBe("private-preview-fallback");
    });
    expect(probe().dataset.sourceIds).toBe("");
  });

  it("never substitutes local or public assets when an exact private preview fails", async () => {
    getRuntimePackagePreviewMock.mockRejectedValue(new Error("forbidden"));
    const view = render(
      <RuntimeProbe isDevelopment={true} previewPackageId={PACKAGE_ID} />,
    );

    await waitFor(() => {
      expect(probe().dataset.status).toBe("private-preview-fallback");
    });
    expect(probe().dataset.urls).toBe("");
    expect(probe().dataset.sourceIds).toBe("");
    expect(getApprovedRoomRuntimeProfileMock).not.toHaveBeenCalled();

    view.rerender(<RuntimeProbe isDevelopment={true} previewPackageId="not-a-uuid" />);
    await waitFor(() => {
      expect(probe().dataset.status).toBe("private-preview-fallback");
    });
    expect(getRuntimePackagePreviewMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the exact metadata request when the preview route changes", () => {
    getRuntimePackagePreviewMock.mockReturnValue(new Promise(() => undefined));
    const view = render(
      <RuntimeProbe isDevelopment={false} previewPackageId={PACKAGE_ID} />,
    );
    const firstSignal = getRuntimePackagePreviewMock.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(firstSignal?.aborted).toBe(false);

    view.rerender(
      <RuntimeProbe
        isDevelopment={false}
        previewPackageId="20000000-0000-4000-8000-000000000099"
      />,
    );
    expect(firstSignal?.aborted).toBe(true);
    expect(getRuntimePackagePreviewMock).toHaveBeenCalledTimes(2);
    expect(getApprovedRoomRuntimeProfileMock).not.toHaveBeenCalled();
  });
});
