import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diaryRoomPhoto } from "../diary-room-photos.js";
import { SUPPLIED_ROOM_STILLS } from "../room-posters.js";

// Resolve through node:path so Vite does not rewrite this as a served asset URL.
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../public");

function publicAsset(path: string): Buffer {
  return readFileSync(resolve(publicRoot, path.slice(1)));
}

describe("Diary room photographs", () => {
  it("uses a real WebP asset for each supplied room identity", () => {
    for (const slug of Object.keys(SUPPLIED_ROOM_STILLS)) {
      const photo = diaryRoomPhoto(slug);
      expect(photo, slug).not.toBeNull();
      if (photo === null) throw new Error(`Missing photo for ${slug}`);
      expect(photo.src).not.toBe(`/images/rooms/${slug}.jpg`);
      for (const path of [photo.src, ...(photo.srcSet?.split(", ").map((entry) => entry.split(" ")[0] ?? "") ?? [])]) {
        const bytes = publicAsset(path);
        expect(bytes.toString("ascii", 0, 4), path).toBe("RIFF");
        expect(bytes.toString("ascii", 8, 12), path).toBe("WEBP");
      }
    }
  });

  it("does not invent an image for unknown, differently spelled or prototype names", () => {
    for (const slug of ["unknown-room", "Grand Hall", "__proto__", "constructor", "toString", "../grand-hall", ""]) {
      expect(diaryRoomPhoto(slug)).toBeNull();
    }
  });

  it("keeps the room-only Robert Adam source distinct from the bridal portrait", () => {
    expect(diaryRoomPhoto("robert-adam-room")?.src).toBe("/images/rooms/diary/robert-adam-room-240.webp");
    const source = publicAsset(SUPPLIED_ROOM_STILLS["robert-adam-room"] ?? "");
    expect(createHash("sha256").update(source).digest("hex")).toBe("0919e3c9fae9dedc0ea14d618cbde38f2837c83faff1b03ceceb879c4b77fb5e");
  });
});
