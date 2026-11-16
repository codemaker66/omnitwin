import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OVERHEAD_ORIENTATION, parseSurveyRecord, SurveyRecordError, type SurveyRecord } from "../survey-record.js";

/** The hand-built Saloon record, as raw JSON a test may change. */
interface RawExtent { x: number[]; z: number[] }

interface RawRecord {
  [key: string]: unknown;
  room: { outline: [number, number][]; [key: string]: unknown };
  atlas: { files?: string[]; [key: string]: unknown };
  walls: { id: string; reliefId: string; length: number; atlas: number[]; [key: string]: unknown }[];
  relief: { file: string; order: string[]; [key: string]: unknown };
  ceiling: { files: string[]; extent?: RawExtent; orientation?: string; relief?: { file: string; [key: string]: unknown }; [key: string]: unknown };
  floor: { files: string[]; extent?: RawExtent; orientation?: string };
  files: Record<string, { bytes: number; sha256: string }>;
}

const FIXTURE_TEXT = readFileSync(path.resolve("src/components/surveyed-room/__tests__/fixtures/saloon-survey.fixture.json"), "utf-8");

function saloon(): RawRecord {
  return JSON.parse(FIXTURE_TEXT) as RawRecord;
}

function wallOf(record: RawRecord, id: string): RawRecord["walls"][number] {
  const wall = record.walls.find((candidate) => candidate.id === id);
  if (wall === undefined) throw new Error(`no wall ${id}`);
  return wall;
}

/** The faults a record is refused for. */
function faults(record: unknown): readonly string[] {
  try {
    parseSurveyRecord(record);
  } catch (error) {
    if (error instanceof SurveyRecordError) return error.faults;
    throw error;
  }
  throw new Error("the record was accepted");
}

describe("survey.json, schema version 2", () => {
  it("reads the Saloon's record, dropping the keys the web does not use", () => {
    const record: SurveyRecord = parseSurveyRecord(saloon());
    expect(record.slug).toBe("saloon");
    expect(record.revision).toBe(1);
    expect(record.captured).toBe("2026-07-11");
    expect(record.room.venue).toBe("trades-hall");
    expect(record.room.outline).toHaveLength(12);
    expect(record.walls.map((wall) => wall.atlas.slice(0, 3))).toEqual([
      [0, 0, 1402], [1410, 0, 432], [1850, 0, 48], [1906, 0, 1554], [3468, 0, 39], [3515, 0, 453],
      [0, 1119, 1421], [1429, 1119, 440], [1877, 1119, 36], [1921, 1119, 1557], [3486, 1119, 46], [3540, 1119, 442],
    ]);
    expect(record.ceiling.relief?.id).toBe("ceiling");
    expect(record.atlas.files).toEqual(["walls-4096.webp", "walls-2048.webp"]);
    expect(record.ceiling.files).toEqual(["ceiling-1829.webp", "ceiling-915.webp"]);
    expect(record.floor.files).toEqual(["floor-1463.webp", "floor-732.webp"]);
    expect(record.floor.extent).toEqual({ x: [-6.096, 6.095], z: [-3.734, 3.739] });
    expect(record.floor.extent).toEqual(record.ceiling.extent);
    expect(record.ceiling.orientation).toBe(OVERHEAD_ORIENTATION);
    expect(record.floor.orientation).toBe(OVERHEAD_ORIENTATION);
    expect(Object.keys(record.files)).toHaveLength(8);
    expect("methodRevision" in record).toBe(false);
    expect("configSha256" in record).toBe(false);
    expect("alpha" in record.atlas).toBe(false);
  });

  it("accepts a wall up to 2 mm off its segment, and a ceiling without a relief", () => {
    const record = saloon();
    wallOf(record, "front").length = 7.0099;
    delete record.ceiling.relief;
    delete record.files["ceiling-relief.bin"];
    expect(() => parseSurveyRecord(record)).not.toThrow();
  });

  it("refuses another version with one plain reason", () => {
    const old = saloon();
    old.schemaVersion = 1;
    // Says what a version 1 record is and what would cure it, never to republish with tools that would write version 1 again.
    expect(faults(old)).toEqual([
      "schemaVersion is 1; this reader reads version 2 only (version 1 is what the survey tools wrote before their publish step wrote version 2, without the room, wall heights, atlas images or floor this reader needs: the room must be built again by tools that write version 2)",
    ]);
    const newer = saloon();
    newer.schemaVersion = 3;
    expect(faults(newer)).toEqual(["schemaVersion is 3; this reader reads version 2 only"]);
    const unversioned = saloon();
    delete unversioned.schemaVersion;
    expect(faults(unversioned)).toEqual(["schemaVersion is missing; this reader reads version 2 only"]);
    expect(() => parseSurveyRecord("survey")).toThrow(/is not a JSON object/);
  });

  it("names the file in its message", () => {
    const record = saloon();
    record.walls.pop();
    expect(() => parseSurveyRecord(record)).toThrow(/^survey\.json: walls: has 11 walls but the outline has 12 segments/);
  });

  it("refuses an outline of fewer than three vertices", () => {
    const record = saloon();
    record.room.outline = [[0, 0], [1, 0]];
    expect(faults(record)).toContainEqual(expect.stringMatching(/^room\.outline: the outline has 2 vertices; a room needs at least 3/));
  });

  it("refuses an outline that crosses itself", () => {
    const record = saloon();
    const [a, b] = [record.room.outline[0], record.room.outline[1]];
    if (a === undefined || b === undefined) throw new Error("outline too short");
    record.room.outline[0] = b;
    record.room.outline[1] = a;
    expect(faults(record)).toContainEqual(expect.stringMatching(/^room\.outline: the outline crosses itself/));
  });

  it("refuses a clockwise outline", () => {
    const record = saloon();
    record.room.outline.reverse();
    expect(faults(record)).toContainEqual(expect.stringMatching(/^room\.outline: the outline is clockwise/));
  });

  it("refuses a wall count that differs from the outline's segments", () => {
    const record = saloon();
    record.walls.pop();
    expect(faults(record)).toContainEqual(expect.stringMatching(/^walls: has 11 walls but the outline has 12 segments/));
  });

  it("refuses a wall more than 2 mm off its segment's length", () => {
    const record = saloon();
    wallOf(record, "front").length = 7.0055;
    expect(faults(record)).toEqual([
      'walls[0].length: wall "front" is 7.0055 m long but outline segment 0 is 7.0080 m (more than 2 mm apart)',
    ]);
  });

  it("refuses a wall id used twice", () => {
    const record = saloon();
    wallOf(record, "rear").id = "front";
    expect(faults(record)).toEqual(['walls: wall id "front" is used twice']);
  });

  it("refuses a relief id used twice", () => {
    const record = saloon();
    wallOf(record, "rear").reliefId = "front";
    expect(faults(record)).toContainEqual('walls: relief id "front" is used twice');
  });

  it.each([
    ["longer than 12 bytes", "fireplace-fro"],
    ["empty", ""],
    ["not ASCII", `fire${String.fromCharCode(0xe9)}`],
    ["holding a space", "fire place"],
  ])("refuses a relief id %s", (_name, id) => {
    const record = saloon();
    wallOf(record, "fireplace").reliefId = id;
    record.relief.order[9] = id;
    expect(faults(record)).toContainEqual(expect.stringMatching(/^walls\[9\]\.reliefId: must be 1 to 12 printable ASCII characters/));
  });

  it("refuses a strip that leaves the atlas", () => {
    const wide = saloon();
    const end = wallOf(wide, "fireplace-front-end");
    end.atlas[0] = 3700;
    expect(faults(wide)).toEqual(['walls[11].atlas: wall "fireplace-front-end"\'s strip [3700, 1119, 442, 1111] leaves the 4096 x 2304 atlas']);
    const low = saloon();
    wallOf(low, "rear").atlas[1] = 1200;
    expect(faults(low)).toContainEqual(expect.stringMatching(/^walls\[6\]\.atlas: wall "rear"'s strip .* leaves the 4096 x 2304 atlas/));
  });

  it("refuses a strip that overlaps another", () => {
    const record = saloon();
    wallOf(record, "window-front-end").atlas[0] = 1300;
    expect(faults(record)).toEqual(['walls[1].atlas: wall "window-front-end"\'s strip overlaps wall "front"\'s']);
  });

  it("refuses a strip of another height than the atlas's row, or narrower than its wall", () => {
    const short = saloon();
    wallOf(short, "front").atlas[3] = 1100;
    expect(faults(short)).toEqual(['walls[0].atlas: wall "front"\'s strip is 1100 texels high but the atlas\'s row is 1111']);
    const narrow = saloon();
    wallOf(narrow, "front").atlas[2] = 1400;
    expect(faults(narrow)).toEqual(['walls[0].atlas: wall "front" (7.008 m at 200 texels per metre) is wider than its 1400-texel strip']);
  });

  it("refuses an atlas whose row is not the heights its strips cover at its texels per metre", () => {
    // 100 texels per metre for an atlas packed at 200: every strip's own checks pass, and each wall would wear a quarter of its strip.
    const halved = saloon();
    halved.atlas.ppm = 100;
    expect(faults(halved)).toEqual([
      "atlas.row: is 1111 texels, but vRange [-0.02, 5.535] at 100 texels per metre is 555.50: a strip's height must be the heights it covers, to within 1 texel",
    ]);
    // A texel either way is the tools' rounding (the Grand Hall's row of 1304 covers 1303.45).
    const rounded = saloon();
    rounded.atlas.row = 1112;
    for (const wall of rounded.walls) wall.atlas[3] = 1112;
    expect(parseSurveyRecord(rounded).atlas.row).toBe(1112);
    const twoOut = saloon();
    twoOut.atlas.row = 1113;
    for (const wall of twoOut.walls) wall.atlas[3] = 1113;
    expect(faults(twoOut)).toHaveLength(1);
  });

  it("refuses a wall taller than the heights its strip of the atlas covers", () => {
    // The Saloon's strips cover -0.02 m to 5.535 m.
    const tall = saloon();
    wallOf(tall, "rear").height = 6;
    expect(faults(tall)).toEqual([
      'walls[6].height: wall "rear" is 6 m high, but the atlas\'s strips cover heights up to 5.535 m (vRange), more than 5 mm short of it',
    ]);
    // To the strip's top and the 5 mm a relief may stand past it is a wall its strip covers.
    const toTheTop = saloon();
    wallOf(toTheTop, "rear").height = 5.539;
    expect(parseSurveyRecord(toTheTop).walls[6]?.height).toBe(5.539);
  });

  it("refuses a flat ceiling that does not meet the tallest wall's top", () => {
    const flat = (ceilingHeight: number): RawRecord => {
      const record = saloon();
      delete record.ceiling.relief;
      delete record.files["ceiling-relief.bin"];
      record.room.ceilingHeight = ceilingHeight;
      return record;
    };
    // Above the walls a band of nothing would show; below their tops they would stand through it.
    expect(faults(flat(6))).toEqual([
      "room.ceilingHeight: is 6 m, but the tallest wall is 5.515 m high and the ceiling has no relief: a flat ceiling is drawn at this height, and must meet the walls' tops to within 5 mm",
    ]);
    expect(faults(flat(5.2))).toEqual([expect.stringMatching(/^room\.ceilingHeight: is 5\.2 m, but the tallest wall is 5\.515 m high/)]);
    expect(parseSurveyRecord(flat(5.519)).room.ceilingHeight).toBe(5.519);
    // It is the tallest wall it meets: a lower wall under it (a screen, a pier under a soffit) is no fault.
    const screened = flat(5.515);
    wallOf(screened, "window-front-return").height = 2.4;
    expect(() => parseSurveyRecord(screened)).not.toThrow();
    // A ceiling with a relief is drawn from its measured heights, whatever the walls' (a coffered
    // ceiling's field stands below the tops of the walls that rise into its panels).
    const coffered = saloon();
    coffered.room.ceilingHeight = 5.1;
    expect(parseSurveyRecord(coffered).room.ceilingHeight).toBe(5.1);
  });

  it("refuses a relief order that is not exactly the walls' relief ids", () => {
    const missing = saloon();
    missing.relief.order.pop();
    expect(faults(missing)).toEqual(["relief.order: must list each wall's relief id exactly once; it leaves out fire-f-end"]);
    const extra = saloon();
    extra.relief.order.push("ceiling");
    expect(faults(extra)).toEqual(["relief.order: must list each wall's relief id exactly once; it names ceiling, which no wall has"]);
    const repeated = saloon();
    repeated.relief.order[11] = "front";
    expect(faults(repeated)).toEqual(["relief.order: must list each wall's relief id exactly once; it leaves out fire-f-end and repeats front"]);
  });

  it.each([
    ["an atlas image", "walls-2048.webp", "atlas.files[1]"],
    ["the walls' relief", "walls-relief.bin", "relief.file"],
    ["a ceiling image", "ceiling-915.webp", "ceiling.files[1]"],
    ["a floor image", "floor-1463.webp", "floor.files[0]"],
    ["the ceiling's relief", "ceiling-relief.bin", "ceiling.relief.file"],
  ])("refuses %s missing from files", (_name, file, where) => {
    const record = saloon();
    record.files = Object.fromEntries(Object.entries(record.files).filter(([name]) => name !== file));
    expect(faults(record)).toEqual([`${where}: names "${file}", which is missing from files`]);
  });

  it("refuses a file name that would leave the room's folder", () => {
    const record = saloon();
    record.floor.files[0] = "../floor-1463.webp";
    expect(faults(record)).toContainEqual(expect.stringMatching(/^floor\.files\[0\]: must be a plain file name/));
  });

  it("refuses a version 1 record relabelled as version 2, naming the missing room", () => {
    const record: Record<string, unknown> = saloon();
    delete record.room;
    expect(faults(record)).toContainEqual(expect.stringMatching(/^room: /));
  });

  it("refuses a record without the atlas's images", () => {
    const missing = saloon();
    delete missing.atlas.files;
    expect(faults(missing)).toContainEqual(expect.stringMatching(/^atlas\.files: /));
    const empty = saloon();
    empty.atlas.files = [];
    expect(faults(empty)).toEqual(["atlas.files: must name at least one atlas image"]);
  });

  it("refuses a floor without the extent its photograph covers, or with one that does not increase", () => {
    const missing = saloon();
    delete missing.floor.extent;
    expect(faults(missing)).toContainEqual(expect.stringMatching(/^floor\.extent: /));
    const backwards = saloon();
    backwards.floor.extent = { x: [6.095, -6.096], z: [-3.734, 3.739] };
    expect(faults(backwards)).toEqual(["floor.extent.x: must increase ([low, high])"]);
  });

  it("refuses a floor or ceiling photograph that does not cover the outline", () => {
    // The floor's photograph cropped to the Saloon's main rectangle: the recessed middles of its two
    // long walls, 0.24 m and 0.225 m deep, would wear the photograph's edge rows smeared across them.
    const cropped = saloon();
    cropped.floor.extent = { x: [-6.096, 6.095], z: [-3.494, 3.514] };
    expect(faults(cropped)).toEqual([
      "floor.extent.z: covers -3.494 m to 3.514 m, but the outline runs from -3.734 m to 3.739 m along z, more than 5 mm outside it: the floor's photograph must cover the whole outline",
    ]);
    // The ceiling's the same, on either axis and at either end.
    const narrow = saloon();
    narrow.ceiling.extent = { x: [-6.09, 6.095], z: [-3.734, 3.739] };
    expect(faults(narrow)).toEqual([
      "ceiling.extent.x: covers -6.09 m to 6.095 m, but the outline runs from -6.096 m to 6.095 m along x, more than 5 mm outside it: the ceiling's photograph must cover the whole outline",
    ]);
    const both = saloon();
    both.floor.extent = { x: [-6.096, 6], z: [-3, 3.739] };
    expect(faults(both)).toEqual([
      expect.stringMatching(/^floor\.extent\.x: covers -6\.096 m to 6 m, but the outline runs from -6\.096 m to 6\.095 m along x/),
      expect.stringMatching(/^floor\.extent\.z: covers -3 m to 3\.739 m, but the outline runs from -3\.734 m to 3\.739 m along z/),
    ]);
  });

  it("accepts a floor photograph half a texel short of the outline's box, and one larger than it", () => {
    // The tools lay the floor's photograph in whole texels of 1/120 m from the box's lowest x and
    // highest z, so its extent stops up to half a texel (4.17 mm) short of the other two sides.
    const short = saloon();
    short.floor.extent = { x: [-6.096, 6.091], z: [-3.73, 3.739] };
    expect(parseSurveyRecord(short).floor.extent).toEqual({ x: [-6.096, 6.091], z: [-3.73, 3.739] });
    // A millimetre past the tolerance is a photograph that does not cover its floor.
    const shorter = saloon();
    shorter.floor.extent = { x: [-6.096, 6.089], z: [-3.734, 3.739] };
    expect(faults(shorter)).toEqual([expect.stringMatching(/^floor\.extent\.x: covers -6\.096 m to 6\.089 m/)]);
    // Or runs past them, as the Saloon's own does; and a photograph of more than the room is no fault.
    const past = saloon();
    past.floor.extent = { x: [-6.096, 6.095833], z: [-3.736, 3.739] };
    past.ceiling.extent = { x: [-7, 7], z: [-4.5, 4.5] };
    expect(() => parseSurveyRecord(past)).not.toThrow();
  });

  it("accepts a ceiling and a floor that publish no photograph, and one size of each image", () => {
    const bare = saloon();
    bare.ceiling.files = [];
    bare.floor.files = [];
    expect(parseSurveyRecord(bare).floor.files).toEqual([]);
    const single = saloon();
    single.atlas.files = ["walls-4096.webp"];
    single.floor.files = ["floor-1463.webp"];
    expect(parseSurveyRecord(single).atlas.files).toEqual(["walls-4096.webp"]);
  });

  it.each(["atlas", "ceiling", "floor"] as const)("refuses %s images listed smallest first, by their byte counts", (part) => {
    const record = saloon();
    const [larger, smaller] = record[part].files ?? [];
    if (larger === undefined || smaller === undefined) throw new Error("the fixture lists two sizes");
    const zero = "0".repeat(64);
    record.files[larger] = { bytes: 900_000, sha256: zero };
    record.files[smaller] = { bytes: 240_000, sha256: zero };
    expect(() => parseSurveyRecord(record)).not.toThrow();
    record[part].files = [smaller, larger];
    expect(faults(record)).toEqual([
      `${part}.files[1]: must list the largest image first, but "${larger}" (900000 bytes) follows the smaller "${smaller}" (240000 bytes)`,
    ]);
  });

  it("refuses an image listed twice", () => {
    const record = saloon();
    record.floor.files = ["floor-1463.webp", "floor-1463.webp"];
    expect(faults(record)).toEqual(['floor.files: names "floor-1463.webp" twice']);
  });

  it("refuses an overhead photograph laid any other way than the tools lay one", () => {
    const record = saloon();
    record.floor.orientation = "columns planner +z, rows from planner +x";
    expect(faults(record)).toEqual([`floor.orientation: must be "${OVERHEAD_ORIENTATION}" (the only orientation this reader draws)`]);
    const unstated = saloon();
    delete unstated.floor.orientation;
    delete unstated.ceiling.orientation;
    expect(() => parseSurveyRecord(unstated)).not.toThrow();
  });
});
