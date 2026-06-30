import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } from "@zip.js/zip.js";
import { LightingLensPanel } from "../LightingLensPanel.js";
import { useLightingRigStore } from "../../../../stores/lighting-rig-store.js";

// Stub the WebGL preview so this stays a routing test (no Canvas in happy-dom).
vi.mock("../FixtureModelPreview.js", () => ({ FixtureModelPreview: () => <div data-testid="fixture-model-preview-mock" /> }));

async function makeGdtfBytes(descriptionXml: string, extras: Record<string, string> = {}): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("description.xml", new TextReader(descriptionXml));
  for (const [name, content] of Object.entries(extras)) await writer.add(name, new TextReader(content));
  return writer.close();
}

async function makeGdtfFile(name: string, descriptionXml: string, extras: Record<string, string> = {}): Promise<File> {
  const bytes = await makeGdtfBytes(descriptionXml, extras);
  return new File([bytes], name, { type: "application/zip" });
}

async function makeMvrFile(name: string, sceneXml: string, gdtfs: Record<string, Uint8Array>): Promise<File> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("GeneralSceneDescription.xml", new TextReader(sceneXml));
  for (const [entry, bytes] of Object.entries(gdtfs)) {
    await writer.add(entry, new Uint8ArrayReader(bytes));
  }
  return new File([await writer.close()], name, { type: "application/zip" });
}

function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.nextElementSibling?.textContent ?? "";
}

beforeEach(() => { useLightingRigStore.getState().reset(); });
afterEach(() => { cleanup(); useLightingRigStore.getState().reset(); });

describe("LightingLensPanel", () => {
  it("renders the starter rig with its DMX patch and power", () => {
    render(<LightingLensPanel />);
    expect(screen.getByTestId("lighting-lens-panel")).toBeTruthy();
    expect(screen.getByText("Lighting & DMX")).toBeTruthy();
    // Starter rig: 12 PAR (7ch) + 4 wash (13ch) + 2 profile (5ch) = 18 fixtures, 146 channels.
    expect(screen.getByTestId<HTMLInputElement>("rig-par").value).toBe("12");
    expect(metricValue("Fixtures")).toBe("18");
    expect(metricValue("DMX channels")).toBe("146");
    expect(metricValue("Universes")).toBe("1");
    expect(screen.getByTestId("dmx-universe-1")).toBeTruthy();
    // Power: 12×200 + 4×575 + 2×550 = 5,800 W; 5800 / (230×0.9) = 28.0 A.
    expect(metricValue("Total load")).toBe("5,800 W");
    expect(metricValue("Single-phase")).toBe("28.0 A @ 230 V");
  });

  it("exports a patch sheet CSV and disables export for an empty rig", () => {
    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:patch");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<LightingLensPanel />);
    const button = screen.getByTestId<HTMLButtonElement>("patch-export");
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("rig-clear"));
    expect(screen.getByTestId<HTMLButtonElement>("patch-export").disabled).toBe(true);

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("re-patches into more universes when the rig grows", () => {
    render(<LightingLensPanel />);
    fireEvent.change(screen.getByTestId("rig-par"), { target: { value: "100" } });
    expect(useLightingRigStore.getState().counts.par).toBe(100);
    expect(metricValue("Universes")).toBe("2");
  });

  it("shows an empty patch hint when the rig is cleared", () => {
    render(<LightingLensPanel />);
    fireEvent.click(screen.getByTestId("rig-clear"));
    expect(screen.getByTestId("dmx-empty")).toBeTruthy();
    expect(metricValue("Fixtures")).toBe("0");
  });

  it("imports a pasted GDTF fixture and patches its real channel footprint", () => {
    render(<LightingLensPanel />);
    fireEvent.click(screen.getByTestId("rig-clear")); // start from an empty rig
    expect(metricValue("Fixtures")).toBe("0");

    const channels = Array.from({ length: 11 }, (_, i) => `<DMXChannel Offset="${String(i + 1)}"/>`).join("");
    const xml = `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="MegaPointe" Manufacturer="Robe"><DMXModes><DMXMode Name="Standard"><DMXChannels>${channels}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    fireEvent.change(screen.getByTestId("gdtf-xml"), { target: { value: xml } });
    expect(screen.getByTestId("gdtf-name").textContent).toContain("Robe");

    fireEvent.click(screen.getByTestId("gdtf-add"));
    // One imported fixture drives the patch with its real 11-channel footprint.
    expect(metricValue("Fixtures")).toBe("1");
    expect(metricValue("DMX channels")).toBe("11");
    const imported = useLightingRigStore.getState().imported;
    expect(imported).toHaveLength(1);
    expect(imported[0]?.channels).toBe(11);
    expect(screen.getByTestId(`imported-count-${imported[0]?.id ?? ""}`)).toBeTruthy();
  });

  it("removes an imported fixture from the rig", () => {
    render(<LightingLensPanel />);
    fireEvent.click(screen.getByTestId("rig-clear"));
    const xml = `<?xml version="1.0"?><GDTF><FixtureType Name="Strobe X" Manufacturer="Acme"><DMXModes><DMXMode Name="Basic"><DMXChannels><DMXChannel Offset="1"/><DMXChannel Offset="2"/></DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    fireEvent.change(screen.getByTestId("gdtf-xml"), { target: { value: xml } });
    fireEvent.click(screen.getByTestId("gdtf-add"));
    expect(useLightingRigStore.getState().imported).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Remove Strobe X"));
    expect(useLightingRigStore.getState().imported).toHaveLength(0);
  });

  it("shows a parse error and no add button for invalid GDTF", () => {
    render(<LightingLensPanel />);
    fireEvent.change(screen.getByTestId("gdtf-xml"), { target: { value: "not gdtf at all <<<" } });
    expect(screen.getByTestId("gdtf-error")).toBeTruthy();
    expect(screen.queryByTestId("gdtf-add")).toBeNull();
  });

  it("imports a fixture from a chosen .gdtf file (unzips the archive)", async () => {
    const channels = Array.from({ length: 9 }, (_, i) => `<DMXChannel Offset="${String(i + 1)}"/>`).join("");
    const xml = `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="FileFix" Manufacturer="ZipCo"><DMXModes><DMXMode Name="M"><DMXChannels>${channels}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    const file = await makeGdtfFile("filefix.gdtf", xml);

    render(<LightingLensPanel />);
    fireEvent.click(screen.getByTestId("rig-clear"));
    fireEvent.change(screen.getByTestId("gdtf-file"), { target: { files: [file] } });

    // The archive is unzipped asynchronously and its description.xml feeds the preview.
    const name = await screen.findByTestId("gdtf-name");
    expect(name.textContent).toContain("ZipCo");
    fireEvent.click(screen.getByTestId("gdtf-add"));
    expect(metricValue("DMX channels")).toBe("9");
    expect(useLightingRigStore.getState().imported).toHaveLength(1);
  });

  it("shows a 3D model preview when the .gdtf bundles a glTF model", async () => {
    const xml = `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="Modeled" Manufacturer="Acme"><DMXModes><DMXMode Name="M"><DMXChannels><DMXChannel Offset="1"/></DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    const file = await makeGdtfFile("modeled.gdtf", xml, { "models/gltf/base.glb": "FAKE-GLB-BYTES" });
    render(<LightingLensPanel />);
    fireEvent.change(screen.getByTestId("gdtf-file"), { target: { files: [file] } });
    expect(await screen.findByTestId("gdtf-name")).toBeTruthy();
    expect(screen.getByTestId("fixture-model-preview-mock")).toBeTruthy();
  });

  it("shows no model preview for a .gdtf without a glTF", async () => {
    const file = await makeGdtfFile("plain.gdtf", `<?xml version="1.0"?><GDTF><FixtureType Name="Plain" Manufacturer="Acme"><DMXModes><DMXMode Name="M"><DMXChannels><DMXChannel Offset="1"/></DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`);
    render(<LightingLensPanel />);
    fireEvent.change(screen.getByTestId("gdtf-file"), { target: { files: [file] } });
    expect(await screen.findByTestId("gdtf-name")).toBeTruthy();
    expect(screen.queryByTestId("fixture-model-preview-mock")).toBeNull();
  });

  it("shows a file error for a non-GDTF file", async () => {
    const file = new File([new TextEncoder().encode("not a zip")], "bad.gdtf", { type: "application/zip" });
    render(<LightingLensPanel />);
    fireEvent.change(screen.getByTestId("gdtf-file"), { target: { files: [file] } });
    expect(await screen.findByTestId("gdtf-file-error")).toBeTruthy();
  });

  it("imports a whole rig from a chosen .mvr file", async () => {
    const gdtfXml = `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="Acme Spot" Manufacturer="Acme"><DMXModes><DMXMode Name="Basic"><DMXChannels>`
      + Array.from({ length: 5 }, (_, i) => `<DMXChannel Offset="${String(i + 1)}"/>`).join("")
      + `</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    const fixtures = [1, 2, 3].map((id) =>
      `<Fixture name="F${String(id)}"><GDTFSpec>Acme@Spot.gdtf</GDTFSpec><GDTFMode>Basic</GDTFMode>`
      + `<Addresses><Address break="0">${String(id)}</Address></Addresses></Fixture>`).join("");
    const scene = `<GeneralSceneDescription verMajor="1" verMinor="6"><Scene><Layers><Layer><ChildList>${fixtures}</ChildList></Layer></Layers></Scene></GeneralSceneDescription>`;
    const file = await makeMvrFile("rig.mvr", scene, { "Acme@Spot.gdtf": await makeGdtfBytes(gdtfXml) });

    render(<LightingLensPanel />);
    fireEvent.click(screen.getByTestId("rig-clear"));
    fireEvent.change(screen.getByTestId("gdtf-file"), { target: { files: [file] } });

    const summary = await screen.findByTestId("mvr-summary");
    expect(summary.textContent).toContain("3 fixtures");
    fireEvent.click(screen.getByTestId("mvr-add"));

    // One type (Acme Spot, Basic), count 3 → 3 × 5 ch = 15 channels.
    const imported = useLightingRigStore.getState().imported;
    expect(imported).toHaveLength(1);
    expect(imported[0]?.count).toBe(3);
    expect(metricValue("DMX channels")).toBe("15");
  });
});
