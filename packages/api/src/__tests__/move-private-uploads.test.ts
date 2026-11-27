import { describe, expect, it } from "vitest";
import { movePrivateUploads, type MoveObjectStore } from "../scripts/move-private-uploads.js";

// ---------------------------------------------------------------------------
// Private uploads written to the public bucket before #134 move to the private
// bucket with their keys unchanged: copied, checked, and only then deleted
// from the public bucket. The buckets are fakes that hold bytes in memory and
// can be told to fail one step for one key.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const ENQUIRY_FILE = `private/venues/${VENUE}/enquiries/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003.pdf`;
const LOADOUT_PHOTO = `private/venues/${VENUE}/loadouts/00000000-0000-4000-8000-000000000004/00000000-0000-4000-8000-000000000005.jpg`;
const MARKETING = "public/marketing/hero/00000000-0000-4000-8000-000000000006.jpg";
const SPLAT = "splats/trades-hall/grand-hall/0_0.sog";

type Step = "read" | "write" | "remove";

class FakeBucket implements MoveObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string | undefined }>();
  readonly failing = new Map<string, Step>();
  /** A write that stores fewer bytes than it was given, as a broken copy would. */
  readonly truncating = new Set<string>();
  writes = 0;

  constructor(entries: readonly (readonly [string, string, string?])[] = []) {
    for (const [key, text, contentType] of entries) {
      this.objects.set(key, { body: new TextEncoder().encode(text), contentType });
    }
  }

  private check(key: string, step: Step): void {
    if (this.failing.get(key) === step) throw new Error(`R2 answered 500 on ${step}`);
  }

  list(prefix: string): Promise<readonly { key: string; size: number }[]> {
    return Promise.resolve([...this.objects].filter(([key]) => key.startsWith(prefix))
      .map(([key, { body }]) => ({ key, size: body.byteLength })));
  }

  size(key: string): Promise<number | null> {
    return Promise.resolve(this.objects.get(key)?.body.byteLength ?? null);
  }

  read(key: string): Promise<{ body: Uint8Array; contentType: string | undefined }> {
    this.check(key, "read");
    const object = this.objects.get(key);
    if (object === undefined) return Promise.reject(new Error("no such key"));
    return Promise.resolve(object);
  }

  write(key: string, body: Uint8Array, contentType: string | undefined): Promise<void> {
    this.check(key, "write");
    this.writes += 1;
    this.objects.set(key, { body: this.truncating.has(key) ? body.slice(1) : body, contentType });
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.check(key, "remove");
    this.objects.delete(key);
    return Promise.resolve();
  }

  text(key: string): string | undefined {
    const object = this.objects.get(key);
    return object === undefined ? undefined : new TextDecoder().decode(object.body);
  }
}

function publicBucket(): FakeBucket {
  return new FakeBucket([
    [ENQUIRY_FILE, "the client's floor plan", "application/pdf"],
    [LOADOUT_PHOTO, "the dinner reset", "image/jpeg"],
    [MARKETING, "the hero image", "image/jpeg"],
    [SPLAT, "tile bytes"],
  ]);
}

describe("moving private uploads out of the public bucket", () => {
  it("writes nothing without --apply, and says what it would move", async () => {
    const source = publicBucket();
    const destination = new FakeBucket();

    const report = await movePrivateUploads(source, destination, { apply: false });

    expect(report).toEqual({ found: 2, copied: 2, alreadyMoved: 0, removed: 0, failed: [] });
    expect(destination.writes).toBe(0);
    expect([...source.objects.keys()].sort()).toEqual([ENQUIRY_FILE, LOADOUT_PHOTO, MARKETING, SPLAT].sort());
  });

  it("moves each private object under the same key and type, and leaves every other prefix", async () => {
    const source = publicBucket();
    const destination = new FakeBucket();

    const report = await movePrivateUploads(source, destination, { apply: true });

    expect(report).toEqual({ found: 2, copied: 2, alreadyMoved: 0, removed: 2, failed: [] });
    expect(destination.text(ENQUIRY_FILE)).toBe("the client's floor plan");
    expect(destination.objects.get(ENQUIRY_FILE)?.contentType).toBe("application/pdf");
    expect(destination.text(LOADOUT_PHOTO)).toBe("the dinner reset");
    expect([...source.objects.keys()].sort()).toEqual([MARKETING, SPLAT].sort());
    expect([...destination.objects.keys()].sort()).toEqual([ENQUIRY_FILE, LOADOUT_PHOTO].sort());
  });

  it("keeps the original when its copy fails, is short, or cannot be read, and moves the rest", async () => {
    for (const [fault, expectReason] of [
      ["write", /500 on write/u],
      ["truncate", /not the original's size/u],
      ["read", /500 on read/u],
    ] as const) {
      const source = publicBucket();
      const destination = new FakeBucket();
      if (fault === "write") destination.failing.set(ENQUIRY_FILE, "write");
      if (fault === "truncate") destination.truncating.add(ENQUIRY_FILE);
      if (fault === "read") source.failing.set(ENQUIRY_FILE, "read");

      const report = await movePrivateUploads(source, destination, { apply: true });

      expect(report.found).toBe(2);
      expect(report.removed).toBe(1);
      expect(report.failed).toEqual([{ key: ENQUIRY_FILE, reason: expect.stringMatching(expectReason) as unknown }]);
      expect(source.text(ENQUIRY_FILE)).toBe("the client's floor plan");
      expect(source.objects.has(LOADOUT_PHOTO)).toBe(false);
      expect(destination.text(LOADOUT_PHOTO)).toBe("the dinner reset");
    }
  });

  it("resumes a run that stopped part-way without copying again", async () => {
    const source = publicBucket();
    const destination = new FakeBucket();
    source.failing.set(LOADOUT_PHOTO, "remove");

    const first = await movePrivateUploads(source, destination, { apply: true });
    expect(first.failed.map(({ key }) => key)).toEqual([LOADOUT_PHOTO]);
    expect(source.objects.has(LOADOUT_PHOTO)).toBe(true);
    expect(destination.text(LOADOUT_PHOTO)).toBe("the dinner reset");

    source.failing.clear();
    const writesBefore = destination.writes;
    const second = await movePrivateUploads(source, destination, { apply: true });

    expect(second).toEqual({ found: 1, copied: 0, alreadyMoved: 1, removed: 1, failed: [] });
    expect(destination.writes).toBe(writesBefore);
    expect(source.objects.has(LOADOUT_PHOTO)).toBe(false);
  });

  it("replaces a partial copy already in the private bucket", async () => {
    const source = publicBucket();
    const destination = new FakeBucket([[ENQUIRY_FILE, "the client's"]]);

    const report = await movePrivateUploads(source, destination, { apply: true });

    expect(report).toEqual({ found: 2, copied: 2, alreadyMoved: 0, removed: 2, failed: [] });
    expect(destination.text(ENQUIRY_FILE)).toBe("the client's floor plan");
  });
});
