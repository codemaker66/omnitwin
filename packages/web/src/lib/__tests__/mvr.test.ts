import { describe, it, expect } from "vitest";
import { ZipWriter, Uint8ArrayWriter, TextReader } from "@zip.js/zip.js";
import { parseMvrScene, resolveMvrRig } from "../mvr.js";

const SPOT_GDTF =
  `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="Acme Spot" Manufacturer="Acme">`
  + `<PhysicalDescriptions><Properties><Weight Value="6"/></Properties></PhysicalDescriptions>`
  + `<DMXModes><DMXMode Name="Basic"><DMXChannels>`
  + Array.from({ length: 5 }, (_, i) => `<DMXChannel Offset="${String(i + 1)}"/>`).join("")
  + `</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;

function fixtureXml(spec: string, mode: string, id: number, address: number): string {
  return `<Fixture name="F${String(id)}" uuid="uuid-${String(id)}">`
    + `<Matrix>{1,0,0}{0,1,0}{0,0,1}{${String(id * 1000)},2000,5000}</Matrix>`
    + `<GDTFSpec>${spec}</GDTFSpec><GDTFMode>${mode}</GDTFMode>`
    + `<Addresses><Address break="0">${String(address)}</Address></Addresses>`
    + `<FixtureID>${String(id)}</FixtureID><UnitNumber>${String(id)}</UnitNumber></Fixture>`;
}

function sceneXml(fixtures: string[]): string {
  return `<GeneralSceneDescription verMajor="1" verMinor="6"><Scene><Layers><Layer name="L1">`
    + `<ChildList>${fixtures.join("")}</ChildList></Layer></Layers></Scene></GeneralSceneDescription>`;
}

async function gdtfBytes(descriptionXml: string): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("description.xml", new TextReader(descriptionXml));
  return writer.close();
}

describe("parseMvrScene", () => {
  it("reads fixtures with spec, mode, address, id and position", () => {
    const result = parseMvrScene(sceneXml([fixtureXml("Acme@Spot.gdtf", "Basic", 1, 12)]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.fixtures).toHaveLength(1);
    const fx = result.scene.fixtures[0];
    expect(fx?.name).toBe("F1");
    expect(fx?.gdtfSpec).toBe("Acme@Spot.gdtf");
    expect(fx?.gdtfMode).toBe("Basic");
    expect(fx?.fixtureId).toBe("1");
    expect(fx?.addresses[0]).toEqual({ dmxBreak: 0, address: 12, universe: 1, channel: 12 });
    // Translation {1000,2000,5000} mm → metres.
    expect(fx?.position).toEqual({ x: 1, y: 2, z: 5 });
  });

  it("derives universe + channel from a high absolute address", () => {
    const result = parseMvrScene(sceneXml([fixtureXml("Acme@Spot.gdtf", "Basic", 1, 525)]));
    if (!result.ok) throw new Error("expected ok");
    // 525 → universe 2 (513–1024), channel 13.
    expect(result.scene.fixtures[0]?.addresses[0]).toMatchObject({ universe: 2, channel: 13 });
  });

  it("fails cleanly when the root is missing", () => {
    expect(parseMvrScene("<Nope/>").ok).toBe(false);
    expect(parseMvrScene("not xml <<<").ok).toBe(false);
  });
});

describe("resolveMvrRig", () => {
  it("groups fixtures by type and resolves the real footprint from the embedded gdtf", async () => {
    const scene = parseMvrScene(sceneXml([
      fixtureXml("Acme@Spot.gdtf", "Basic", 1, 1),
      fixtureXml("Acme@Spot.gdtf", "Basic", 2, 6),
      fixtureXml("Acme@Spot.gdtf", "Basic", 3, 11),
    ]));
    if (!scene.ok) throw new Error("expected ok");
    const files = new Map([["Acme@Spot.gdtf", await gdtfBytes(SPOT_GDTF)]]);
    const rig = await resolveMvrRig(scene.scene, files);
    expect(rig.types).toHaveLength(1);
    expect(rig.types[0]).toMatchObject({
      manufacturer: "Acme",
      name: "Acme Spot",
      modeName: "Basic",
      channels: 5,
      weightKg: 6,
      family: "spot",
      count: 3,
    });
    expect(rig.fixtureCount).toBe(3);
    expect(rig.unresolved).toHaveLength(0);
  });

  it("reports unresolved when the embedded gdtf is missing", async () => {
    const scene = parseMvrScene(sceneXml([fixtureXml("Missing.gdtf", "X", 1, 1)]));
    if (!scene.ok) throw new Error("expected ok");
    const rig = await resolveMvrRig(scene.scene, new Map());
    expect(rig.types).toHaveLength(0);
    expect(rig.unresolved).toContain("Missing.gdtf");
    expect(rig.fixtureCount).toBe(0);
  });
});
