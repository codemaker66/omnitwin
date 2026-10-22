import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Children, isValidElement, type ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanoStageProps } from "../PanoStage.js";
import { TWIN_FIXTURE_MANIFEST_NO_MESH } from "../__fixtures__/twin-fixture.js";
import { lookUpRoom } from "../shell/twin-rooms.js";
import {
  TWIN_DETAIL_LOADING_LINE,
  TWIN_VIEW_RETRY_LOADING_LINE,
  twinOpeningViewLine,
} from "../twin-copy.js";

const bridge = vi.hoisted(() => ({ stages: new Map<string, PanoStageProps>() }));

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children?: ReactNode }) => {
    const inspect = (nodes: ReactNode): void => {
      Children.forEach(nodes, (node) => {
        if (!isValidElement(node)) return;
        if (typeof node.type === "function" && node.type.name === "PanoStage") {
          const props = node.props as PanoStageProps;
          bridge.stages.set(props.nodeId, props);
        } else inspect((node.props as { children?: ReactNode }).children);
      });
    };
    inspect(children);
    return <div data-testid="canvas" />;
  },
  useFrame: (): void => undefined,
  useThree: (): undefined => undefined,
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: (): null => null,
  useGLTF: vi.fn(() => ({ scene: {} })),
}));
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({
  MeshoptDecoder: { ready: Promise.resolve(), supported: true },
}));

const { TwinViewer } = await import("../TwinViewer.js");
const initialNode = TWIN_FIXTURE_MANIFEST_NO_MESH.entryNodeId ?? TWIN_FIXTURE_MANIFEST_NO_MESH.nodes[0]?.id ?? "scan_000";
const nextNode = TWIN_FIXTURE_MANIFEST_NO_MESH.nodes.find((node) => node.id !== initialNode)?.id ?? "scan_001";

function Jump(): ReactNode {
  const navigate = useNavigate();
  return <button type="button" onClick={() => { void navigate(`?node=${nextNode}`); }}>Next test viewpoint</button>;
}
function mount(): ReturnType<typeof render> {
  return render(<MemoryRouter initialEntries={[`/twin?node=${initialNode}`]}>
    <TwinViewer manifest={TWIN_FIXTURE_MANIFEST_NO_MESH} assetBase="/twin/test" />
    <Jump />
  </MemoryRouter>);
}
function stage(nodeId = initialNode): PanoStageProps {
  const props = bridge.stages.get(nodeId);
  if (props === undefined) throw new Error(`No mounted stage for ${nodeId}`);
  return props;
}

/** What the stage says while nothing is on screen yet. */
const OPENING = twinOpeningViewLine(lookUpRoom(initialNode)?.name ?? null);

beforeEach(() => { bridge.stages.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("TwinViewer terminal panorama feedback", () => {
  it.each([false, true])("replaces activity with an honest failure and retry, preview=%s", (hasPreview) => {
    mount();
    expect(screen.getByText(OPENING)).toBeTruthy();
    act(() => { stage().onFailure?.(initialNode, hasPreview); });
    expect(screen.queryByText(OPENING)).toBeNull();
    expect(screen.queryByTestId("twin-load-shimmer")).toBeNull();
    expect(screen.getByText(hasPreview
      ? "Preview available. Full detail could not load."
      : "This view could not load.")).toBeTruthy();
    expect(screen.queryByTestId("twin-first-light")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry view" }));
    expect(stage().retryKey).toBe(1);
    // With a preview on screen the retry is named in the pill; with nothing
    // on screen the stage says again what it is waiting for.
    expect(screen.getByTestId("twin-load-shimmer").textContent)
      .toContain(hasPreview ? TWIN_VIEW_RETRY_LOADING_LINE : OPENING);
    expect(screen.queryByRole("button", { name: "Retry view" })).toBeNull();
    act(() => { stage().onFailure?.(initialNode, hasPreview); });
    expect(screen.queryByTestId("twin-load-shimmer")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry view" })).toBeTruthy();
  });

  it("names the opening wait on the stage, then hands the rest to the pill once the preview is up", async () => {
    mount();
    const opening = screen.getByTestId("twin-load-shimmer");
    expect(opening.className).toContain("vv-twin-opening");
    expect(opening.querySelector("[role='status']")?.textContent).toBe(OPENING);
    expect(opening.querySelector("[data-activity-indicator]")).not.toBeNull();
    // The node label carries no second live status while the stage speaks.
    expect(screen.getByTestId("twin-node-label").querySelector("[role='status']")).toBeNull();
    act(() => { stage().onTier?.(initialNode, "preview"); });
    expect(screen.queryByText(OPENING)).toBeNull();
    const pill = within(screen.getByTestId("twin-node-label")).getByRole("status");
    expect(pill.textContent).toContain(TWIN_DETAIL_LOADING_LINE);
    act(() => { stage().onTier?.(initialNode, "base"); });
    await waitFor(() => { expect(screen.queryByTestId("twin-load-shimmer")).toBeNull(); });
  });

  it("ignores late failure from the abandoned viewpoint", async () => {
    mount();
    const oldStage = stage();
    fireEvent.click(screen.getByRole("button", { name: "Next test viewpoint" }));
    await waitFor(() => { expect(bridge.stages.has(nextNode)).toBe(true); });
    act(() => { oldStage.onFailure?.(initialNode, false); });
    expect(screen.queryByText("This view could not load.")).toBeNull();
    act(() => { stage(nextNode).onFailure?.(nextNode, false); });
    expect(screen.getByText("This view could not load.")).toBeTruthy();
  });

  it("retires retry activity after a successful base at a later viewpoint", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Next test viewpoint" }));
    await waitFor(() => { expect(bridge.stages.has(nextNode)).toBe(true); });
    act(() => { stage(nextNode).onFailure?.(nextNode, true); });
    fireEvent.click(screen.getByRole("button", { name: "Retry view" }));
    expect(stage(nextNode).retryKey).toBe(1);
    expect(screen.getByText(TWIN_VIEW_RETRY_LOADING_LINE, { exact: false })).toBeTruthy();
    act(() => { stage(nextNode).onTier?.(nextNode, "preview"); });
    expect(screen.getByTestId("twin-load-shimmer").className).not.toContain("--out");
    act(() => { stage(nextNode).onTier?.(nextNode, "base"); });
    await waitFor(() => { expect(screen.queryByTestId("twin-load-shimmer")).toBeNull(); });
    expect(screen.queryByRole("button", { name: "Retry view" })).toBeNull();
  });
});
