import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@react-three/fiber", async () => {
  const { Children, createElement, isValidElement } = await import("react");
  return {
    Canvas: ({
      children,
      camera,
    }: {
      readonly children: React.ReactNode;
      readonly camera?: {
        readonly fov?: number;
        readonly near?: number;
        readonly far?: number;
        readonly position?: readonly number[];
      };
    }) => createElement(
      "div",
      {
        "data-testid": "canvas",
        "data-camera-fov": camera?.fov,
        "data-camera-near": camera?.near,
        "data-camera-far": camera?.far,
        "data-camera-position": camera?.position?.join(","),
      },
      Children.map(children, (child) => {
        if (!isValidElement<{
          readonly children?: React.ReactNode;
          readonly position?: readonly number[];
          readonly rotation?: readonly number[];
          readonly scale?: number;
        }>(child) || child.type !== "group") return child;
        return createElement("div", {
          "data-testid": "splat-group",
          "data-position": child.props.position?.join(","),
          "data-rotation": child.props.rotation?.join(","),
          "data-scale": child.props.scale,
        }, child.props.children);
      }),
    ),
    useFrame: vi.fn(),
    useThree: (selector: (state: unknown) => unknown) => selector({
      camera: {
        position: { copy: vi.fn() },
        lookAt: vi.fn(),
      },
      invalidate: vi.fn(),
      viewport: { dpr: 1 },
      gl: {
        getPixelRatio: () => 1,
        outputColorSpace: "srgb",
        toneMapping: 4,
        toneMappingExposure: 1,
      },
    }),
  };
});

vi.mock("../../../components/scene/SparkSplatLayer.js", async () => {
  const { createElement } = await import("react");
  return {
    SparkSplatLayer: ({
      url,
      source,
      renderProfile,
      onLoad,
      onError,
    }: {
      readonly url?: string;
      readonly source?: { readonly id: string; readonly kind: string };
      readonly renderProfile?: { readonly id: string };
      readonly onLoad?: (event: { readonly url: string; readonly splatCount: number }) => void;
      readonly onError?: (event: unknown) => void;
    }) => {
      const sourceId = source?.id ?? url ?? "missing-source";
      return createElement(
        "div",
        {
          "data-testid": "splat-layer",
          "data-url": sourceId,
          "data-source-kind": source?.kind ?? "url",
          "data-render-profile-id": renderProfile?.id,
        },
      createElement(
        "button",
        {
          type: "button",
          onClick: () => onLoad?.({
            url: sourceId,
            splatCount: sourceId.includes("0_15") ? 7 : 11,
          }),
        },
        `load ${sourceId}`,
      ),
      createElement(
        "button",
        { type: "button", onClick: () => onError?.({ type: "error" }) },
        `fail ${sourceId}`,
      ),
      );
    },
  };
});

vi.mock("../GoldInkTable.js", () => ({
  DRESSING_SECTION_ID: "the-dressing",
  GoldInkTable: () => null,
}));
vi.mock("../TurnSheet.js", () => ({ TurnSheet: () => null }));
vi.mock("../YourTable.js", () => ({ YourTable: () => null }));

import { LivingHallScene } from "../LivingHallScene.js";
import { RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT } from
  "../reception-presentation-contract.js";

const URLS = [
  "https://assets.example/reception/0_15_0_0.sog",
  "https://assets.example/reception/0_1_0_5.sog",
] as const;

function mount(
  splatUrls: readonly string[],
  onSceneFailed = vi.fn(),
): { readonly onSceneFailed: ReturnType<typeof vi.fn> } {
  render(
    <LivingHallScene
      splatUrls={splatUrls}
      presentationContract={RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT}
      reducedMotion={false}
      eventType="wedding"
      sandboxActive={false}
      onSandboxExit={vi.fn()}
      onSceneFailed={onSceneFailed}
    />,
  );
  return { onSceneFailed };
}

afterEach(cleanup);

describe("LivingHallScene explicit runtime URLs", () => {
  it("renders exactly the supplied URLs and derives completion from their count", () => {
    mount(URLS);

    const scene = document.querySelector<HTMLElement>("[data-scene-state]");
    const layers = screen.getAllByTestId("splat-layer");
    expect(layers.map((layer) => layer.dataset.url)).toEqual(URLS);
    expect(layers.every((layer) => layer.dataset.renderProfileId === "reception-fixed-fine-review-v1")).toBe(true);
    expect(scene?.dataset.renderProfileId).toBe("reception-fixed-fine-review-v1");
    expect(scene?.dataset.presentationContractDigest).toBe(
      RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT.contractDigest,
    );
    expect(scene?.dataset.presentationRoute).toBe("/living-hall");
    expect(scene?.dataset.cameraPolicyId).toBe("reception-scroll-dolly-v1");
    expect(scene?.dataset.renderProfileDigest).toBe(
      RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT.rendererProfile.digest,
    );
    expect(screen.getByTestId("canvas").dataset).toMatchObject({
      cameraFov: "62",
      cameraNear: "0.05",
      cameraFar: "150",
      cameraPosition: "-2.372,0.035,1.046",
    });
    expect(screen.getByTestId("splat-group").dataset).toMatchObject({
      position: "0,0,0",
      rotation: `${String(-Math.PI / 2)},0,0`,
      scale: "1",
    });
    expect(scene?.dataset.sceneState).toBe("loading");

    fireEvent.click(screen.getByRole("button", { name: `load ${URLS[0]}`, hidden: true }));
    expect(scene?.dataset.sceneState).toBe("loading");
    fireEvent.click(screen.getByRole("button", { name: `load ${URLS[0]}`, hidden: true }));
    expect(scene?.dataset.sceneState).toBe("loading");
    fireEvent.click(screen.getByRole("button", { name: `load ${URLS[1]}`, hidden: true }));
    expect(scene?.dataset.sceneState).toBe("live");
    expect(scene?.dataset.loadedSourceCount).toBe("2");
    expect(scene?.dataset.loadedSplatCount).toBe("18");
    expect(document.querySelector(".lh-scene-poster")?.classList.contains("is-sharpened")).toBe(true);
  });

  it("removes every splat layer and keeps the poster when any tile fails", () => {
    const { onSceneFailed } = mount(URLS);

    fireEvent.click(screen.getByRole("button", { name: `fail ${URLS[0]}`, hidden: true }));

    expect(document.querySelector<HTMLElement>("[data-scene-state]")?.dataset.sceneState).toBe("failed");
    expect(screen.queryAllByTestId("splat-layer")).toHaveLength(0);
    expect(document.querySelector(".lh-scene-poster")).toBeTruthy();
    expect(onSceneFailed).toHaveBeenCalledTimes(1);
  });

  it("mounts no canvas or splat requests for an empty URL set", () => {
    mount([]);

    expect(document.querySelector<HTMLElement>("[data-scene-state]")?.dataset.sceneState).toBe("failed");
    expect(screen.queryByTestId("canvas")).toBeNull();
    expect(screen.queryAllByTestId("splat-layer")).toHaveLength(0);
    expect(document.querySelector(".lh-scene-poster")).toBeTruthy();
  });

  it("derives private-stream completion from opaque source ids, not URLs", () => {
    const packageId = "20000000-0000-4000-8000-000000000001";
    const sources = [0, 1].map((index) => {
      const ordinal = String(index + 1);
      const assetVersionId = `10000000-0000-4000-8000-00000000000${ordinal}`;
      return {
        kind: "private-stream" as const,
        id: `${packageId}:${assetVersionId}`,
        runtimePackageId: packageId,
        asset: {
          assetVersionId,
          fileName: index === 0 ? "0_15_0_0.sog" : "0_1_0_5.sog",
          fileExt: ".sog" as const,
          sha256: ordinal.repeat(64),
          sizeBytes: 100 + index,
        },
      };
    });
    const firstSource = sources[0];
    const secondSource = sources[1];
    if (firstSource === undefined || secondSource === undefined) throw new Error("test sources missing");
    render(
      <LivingHallScene
        splatSources={sources}
        presentationContract={RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT}
        reducedMotion={false}
        eventType="wedding"
        sandboxActive={false}
        onSandboxExit={vi.fn()}
      />,
    );

    const scene = document.querySelector<HTMLElement>("[data-scene-state]");
    const layers = screen.getAllByTestId("splat-layer");
    expect(layers.map((layer) => layer.dataset.url)).toEqual(sources.map((source) => source.id));
    expect(layers.every((layer) => layer.dataset.sourceKind === "private-stream")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: `load ${firstSource.id}`, hidden: true }));
    expect(scene?.dataset.sceneState).toBe("loading");
    fireEvent.click(screen.getByRole("button", { name: `load ${secondSource.id}`, hidden: true }));
    expect(scene?.dataset.sceneState).toBe("live");
  });
});
