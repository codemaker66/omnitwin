import { describe, it, expect } from "vitest";
import { parseGdtfDescription, gdtfFixtureFamily, type GdtfFixture } from "../gdtf.js";

// A small but schema-faithful GDTF description: a generic LED PAR with two DMX
// modes (a flat 7-channel mode and a mode with a 16-bit channel + a virtual one),
// a weight, and two revisions.
const PAR_GDTF = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2">
  <FixtureType Name="Pixel PAR" ShortName="PXPAR" LongName="Generic Pixel PAR Q7"
               Manufacturer="Generic" FixtureTypeID="A1B2C3D4-0000-1111-2222-333344445555">
    <Revisions>
      <Revision Text="Initial release" Date="2024-01-15T10:00:00"/>
      <Revision Text="Corrected power figure" Date="2024-03-02T09:30:00"/>
    </Revisions>
    <PhysicalDescriptions>
      <Properties>
        <Weight Value="3.2"/>
      </Properties>
    </PhysicalDescriptions>
    <DMXModes>
      <DMXMode Name="Standard 7ch" Geometry="Base">
        <DMXChannels>
          <DMXChannel Geometry="Base" Offset="1"/>
          <DMXChannel Geometry="Base" Offset="2"/>
          <DMXChannel Geometry="Base" Offset="3"/>
          <DMXChannel Geometry="Base" Offset="4"/>
          <DMXChannel Geometry="Base" Offset="5"/>
          <DMXChannel Geometry="Base" Offset="6"/>
          <DMXChannel Geometry="Base" Offset="7"/>
        </DMXChannels>
      </DMXMode>
      <DMXMode Name="16-bit Dim" Geometry="Base">
        <DMXChannels>
          <DMXChannel Geometry="Base" Offset="1,2"/>
          <DMXChannel Geometry="Base" Offset="3"/>
          <DMXChannel Geometry="Base" Offset="None"/>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

const WASH_GDTF = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2">
  <FixtureType Name="MH Wash 19" LongName="Moving Head Wash 19x40W" Manufacturer="Acme">
    <DMXModes>
      <DMXMode Name="Extended">
        <DMXChannels>
          <DMXChannel Offset="1,2"/>
          <DMXChannel Offset="3,4"/>
          <DMXChannel Offset="5"/>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

function parseOk(xml: string): GdtfFixture {
  const result = parseGdtfDescription(xml);
  if (!result.ok) throw new Error(`expected ok parse, got: ${result.error}`);
  return result.fixture;
}

describe("parseGdtfDescription", () => {
  it("reads identity, preferring LongName for the model", () => {
    const f = parseOk(PAR_GDTF);
    expect(f.manufacturer).toBe("Generic");
    expect(f.name).toBe("Generic Pixel PAR Q7");
    expect(f.shortName).toBe("PXPAR");
    expect(f.fixtureTypeId).toBe("A1B2C3D4-0000-1111-2222-333344445555");
  });

  it("reads revisions with their dates", () => {
    const f = parseOk(PAR_GDTF);
    expect(f.revisions).toHaveLength(2);
    expect(f.revisions[0]?.text).toBe("Initial release");
    expect(f.revisions[0]?.date).toBe("2024-01-15T10:00:00");
    expect(f.revisions[1]?.text).toBe("Corrected power figure");
  });

  it("computes each mode's channel footprint", () => {
    const f = parseOk(PAR_GDTF);
    expect(f.modes.map((m) => m.name)).toEqual(["Standard 7ch", "16-bit Dim"]);
    const flat = f.modes[0];
    expect(flat?.channelFootprint).toBe(7);
    expect(flat?.usedChannels).toBe(7);
    // 16-bit channel "1,2" + "3"; the virtual ("None") channel occupies nothing.
    const wide = f.modes[1];
    expect(wide?.channelFootprint).toBe(3);
    expect(wide?.usedChannels).toBe(3);
    expect(wide?.channels[0]?.offsets).toEqual([1, 2]);
    expect(wide?.channels[2]?.offsets).toEqual([]);
  });

  it("reads best-effort weight", () => {
    expect(parseOk(PAR_GDTF).physical.weightKg).toBe(3.2);
    expect(parseOk(WASH_GDTF).physical.weightKg).toBeNull();
  });

  it("takes the highest offset as the footprint regardless of channel order", () => {
    const f = parseOk(WASH_GDTF);
    const mode = f.modes[0];
    expect(mode?.channelFootprint).toBe(5);
    expect(mode?.usedChannels).toBe(5);
  });

  it("fails cleanly when there is no FixtureType", () => {
    const result = parseGdtfDescription(`<?xml version="1.0"?><GDTF DataVersion="1.2"></GDTF>`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/FixtureType/);
  });

  it("fails cleanly on input that is not a GDTF description", () => {
    expect(parseGdtfDescription("this is not xml at all <<<").ok).toBe(false);
    expect(parseGdtfDescription("").ok).toBe(false);
  });
});

describe("gdtfFixtureFamily", () => {
  it("maps a PAR by name", () => {
    expect(gdtfFixtureFamily(parseOk(PAR_GDTF))).toBe("par");
  });

  it("maps a wash by name", () => {
    expect(gdtfFixtureFamily(parseOk(WASH_GDTF))).toBe("wash");
  });

  it("returns null when nothing matches", () => {
    const f = parseOk(`<?xml version="1.0"?><GDTF><FixtureType Name="XJ-9000" Manufacturer="Acme"><DMXModes/></FixtureType></GDTF>`);
    expect(gdtfFixtureFamily(f)).toBeNull();
  });
});
