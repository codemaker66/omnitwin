import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  TWIN_FIXTURE_MANIFEST_EQUIRECT,
} from "../__fixtures__/twin-fixture.js";

vi.mock("@react-three/fiber", () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
  useFrame: (): void => undefined,
  useThree: (): undefined => undefined,
}));

const { useGltfPreload } = vi.hoisted(() => ({ useGltfPreload: vi.fn() }));

vi.mock("@react-three/drei", () => {
  const useGLTF = Object.assign(vi.fn(() => ({ scene: {} })), {
    preload: useGltfPreload,
  });
  return {
    OrbitControls: (): null => null,
    useGLTF,
  };
});

vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: { ready: Promise.resolve(), supported: true },
}));

const { TwinViewer } = await import("../TwinViewer.js");

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function viewer(
  experience: "public" | "local-evidence-review",
  disclosure = "Captured panoramas · source-manifest frame only · authority none",
) {
  return (
    <MemoryRouter
      initialEntries={[
        "/dev/trades-hall-visual?localRoomEvidence=http%3A%2F%2F127.0.0.1%3A55982%2Fapi%2Flocal-room-evidence-candidate%3Ftoken%3Dsecret",
      ]}
    >
      <TwinViewer
        manifest={TWIN_FIXTURE_MANIFEST_EQUIRECT}
        assetBase="http://127.0.0.1:55982/api/local-room-evidence-candidate/twin/secret"
        experience={experience}
        evidenceDisclosure={disclosure}
      />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  useGltfPreload.mockClear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TwinViewer local evidence lifecycle", () => {
  it("does not issue speculative neighbour requests in local evidence review", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(viewer("local-evidence-review"));

    expect(screen.getByTestId("r3f-canvas")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not warm the mesh when the pointer merely enters the local panorama surface", () => {
    vi.useFakeTimers();
    render(viewer("local-evidence-review"));

    fireEvent.pointerEnter(screen.getByRole("button", { name: /surface/i }));
    vi.advanceTimersByTime(3_000);

    expect(useGltfPreload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("preserves public neighbour prefetch while keeping local review demand-loaded", () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(new Response("", { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(viewer("public"));

    // scan_000 has one neighbour and the public viewer warms 512 + 4096.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => requestUrl(call[0]))).toEqual([
      expect.stringContaining("scan_001/equirect_512.webp"),
      expect.stringContaining("scan_001/equirect_4096.webp"),
    ]);
  });

  it("renders disclosure as text and removes every engagement control", () => {
    const disclosure = '<img src=x onerror="token=secret"> authority none';
    render(viewer("local-evidence-review", disclosure));

    expect(screen.getByText(disclosure)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByLabelText("Copy link to this walkthrough")).toBeNull();
    expect(screen.queryByRole("button", { name: /enquire about hosting/i })).toBeNull();
    expect(screen.getByText(disclosure).textContent).not.toContain("localRoomEvidence");
  });

  it("removes public controls on a public-to-local rerender without leaving stale actions", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 200 }))));
    const view = render(viewer("public"));
    const stage = screen.getByRole("application");
    expect(within(stage).getByLabelText("Copy link to this walkthrough")).toBeTruthy();

    view.rerender(viewer("local-evidence-review"));

    expect(within(stage).queryByLabelText("Copy link to this walkthrough")).toBeNull();
    expect(within(stage).queryByRole("button", { name: /enquire about hosting/i })).toBeNull();
  });
});
