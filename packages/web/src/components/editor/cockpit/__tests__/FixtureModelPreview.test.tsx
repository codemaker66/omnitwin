import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { SelectedFixtureModel } from "../../../../lib/gdtf-model.js";
import { FixtureModelPreview } from "../FixtureModelPreview.js";

vi.mock("@react-three/fiber", () => ({ Canvas: ({ children }: { readonly children: ReactNode }) => <div>{children}</div> }));
vi.mock("@react-three/drei", () => ({ OrbitControls: () => null }));

function model(json: string): SelectedFixtureModel {
  return { path: "fixture.gltf", kind: "gltf", bytes: new TextEncoder().encode(json), siblings: new Map() };
}

afterEach(cleanup);

describe("FixtureModelPreview activity", () => {
  it("clears activity after a real glTF parse succeeds", async () => {
    render(<FixtureModelPreview model={model('{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}],"scene":0}')} />);
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
    await waitFor(() => { expect(screen.queryByRole("status")).toBeNull(); });
    expect(screen.queryByTestId("fixture-model-error")).toBeNull();
  });

  it("ends activity on parse failure and can load a replacement model", async () => {
    const view = render(<FixtureModelPreview model={model("invalid glTF")} />);
    expect(screen.getByTestId("fixture-model-error")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(<FixtureModelPreview model={model('{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}],"scene":0}')} />);
    expect(screen.getByRole("status")).toBeTruthy();
    await waitFor(() => { expect(screen.queryByRole("status")).toBeNull(); });
    expect(screen.queryByTestId("fixture-model-error")).toBeNull();
  });
});
