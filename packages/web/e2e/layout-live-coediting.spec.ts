import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// E2E: live co-editing v1, two signed-in browsers on one layout.
//
// The sentence v1 is done when: two venue staff open the same layout, each
// sees the other in a quiet avatar row with the room they are viewing; every
// placement, move and delete one makes appears in the other's scene within
// about 200 ms; when both touch the same table the later write wins and the
// loser is told "Fiona moved this table"; a client sees nothing new; a lost
// connection resyncs from the server; and the saved layout ends exactly as
// the last writes left it, with no duplicates and nothing lost.
//
// Needs a LIVE local stack: a disposable Postgres migrated and seeded, the
// API with NODE_ENV=test (it accepts the seeded JSON identity as a token),
// and Vite in dev mode (the e2e auth bypass). The default e2e run has none of
// that, so the file self-gates with E2E_LAYOUT_LIVE=1.
//
// Edits are made through the planner's own stores — the very actions a drag
// or a click ends in — by importing the modules Vite serves to the app (one
// module instance per URL). Arrival is read from the other browser's
// placement store, which is what its 3D scene draws. Latency is stamped with
// the machine's clock on both sides.
// ---------------------------------------------------------------------------

// The in-page store surface this file touches. Each page.evaluate imports the
// module Vite serves to the app (same URL, same instance) and narrows it to
// these shapes, so the test stays strictly typed without a test hook in the app.
// e2e/support/vite-source-modules.d.ts declares these URLs for TypeScript.
interface StoreApi<S> {
  getState(): S;
  subscribe(listener: (state: S) => void): () => void;
}
interface SceneItem { readonly id: string; readonly x: number; readonly z: number }
interface EditorObjectLike { readonly id: string; readonly positionX: number }
interface EditorStateLike {
  readonly configId: string | null;
  readonly isLoading: boolean;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly configRevision: number | null;
  readonly objects: readonly EditorObjectLike[];
  beginHistoryGesture(): symbol | null;
  endHistoryGesture(token: symbol): void;
  updateObject(id: string, patch: { positionX: number; positionZ: number }): void;
  addObject(assetId: string, x: number, y: number, z: number): void;
  removeObject(id: string): void;
  saveToServer(isAuthenticated?: boolean): Promise<boolean>;
}
interface EditorModule { readonly useEditorStore: StoreApi<EditorStateLike> }
interface PlacementModule { readonly usePlacementStore: StoreApi<{ readonly placedItems: readonly SceneItem[] }> }
interface LiveModule {
  readonly useLayoutLiveStore: StoreApi<{
    readonly status: string;
    readonly participants: readonly unknown[];
    readonly overlay: ReadonlyMap<string, unknown>;
  }>;
}
interface SelectionModule { readonly useSelectionStore: StoreApi<{ selectMultiple(ids: readonly string[]): void }> }

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.skip(
  process.env["E2E_LAYOUT_LIVE"] !== "1",
  "Live layout co-editing stack required — set E2E_LAYOUT_LIVE=1 with E2E_API_URL and E2E_BASE_URL.",
);

const API = process.env["E2E_API_URL"] ?? "http://localhost:3027";
const VENUE = process.env["E2E_VENUE_ID"] ?? "";
const GRAND_HALL = process.env["E2E_SPACE_ID"] ?? "";
/** The catalogue's 6ft round table. */
const ROUND_TABLE = "a1ef4d89-7786-5878-bee1-87b3fac28200";
/** v1's budget is "about 200 ms" on a local stack; the assertion leaves
 *  headroom for a loaded CI box and the measured numbers are reported. */
const LIVE_BUDGET_MS = 400;
const RUN_TAG = new Date().toISOString().slice(11, 19).replace(/:/gu, "");

interface Person {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly platformRole: "none";
  readonly venueId: string | null;
  readonly name: string;
}

const FIONA: Person = {
  id: process.env["E2E_FIONA_ID"] ?? "", email: "fiona.coordinator+clerk_test@tradeshall.co.uk",
  role: "staff", platformRole: "none", venueId: VENUE, name: "Fiona Coordinator",
};
const GRAHAM: Person = {
  id: process.env["E2E_GRAHAM_ID"] ?? "", email: "graham.coordinator+clerk_test@tradeshall.co.uk",
  role: "staff", platformRole: "none", venueId: VENUE, name: "Graham Coordinator",
};
const CLIENT: Person = {
  id: process.env["E2E_CLIENT_ID"] ?? "", email: "client+clerk_test@tradeshall.co.uk",
  role: "client", platformRole: "none", venueId: null, name: "Client Example",
};

function tokenOf(person: Person): string {
  return JSON.stringify({ id: person.id, email: person.email, role: person.role, platformRole: person.platformRole, venueId: person.venueId });
}

async function api(person: Person, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokenOf(person)}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${String(response.status)} ${text}`);
  return text.length === 0 ? null : (JSON.parse(text) as unknown);
}

interface WireObject {
  readonly id: string;
  readonly positionX: string;
  readonly positionZ: string;
}

interface WireConfig {
  readonly id: string;
  readonly revision: number;
  readonly objects?: readonly WireObject[];
}

function configOf(payload: unknown): WireConfig {
  return (payload as { data: WireConfig }).data;
}

async function createLayout(owner: Person, objects: readonly [number, number][]): Promise<WireConfig> {
  const created = configOf(await api(owner, "POST", "/configurations", {
    spaceId: GRAND_HALL, venueId: VENUE, name: `Live co-editing ${RUN_TAG}`, layoutStyle: "dinner-rounds",
  }));
  await api(owner, "POST", `/configurations/${created.id}/objects/batch`, {
    expectedRevision: created.revision,
    objects: objects.map(([x, z], index) => ({
      assetDefinitionId: ROUND_TABLE, positionX: x, positionY: 0, positionZ: z,
      rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1, sortOrder: index,
    })),
  });
  return configOf(await api(owner, "GET", `/configurations/${created.id}`));
}

async function serverLayout(person: Person, configId: string): Promise<WireConfig> {
  return configOf(await api(person, "GET", `/configurations/${configId}`));
}

async function openPlanner(browser: Browser, person: Person, configId: string): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((seed) => {
    // Test-only handle on the page's sockets, so a run can drop the
    // connection the way a train tunnel would.
    const Native = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, {
      __OMNITWIN_E2E__: true,
      __OMNITWIN_E2E_LIVE__: true,
      __OMNITWIN_SEED_USER__: seed,
      __layoutLiveSockets: sockets,
    });
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    } as typeof WebSocket;
  }, person);
  const page = await context.newPage();
  recordSocketReceipts(page);
  await page.goto(`/plan/${configId}`);
  // expect.poll over evaluate: waitForFunction would treat an async
  // predicate's promise as truthy and return at once.
  await expect.poll(() => page.evaluate(async (id) => {
    const editor = (await import("/src/stores/editor-store.ts")) as EditorModule;
    const state = editor.useEditorStore.getState();
    return state.configId === id && !state.isLoading;
  }, configId), { timeout: 60_000 }).toBe(true);
  return [context, page];
}

/** What a scene must show: an item (by id, or any) at a position, or an id gone. */
type SceneCondition =
  | { readonly kind: "at"; readonly id?: string; readonly x?: number; readonly z?: number }
  | { readonly kind: "absent"; readonly id: string };

/** Resolves once this page's scene (placement store) meets the condition,
 *  returning the machine time it first did. */
async function sceneTime(page: Page, condition: SceneCondition, timeoutMs = 5_000): Promise<number> {
  return page.evaluate(async ({ want, timeout }) => {
    const placement = (await import("/src/stores/placement-store.ts")) as PlacementModule;
    const near = (a: number, b: number | undefined): boolean => b === undefined || Math.abs(a - b) < 1e-6;
    const meets = (items: readonly SceneItem[]): boolean => want.kind === "absent"
      ? !items.some((item) => item.id === want.id)
      : items.some((item) => (want.id === undefined || item.id === want.id) && near(item.x, want.x) && near(item.z, want.z));
    if (meets(placement.usePlacementStore.getState().placedItems)) return Date.now();
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error(`scene never showed ${JSON.stringify(want)}`)); }, timeout);
      const unsubscribe = placement.usePlacementStore.subscribe((state) => {
        if (!meets(state.placedItems)) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(Date.now());
      });
    });
  }, { want: condition, timeout: timeoutMs });
}

/** Arms the wait in the observer BEFORE the actor acts, then acts. */
async function measure(observer: Page, condition: SceneCondition, act: () => Promise<number>): Promise<number> {
  const seen = sceneTime(observer, condition);
  // Let the observer's subscription attach before the edit is made.
  await observer.waitForTimeout(50);
  const actedAt = await act();
  return (await seen) - actedAt;
}

async function moveObject(page: Page, objectId: string, x: number, z: number): Promise<number> {
  return page.evaluate(async ({ id, nx, nz }) => {
    const editor = (await import("/src/stores/editor-store.ts")) as EditorModule;
    const store = editor.useEditorStore.getState();
    // One gesture, as a drag makes it: its end asks for the autosave.
    const token = store.beginHistoryGesture();
    const at = Date.now();
    store.updateObject(id, { positionX: nx, positionZ: nz });
    if (token !== null) store.endHistoryGesture(token);
    return at;
  }, { id: objectId, nx: x, nz: z });
}

async function placeTable(page: Page, x: number, z: number): Promise<number> {
  return page.evaluate(async ({ asset, nx, nz }) => {
    const editor = (await import("/src/stores/editor-store.ts")) as EditorModule;
    const store = editor.useEditorStore.getState();
    const token = store.beginHistoryGesture();
    const at = Date.now();
    store.addObject(asset, nx, 0, nz);
    if (token !== null) store.endHistoryGesture(token);
    return at;
  }, { asset: ROUND_TABLE, nx: x, nz: z });
}

async function removeObject(page: Page, objectId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const editor = (await import("/src/stores/editor-store.ts")) as EditorModule;
    const store = editor.useEditorStore.getState();
    const token = store.beginHistoryGesture();
    const at = Date.now();
    store.removeObject(id);
    if (token !== null) store.endHistoryGesture(token);
    return at;
  }, objectId);
}

async function inRoom(page: Page, count: number): Promise<void> {
  await expect.poll(() => page.evaluate(async (n) => {
    const live = (await import("/src/stores/layout-live-store.ts")) as LiveModule;
    const state = live.useLayoutLiveStore.getState();
    return state.status === "live" && state.participants.length === n;
  }, count), { timeout: 60_000 }).toBe(true);
}

/** Median main-thread frame interval over ~1 s: the contention every
 *  scene-apply number below includes (headless Chromium renders the hall on
 *  the CPU; a real browser draws it on the GPU). */
async function frameIntervalMs(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => {
    const stamps: number[] = [];
    const tick = (t: number): void => {
      stamps.push(t);
      if (stamps.length < 30) requestAnimationFrame(tick);
      else {
        const gaps = stamps.slice(1).map((value, index) => value - (stamps[index] ?? value)).sort((a, b) => a - b);
        resolve(Math.round(gaps[Math.floor(gaps.length / 2)] ?? 0));
      }
    };
    requestAnimationFrame(tick);
  }));
}

/** Socket-level stamps, in the runner's clock: when each page's socket
 *  received a live.ops frame. */
const socketReceipts = new Map<Page, number[]>();
function recordSocketReceipts(page: Page): void {
  const receipts: number[] = [];
  socketReceipts.set(page, receipts);
  page.on("websocket", (socket) => {
    socket.on("framereceived", (frame) => {
      if (String(frame.payload).includes("\"live.ops\"")) receipts.push(Date.now());
    });
  });
}

/** Clean, not saving, nothing predicted on top, and holding exactly the
 *  revision the server holds. */
async function settled(page: Page, person: Person, configId: string): Promise<void> {
  await expect.poll(async () => {
    const local = await page.evaluate(async () => {
      const editor = (await import("/src/stores/editor-store.ts")) as EditorModule;
      const live = (await import("/src/stores/layout-live-store.ts")) as LiveModule;
      const state = editor.useEditorStore.getState();
      return {
        clean: !state.isDirty && !state.isSaving && live.useLayoutLiveStore.getState().overlay.size === 0,
        revision: state.configRevision,
      };
    });
    if (!local.clean) return "working";
    const server = await serverLayout(person, configId);
    return server.revision === local.revision ? "settled" : `local ${String(local.revision)} ≠ server ${String(server.revision)}`;
  }, { timeout: 20_000 }).toBe("settled");
}

const latencies: Record<string, number> = {};

test.describe("live co-editing — two staff, one layout", () => {
  let fionaContext: BrowserContext;
  let grahamContext: BrowserContext;
  let fiona: Page;
  let graham: Page;
  let layout: WireConfig;
  let tableA = "";
  let tableB = "";

  test.beforeAll(async ({ browser }) => {
    // Two planner loads, a warm-up round trip and a real save.
    test.setTimeout(180_000);
    expect(VENUE, "E2E_VENUE_ID").not.toBe("");
    expect(FIONA.id, "E2E_FIONA_ID").not.toBe("");
    layout = await createLayout(FIONA, [[-4, 0], [4, 0]]);
    tableA = layout.objects?.[0]?.id ?? "";
    tableB = layout.objects?.[1]?.id ?? "";
    [fionaContext, fiona] = await openPlanner(browser, FIONA, layout.id);
    [grahamContext, graham] = await openPlanner(browser, GRAHAM, layout.id);
    await inRoom(fiona, 2);
    await inRoom(graham, 2);
    // Warm up: the first frames after load compete with shader compilation
    // and the room's first draws. One throwaway round trip, then let both
    // scenes settle, so the numbers below measure co-editing, not start-up.
    await moveObject(fiona, tableA, -4, 0.5);
    await sceneTime(graham, { kind: "at", id: tableA, z: 0.5 }, 30_000);
    await settled(fiona, FIONA, layout.id);
    await settled(graham, GRAHAM, layout.id);
    await graham.waitForTimeout(2_000);
    latencies["graham frame interval (median)"] = await frameIntervalMs(graham);
    latencies["fiona frame interval (median)"] = await frameIntervalMs(fiona);
  });

  test.afterAll(async () => {
    const lines = Object.entries(latencies).map(([name, ms]) => `${name}: ${String(ms)} ms`).join("\n");
    test.info().annotations.push({ type: "latency", description: lines });
    // eslint-disable-next-line no-console -- the measured numbers are the evidence.
    console.log(`[layout-live] latencies\n${lines}`);
    await fionaContext.close();
    await grahamContext.close();
  });

  test("each sees the other, with the room they are viewing", async () => {
    const grahamAvatar = fiona.getByTestId("layout-live-avatar");
    await expect(grahamAvatar).toHaveCount(1, { timeout: 15_000 });
    await expect(grahamAvatar).toHaveText("GC");
    await expect(grahamAvatar).toHaveAttribute("title", "Graham Coordinator · Grand Hall");
    await expect(graham.getByTestId("layout-live-avatar")).toHaveAttribute("title", "Fiona Coordinator · Grand Hall");
    await expect(fiona.getByTestId("layout-live-presence")).toHaveAttribute(
      "aria-label", "Also in this layout: Graham Coordinator · Grand Hall",
    );
    await fiona.screenshot({ path: test.info().outputPath("presence-fiona.png") });
  });

  test("a move appears in the other scene within the budget, then commits", async () => {
    const receiptsBefore = socketReceipts.get(graham)?.length ?? 0;
    const actedAtRunner = Date.now();
    const ms = await measure(graham, { kind: "at", id: tableA, x: -2 },
      () => moveObject(fiona, tableA, -2, 1));
    latencies["move (Fiona's action → Graham's scene)"] = ms;
    const received = socketReceipts.get(graham)?.[receiptsBefore];
    if (received !== undefined) latencies["move (runner → Graham's socket, includes 50 ms arm)"] = received - actedAtRunner;
    expect(ms).toBeLessThan(LIVE_BUDGET_MS);
    await settled(fiona, FIONA, layout.id);
    await settled(graham, GRAHAM, layout.id);
    const saved = await serverLayout(FIONA, layout.id);
    const a = saved.objects?.find((object) => object.id === tableA);
    expect(Number(a?.positionX)).toBeCloseTo(-2, 6);
    expect(Number(a?.positionZ)).toBeCloseTo(1, 6);
  });

  test("a placement appears at once and becomes one real table, not two", async () => {
    const ms = await measure(graham, { kind: "at", x: 0, z: 3 },
      () => placeTable(fiona, 0, 3));
    latencies["place (Fiona's action → Graham's scene)"] = ms;
    expect(ms).toBeLessThan(LIVE_BUDGET_MS);
    await settled(fiona, FIONA, layout.id);
    await settled(graham, GRAHAM, layout.id);
    const saved = await serverLayout(FIONA, layout.id);
    expect(saved.objects).toHaveLength(3);
    const grahamScene = await graham.evaluate(async () => {
      const placement = (await import("/src/stores/placement-store.ts")) as PlacementModule;
      return placement.usePlacementStore.getState().placedItems.map((item) => item.id);
    });
    expect(grahamScene).toHaveLength(3);
    expect(grahamScene.every((id) => !id.startsWith("remote:") && !id.startsWith("local-"))).toBe(true);
  });

  test("a delete disappears from the other scene within the budget", async () => {
    const ms = await measure(fiona, { kind: "absent", id: tableB },
      () => removeObject(graham, tableB));
    latencies["delete (Graham's action → Fiona's scene)"] = ms;
    expect(ms).toBeLessThan(LIVE_BUDGET_MS);
    await settled(graham, GRAHAM, layout.id);
    await settled(fiona, FIONA, layout.id);
    const saved = await serverLayout(FIONA, layout.id);
    expect(saved.objects?.some((object) => object.id === tableB)).toBe(false);
    expect(saved.objects).toHaveLength(2);
  });

  test("the later write on one table wins, and the person it overrode is told", async () => {
    await graham.evaluate(async (id) => {
      const selection = (await import("/src/stores/selection-store.ts")) as SelectionModule;
      selection.useSelectionStore.getState().selectMultiple([id]);
    }, tableA);
    await moveObject(graham, tableA, -6, -2);
    // Graham's op is sequenced first; Fiona's, a moment later, is the last write.
    await graham.waitForTimeout(120);
    await moveObject(fiona, tableA, -7, 2);
    await expect(graham.getByTestId("layout-live-notice")).toHaveText("Fiona moved this table", { timeout: 5_000 });
    await graham.screenshot({ path: test.info().outputPath("conflict-notice-graham.png") });
    await settled(fiona, FIONA, layout.id);
    await settled(graham, GRAHAM, layout.id);
    const saved = await serverLayout(FIONA, layout.id);
    const a = saved.objects?.find((object) => object.id === tableA);
    expect(Number(a?.positionX)).toBeCloseTo(-7, 6);
    expect(Number(a?.positionZ)).toBeCloseTo(2, 6);
    const grahamA = await graham.evaluate(async (id) => {
      const editor = (await import("/src/stores/editor-store.ts")) as EditorModule;
      return editor.useEditorStore.getState().objects.find((object) => object.id === id)?.positionX ?? null;
    }, tableA);
    expect(grahamA).toBeCloseTo(-7, 6);
  });

  test("a dropped connection shows reconnecting and resyncs what it missed", async () => {
    // Hold Graham away: new sockets are refused until the route lets them
    // through, then his open one is dropped.
    let away = true;
    await graham.routeWebSocket(/\/ws\/configurations\//u, (ws) => {
      if (away) {
        void ws.close();
        return;
      }
      void ws.connectToServer();
    });
    await graham.evaluate(() => {
      const sockets: unknown = Reflect.get(window, "__layoutLiveSockets");
      if (!Array.isArray(sockets)) return;
      // Only the layout's socket: Vite's HMR socket reloads the page if dropped.
      for (const socket of sockets) {
        if (socket instanceof WebSocket && socket.url.includes("/ws/configurations/")) socket.close();
      }
    });
    await expect(graham.getByTestId("layout-live-layer")).toContainText("Reconnecting to the room", { timeout: 5_000 });
    await graham.screenshot({ path: test.info().outputPath("reconnecting-graham.png") });

    // Fiona edits and commits while Graham cannot hear it.
    await moveObject(fiona, tableA, 6, -3);
    await fiona.evaluate(async () => {
      const editor = (await import("/src/stores/editor-store.ts")) as EditorModule;
      await editor.useEditorStore.getState().saveToServer(true);
    });
    await settled(fiona, FIONA, layout.id);
    const missed = await graham.evaluate(async (id) => {
      const placement = (await import("/src/stores/placement-store.ts")) as PlacementModule;
      return placement.usePlacementStore.getState().placedItems.find((item) => item.id === id)?.x ?? null;
    }, tableA);
    expect(missed).toBeCloseTo(-7, 6);

    // Back in range: the next attempt connects, and the server's document,
    // not a replay of ops, brings Graham up to date.
    away = false;
    await sceneTime(graham, { kind: "at", id: tableA, x: 6 }, 40_000);
    await expect(graham.getByTestId("layout-live-avatar")).toHaveCount(1, { timeout: 10_000 });
  });

  test("the saved layout holds exactly the last writes", async () => {
    const saved = await serverLayout(FIONA, layout.id);
    const positions = (saved.objects ?? []).map((object) => [Number(object.positionX), Number(object.positionZ)]).sort();
    expect(positions).toEqual([[0, 3], [6, -3]].sort());
  });
});

test.describe("a client sees nothing new", () => {
  test("a client's own layout gains no presence and no live changes", async ({ browser }) => {
    expect(CLIENT.id, "E2E_CLIENT_ID").not.toBe("");
    const layout = await createLayout(CLIENT, [[-3, 0]]);
    const [clientContext, client] = await openPlanner(browser, CLIENT, layout.id);
    const [staffContext, staff] = await openPlanner(browser, FIONA, layout.id);
    const tableId = layout.objects?.[0]?.id ?? "";

    // Staff are admitted, the client is not: staff see nobody, the client sees nothing.
    await staff.waitForTimeout(1_500);
    await expect(client.getByTestId("layout-live-layer")).toHaveCount(0);
    await expect(staff.getByTestId("layout-live-avatar")).toHaveCount(0);

    // A staff edit reaches the client only through the save path they already
    // had (a reload), never live.
    await moveObject(staff, tableId, 2, 2);
    await client.waitForTimeout(1_000);
    const clientSees = await client.evaluate(async (id) => {
      const placement = (await import("/src/stores/placement-store.ts")) as PlacementModule;
      return placement.usePlacementStore.getState().placedItems.find((item) => item.id === id)?.x ?? null;
    }, tableId);
    expect(clientSees).toBeCloseTo(-3, 6);
    await clientContext.close();
    await staffContext.close();
  });
});
