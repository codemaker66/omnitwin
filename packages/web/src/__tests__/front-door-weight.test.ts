import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRADES_HALL_RUNTIME_ROOMS } from "@omnitwin/types";
import { GENERATED_ROOM_SPLAT_BUNDLES } from "../data/generated/trades-hall-splat-bundles.js";
import { ROOM_CARD_FACTS } from "../data/generated/room-card-facts.js";

// ---------------------------------------------------------------------------
// What the front door is allowed to load.
//
// On 16 October the home page shipped 40 KB of generated splat-tile digests
// and the whole Clerk chunk to every visitor, though it reads four numbers and
// a name per room and never signs anyone in. Both arrived through a harmless
// looking static import. These pin the way back out: the card facts match the
// manifest they were copied from, and the modules every visitor loads do not
// import the heavy ones.
// ---------------------------------------------------------------------------

const src = join(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(src, file), "utf8");

/** Module specifiers of every value `import … from "x"` and `import "x"`. */
function staticImports(source: string): readonly string[] {
  return [...source.matchAll(/^import\s+(?:type\s+)?(?:[^"';]*?from\s+)?"([^"]+)";?$/gmu)]
    .filter((match) => !/^import\s+type\b/u.test(match[0]))
    .map((match) => match[1] ?? "");
}

describe("room card facts", () => {
  it("are the manifest's own values, room for room", () => {
    // Failing here means the manifest was regenerated: run
    // `node scripts/derive-room-card-facts.mjs` in packages/web.
    expect(ROOM_CARD_FACTS).toEqual(GENERATED_ROOM_SPLAT_BUNDLES.map((bundle) => ({
      roomSlug: bundle.roomSlug,
      displayName: TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === bundle.roomSlug)?.displayName ?? bundle.roomSlug,
      alignmentConfidence: bundle.alignmentConfidence,
      extentM: bundle.extentM,
      finestLevelSplats: bundle.finestLevelSplats,
    })));
  });
});

describe("modules every visitor loads", () => {
  const heavy = [/room-splat-bundles/u, /trades-hall-splat-bundles/u, /runtime-package-resolution/u, /^@clerk\//u];

  it.each([
    "pages/RoomsHomePage.tsx",
    "lib/room-card-copy.ts",
    "data/room-card-facts.ts",
    "components/auth/ProtectedRoute.tsx",
  ])("%s imports neither the splat manifest nor Clerk", (file) => {
    for (const specifier of staticImports(read(file))) {
      for (const pattern of heavy) expect(specifier, `${file} -> ${specifier}`).not.toMatch(pattern);
    }
  });

  it("loads Clerk's sign-out only when a refusal screen needs it", () => {
    expect(read("components/auth/ProtectedRoute.tsx")).toMatch(/lazy\(\(\) => import\("\.\/ClerkExitButton\.js"\)/u);
  });
});
