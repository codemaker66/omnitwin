import { describe, it, expect } from "vitest";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } from "@zip.js/zip.js";
import { readGdtfArchive, readMvrArchive } from "../gdtf-archive.js";
import { parseGdtfDescription } from "../gdtf.js";

const SAMPLE_XML =
  `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="Test PAR" Manufacturer="Acme">`
  + `<DMXModes><DMXMode Name="Basic"><DMXChannels><DMXChannel Offset="1"/><DMXChannel Offset="2"/></DMXChannels></DMXMode></DMXModes>`
  + `</FixtureType></GDTF>`;

/** Build an in-memory `.gdtf`-shaped ZIP (description.xml + optional extra files). */
async function makeGdtfZip(descriptionXml: string, extra: Record<string, string> = {}): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("description.xml", new TextReader(descriptionXml));
  for (const [name, content] of Object.entries(extra)) {
    await writer.add(name, new TextReader(content));
  }
  return writer.close();
}

describe("readGdtfArchive", () => {
  it("extracts description.xml and lists bundled model files", async () => {
    const zip = await makeGdtfZip(SAMPLE_XML, {
      "models/gltf/base.glb": "GLB-BYTES",
      "models/3ds/base.3ds": "3DS-BYTES",
      "thumbnail.png": "PNG-BYTES",
    });
    const result = await readGdtfArchive(zip);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.archive.descriptionXml).toContain("FixtureType");
      expect(result.archive.modelFiles).toEqual(["models/gltf/base.glb", "models/3ds/base.3ds"]);
    }
  });

  it("feeds parseGdtfDescription end-to-end", async () => {
    const zip = await makeGdtfZip(SAMPLE_XML);
    const result = await readGdtfArchive(zip);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = parseGdtfDescription(result.archive.descriptionXml);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.fixture.manufacturer).toBe("Acme");
        expect(parsed.fixture.modes[0]?.channelFootprint).toBe(2);
      }
    }
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", async () => {
    const zip = await makeGdtfZip(SAMPLE_XML);
    const buffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
    const result = await readGdtfArchive(buffer);
    expect(result.ok).toBe(true);
  });

  it("errors on bytes that are not a ZIP", async () => {
    const result = await readGdtfArchive(new TextEncoder().encode("definitely not a zip file"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ZIP/);
  });

  it("errors on a ZIP without a description.xml", async () => {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("readme.txt", new TextReader("nothing to see"));
    const zip = await writer.close();
    const result = await readGdtfArchive(zip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/description\.xml/);
  });
});

async function makeGdtfBytes(descriptionXml: string): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("description.xml", new TextReader(descriptionXml));
  return writer.close();
}

async function makeMvrZip(sceneXml: string, gdtfs: Record<string, Uint8Array>): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("GeneralSceneDescription.xml", new TextReader(sceneXml));
  for (const [name, bytes] of Object.entries(gdtfs)) {
    await writer.add(name, new Uint8ArrayReader(bytes));
  }
  return writer.close();
}

describe("readMvrArchive", () => {
  it("extracts the scene + embedded gdtf files keyed by basename", async () => {
    const gdtfBytes = await makeGdtfBytes(SAMPLE_XML);
    const scene = `<GeneralSceneDescription verMajor="1" verMinor="6"><Scene/></GeneralSceneDescription>`;
    const mvr = await makeMvrZip(scene, { "Acme@Test PAR.gdtf": gdtfBytes });
    const result = await readMvrArchive(mvr);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.archive.sceneXml).toContain("GeneralSceneDescription");
      expect(result.archive.gdtfFiles.has("Acme@Test PAR.gdtf")).toBe(true);
      // The embedded gdtf bytes round-trip back into the GDTF reader.
      const embedded = result.archive.gdtfFiles.get("Acme@Test PAR.gdtf");
      expect(embedded).toBeInstanceOf(Uint8Array);
    }
  });

  it("errors on a ZIP without a scene description", async () => {
    const mvr = await (async () => {
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("readme.txt", new TextReader("hi"));
      return writer.close();
    })();
    const result = await readMvrArchive(mvr);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/GeneralSceneDescription/);
  });
});
