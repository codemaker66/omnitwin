import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// localStorage cap (#18) — bounded growth tripwire
//
// `omnitwin_my_configs` was an unbounded audit log that grew on every public
// config creation. Three concrete harms:
//   1. JSON.parse on every create scaled with history length
//   2. Competing for the 5 MB localStorage budget against future stores
//   3. QuotaExceededError (storage full) and SecurityError (private mode)
//      were unhandled and broke the createPublicConfig flow
//
// Fix: cap the array at MAX_TRACKED_CONFIGS=50 with FIFO eviction, wrap
// the entire localStorage block in try/catch so persistence is best-effort.
//
// These tests have two halves:
//   - Behavioural (3 tests): mock createPublicConfig and exercise the cap
//     against happy-dom's localStorage shim. Pre-seed with N entries, call
//     the action, assert the resulting array shape.
//   - Source-grep (2 tests): pin the structural properties so the cap value
//     and the try/catch wrapper can't be silently removed.
// ---------------------------------------------------------------------------

vi.mock("../api/configurations.js", () => ({
  getPublicConfig: vi.fn(),
  getConfig: vi.fn(),
  createPublicConfig: vi.fn(),
  publicBatchSave: vi.fn(),
  authBatchSave: vi.fn(),
  claimConfig: vi.fn(),
  submitGuestEnquiry: vi.fn(),
}));

vi.mock("../api/spaces.js", () => ({
  listVenues: vi.fn(),
  listSpaces: vi.fn(),
  getSpace: vi.fn(),
}));

const configMock = (await import("../api/configurations.js")) as unknown as {
  createPublicConfig: ReturnType<typeof vi.fn>;
};

const { useEditorStore } = await import("../stores/editor-store.js");

const STORAGE_KEY = "omnitwin_my_configs";
const MAX = 50;

interface StoredEntry {
  readonly configId: string;
  readonly createdAt: string;
}

function readStored(): StoredEntry[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredEntry[];
}

function seedEntries(count: number): StoredEntry[] {
  const entries: StoredEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      configId: `seed-${String(i).padStart(4, "0")}`,
      createdAt: new Date(2025, 0, 1, 0, 0, i).toISOString(),
    });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  return entries;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useEditorStore.getState().reset();
});

// ---------------------------------------------------------------------------
// Behavioural — exercise the cap against happy-dom's localStorage
// ---------------------------------------------------------------------------

describe("createPublicConfig localStorage cap (#18) — behavioural", () => {
  it("evicts oldest entry when adding a config at the cap boundary", async () => {
    seedEntries(MAX);
    configMock.createPublicConfig.mockResolvedValue({
      id: "new-cfg", spaceId: "s-1", venueId: "v-1", isPublicPreview: true,
    });

    await useEditorStore.getState().createPublicConfig("s-1");

    const stored = readStored();
    // Cap MUST be respected — no growth past MAX even after adding one more.
    expect(stored).toHaveLength(MAX);
    // The newly created config is at the END (FIFO append).
    expect(stored[stored.length - 1]?.configId).toBe("new-cfg");
    // The oldest entry (seed-0000) was evicted.
    expect(stored.find((e) => e.configId === "seed-0000")).toBeUndefined();
    // The second-oldest (seed-0001) is now the FIRST entry.
    expect(stored[0]?.configId).toBe("seed-0001");
  });

  it("preserves FIFO eviction order across multiple inserts past the cap", async () => {
    seedEntries(MAX);

    // Add three more configs in sequence
    for (let i = 0; i < 3; i++) {
      configMock.createPublicConfig.mockResolvedValue({
        id: `over-${String(i)}`, spaceId: "s-1", venueId: "v-1", isPublicPreview: true,
      });
      await useEditorStore.getState().createPublicConfig("s-1");
    }

    const stored = readStored();
    expect(stored).toHaveLength(MAX);
    // The first three seed entries should be evicted.
    expect(stored.find((e) => e.configId === "seed-0000")).toBeUndefined();
    expect(stored.find((e) => e.configId === "seed-0001")).toBeUndefined();
    expect(stored.find((e) => e.configId === "seed-0002")).toBeUndefined();
    // seed-0003 is now the oldest.
    expect(stored[0]?.configId).toBe("seed-0003");
    // The three new entries are at the end, in insertion order.
    expect(stored[stored.length - 3]?.configId).toBe("over-0");
    expect(stored[stored.length - 2]?.configId).toBe("over-1");
    expect(stored[stored.length - 1]?.configId).toBe("over-2");
  });

  it("does NOT evict when below the cap", async () => {
    seedEntries(10);
    configMock.createPublicConfig.mockResolvedValue({
      id: "new-cfg", spaceId: "s-1", venueId: "v-1", isPublicPreview: true,
    });

    await useEditorStore.getState().createPublicConfig("s-1");

    const stored = readStored();
    // 10 seeds + 1 new = 11, no truncation.
    expect(stored).toHaveLength(11);
    expect(stored[0]?.configId).toBe("seed-0000");
    expect(stored[stored.length - 1]?.configId).toBe("new-cfg");
  });
});

// ---------------------------------------------------------------------------
// Source-grep — pin the structural properties of the fix
// ---------------------------------------------------------------------------

async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const raw = await fs.readFile(path.resolve(relPath), "utf-8");
  const codeOnly = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return { raw, codeOnly };
}

describe("editor-store.ts cap structure (#18) — source-grep", () => {
  const SRC = "src/stores/editor-store.ts";

  it("declares a MAX_TRACKED_CONFIGS = 50 constant", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toMatch(/MAX_TRACKED_CONFIGS\s*=\s*50/);
  });

  it("wraps the localStorage write in try/catch", async () => {
    const { codeOnly } = await readSource(SRC);
    // The try block must contain a setItem call against the tracked
    // configs key (literal "omnitwin_my_configs" OR the TRACKED_CONFIGS_KEY
    // constant), and a catch must follow. Multiline regex because the body
    // has the slice/cap logic between the setItem and the closing brace.
    expect(codeOnly).toMatch(/try\s*\{[\s\S]*?localStorage\.setItem\([\s\S]*?(omnitwin_my_configs|TRACKED_CONFIGS_KEY)[\s\S]*?\}\s*catch/);
  });

  it("declares a TRACKED_CONFIGS_KEY constant pointing at the storage key", async () => {
    const { codeOnly } = await readSource(SRC);
    // The constant indirection makes the storage key discoverable and
    // greppable. If anyone inlines the literal string back into the call
    // sites, this test fails and forces them to keep the named constant.
    expect(codeOnly).toMatch(/TRACKED_CONFIGS_KEY\s*=\s*["']omnitwin_my_configs["']/);
  });
});
