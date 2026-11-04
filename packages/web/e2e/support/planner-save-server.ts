import type { BrowserContext, Page, Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// A small in-memory layout server for planner save specs that need more than
// one browser to see the same saved layouts (a move made in one context is
// read by another). It answers the routes the signed-in planner calls for a
// layout: the venue and its rooms, reading a layout, the batch save with its
// revision check, and a new draft (created, then claimed). Everything else on
// the API host answers 404, so a missing stub fails visibly instead of hanging.
// ---------------------------------------------------------------------------

export const SAVE_API = "http://localhost:3001";
/** The catalogue's 6ft round table. */
export const ROUND_TABLE = "a1ef4d89-7786-5878-bee1-87b3fac28200";

export const SAVE_VENUE = {
  id: "e2e-save-venue",
  name: "Trades Hall",
  slug: "trades-hall-glasgow",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
} as const;

interface FakeSpace {
  readonly id: string;
  readonly venueId: string;
  readonly name: string;
  readonly slug: string;
  readonly widthM: string;
  readonly lengthM: string;
  readonly heightM: string;
  readonly floorPlanOutline: readonly { readonly x: number; readonly y: number }[];
}

function room(id: string, name: string, slug: string, widthM: number, lengthM: number): FakeSpace {
  return {
    id, venueId: SAVE_VENUE.id, name, slug, widthM: String(widthM), lengthM: String(lengthM), heightM: "6",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: widthM, y: 0 }, { x: widthM, y: lengthM }, { x: 0, y: lengthM }],
  };
}

export const SAVE_GRAND_HALL = room("e2e-save-grand-hall", "Grand Hall", "grand-hall", 21, 10.5);
export const SAVE_SALOON = room("e2e-save-saloon", "Saloon", "saloon", 12, 8);
const SPACES: readonly FakeSpace[] = [SAVE_GRAND_HALL, SAVE_SALOON];

export interface WirePlacedObject {
  readonly id: string;
  readonly configurationId: string;
  readonly assetDefinitionId: string;
  readonly positionX: string;
  readonly positionY: string;
  readonly positionZ: string;
  readonly rotationX: string;
  readonly rotationY: string;
  readonly rotationZ: string;
  readonly scale: string;
  readonly sortOrder: number;
  readonly metadata: Record<string, unknown> | null;
}

interface StoredLayout {
  readonly id: string;
  readonly spaceId: string;
  userId: string | null;
  name: string;
  isPublicPreview: boolean;
  revision: number;
  updatedAt: string;
  objects: WirePlacedObject[];
}

interface BatchObject {
  readonly id?: string;
  readonly assetDefinitionId: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly scale: number;
  readonly sortOrder: number;
  readonly metadata?: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBatchObject(value: unknown): BatchObject {
  if (!isRecord(value)) throw new Error("batch object is not an object");
  const number = (key: string): number => {
    const field = value[key];
    if (typeof field !== "number") throw new Error(`batch object ${key} is not a number`);
    return field;
  };
  const id = value["id"];
  const asset = value["assetDefinitionId"];
  if (typeof asset !== "string") throw new Error("batch object has no asset");
  const metadata = value["metadata"];
  return {
    ...(typeof id === "string" ? { id } : {}),
    assetDefinitionId: asset,
    positionX: number("positionX"), positionY: number("positionY"), positionZ: number("positionZ"),
    rotationX: number("rotationX"), rotationY: number("rotationY"), rotationZ: number("rotationZ"),
    scale: number("scale"), sortOrder: number("sortOrder"),
    metadata: isRecord(metadata) ? metadata : null,
  };
}

/** The database keeps positions to the millimetre and turns to 5 places. */
function fixed(value: number, places: number): string {
  return value.toFixed(places);
}

/** One server shared by every context a spec opens. */
export class PlannerSaveServer {
  private readonly layouts = new Map<string, StoredLayout>();
  private nextId = 1;
  /** Every batch save that reached the server: which layout, at what revision. */
  readonly saves: { readonly configId: string; readonly expectedRevision: number; readonly objectCount: number }[] = [];
  /** While true, a batch save never arrives (the connection drops it). */
  dropSaves = false;

  private mint(prefix: string): string {
    const id = `${prefix}-${String(this.nextId).padStart(4, "0")}`;
    this.nextId += 1;
    return id;
  }

  /** Seed a layout the signed-in person owns, with round tables at these X positions (metres). */
  seedLayout(input: { readonly id: string; readonly spaceId: string; readonly userId: string; readonly name: string; readonly tablesAtX: readonly number[] }): void {
    this.layouts.set(input.id, {
      id: input.id, spaceId: input.spaceId, userId: input.userId, name: input.name, isPublicPreview: false,
      revision: 1, updatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      objects: input.tablesAtX.map((x, index) => ({
        id: `${input.id}-table-${String(index + 1)}`,
        configurationId: input.id,
        assetDefinitionId: ROUND_TABLE,
        positionX: fixed(x, 3), positionY: "0.000", positionZ: fixed(4, 3),
        rotationX: "0.00000", rotationY: "0.00000", rotationZ: "0.00000",
        scale: "1.000", sortOrder: index, metadata: { clothed: false, groupId: null },
      })),
    });
  }

  layout(id: string): StoredLayout | undefined {
    return this.layouts.get(id);
  }

  private wire(layout: StoredLayout): Record<string, unknown> {
    return {
      id: layout.id, spaceId: layout.spaceId, venueId: SAVE_VENUE.id, userId: layout.userId, name: layout.name,
      isPublicPreview: layout.isPublicPreview, revision: layout.revision, updatedAt: layout.updatedAt,
      objects: layout.objects, metadata: null, reviewStatus: "draft",
    };
  }

  private batchSave(layout: StoredLayout, body: unknown): { readonly status: number; readonly json: unknown } {
    if (!isRecord(body) || typeof body["expectedRevision"] !== "number" || !Array.isArray(body["objects"])) {
      return { status: 400, json: { error: "Bad batch", code: "VALIDATION_ERROR" } };
    }
    const expectedRevision = body["expectedRevision"];
    if (expectedRevision !== layout.revision) {
      return {
        status: 409,
        json: { error: "Layout changed on the server. Reload before saving again.", code: "REVISION_CONFLICT",
          details: { expectedRevision, currentRevision: layout.revision, changedBy: null, changedAt: null } },
      };
    }
    const batch = body["objects"].map(asBatchObject);
    const kept = new Set(layout.objects.map((object) => object.id));
    // Updates first, then inserts, each in input order: the API's echo order.
    const updates = batch.filter((object) => object.id !== undefined && kept.has(object.id));
    const inserts = batch.filter((object) => object.id === undefined || !kept.has(object.id));
    const row = (object: BatchObject, id: string): WirePlacedObject => ({
      id, configurationId: layout.id, assetDefinitionId: object.assetDefinitionId,
      positionX: fixed(object.positionX, 3), positionY: fixed(object.positionY, 3), positionZ: fixed(object.positionZ, 3),
      rotationX: fixed(object.rotationX, 5), rotationY: fixed(object.rotationY, 5), rotationZ: fixed(object.rotationZ, 5),
      scale: fixed(object.scale, 3), sortOrder: object.sortOrder, metadata: object.metadata ?? null,
    });
    layout.objects = [
      ...updates.map((object) => row(object, object.id ?? this.mint("row"))),
      ...inserts.map((object) => row(object, this.mint("row"))),
    ];
    layout.revision += 1;
    layout.updatedAt = new Date().toISOString();
    this.saves.push({ configId: layout.id, expectedRevision, objectCount: batch.length });
    return { status: 200, json: { data: { objects: layout.objects, revision: layout.revision } } };
  }

  private async answer(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (status: number, body: unknown): Promise<void> => route.fulfill({ status, json: body });

    if (method === "GET" && path === "/venues") return json(200, { data: [SAVE_VENUE] });
    if (method === "GET" && path === `/venues/${SAVE_VENUE.id}`) return json(200, { data: { ...SAVE_VENUE, spaces: SPACES } });
    if (method === "GET" && path === `/venues/${SAVE_VENUE.id}/spaces`) return json(200, { data: SPACES });
    const spaceMatch = /^\/venues\/[^/]+\/spaces\/([^/]+)$/u.exec(path);
    if (method === "GET" && spaceMatch !== null) {
      const space = SPACES.find((candidate) => candidate.id === spaceMatch[1]);
      return space === undefined ? json(404, { error: "No room", code: "NOT_FOUND" }) : json(200, { data: space });
    }
    if (method === "POST" && path === "/public/configurations") {
      const body: unknown = request.postDataJSON();
      const spaceId = isRecord(body) && typeof body["spaceId"] === "string" ? body["spaceId"] : "";
      const id = this.mint("layout");
      const layout: StoredLayout = { id, spaceId, userId: null, name: "New Layout", isPublicPreview: true, revision: 1, updatedAt: new Date().toISOString(), objects: [] };
      this.layouts.set(id, layout);
      return json(201, { data: { ...this.wire(layout), claimSecret: `secret-${id}-0123456789` } });
    }
    const claim = /^\/configurations\/([^/]+)\/claim$/u.exec(path);
    if (method === "POST" && claim !== null) {
      const layout = this.layouts.get(claim[1] ?? "");
      if (layout === undefined) return json(404, { error: "No layout", code: "NOT_FOUND" });
      layout.isPublicPreview = false;
      layout.userId = "claimed";
      return json(200, { data: this.wire(layout) });
    }
    const read = /^\/(?:public\/)?configurations\/([^/]+)$/u.exec(path);
    if (method === "GET" && read !== null) {
      const layout = this.layouts.get(read[1] ?? "");
      return layout === undefined ? json(404, { error: "No layout", code: "NOT_FOUND" }) : json(200, { data: this.wire(layout) });
    }
    const save = /^\/(?:public\/)?configurations\/([^/]+)\/objects\/batch$/u.exec(path);
    if (method === "POST" && save !== null && this.dropSaves) return route.abort("connectionreset");
    if (method === "POST" && save !== null) {
      const layout = this.layouts.get(save[1] ?? "");
      if (layout === undefined) return json(404, { error: "No layout", code: "NOT_FOUND" });
      const outcome = this.batchSave(layout, request.postDataJSON());
      return json(outcome.status, outcome.json);
    }
    if (method === "GET" && path.startsWith("/assets/runtime-packages/latest")) return json(200, { data: null });
    return json(404, { error: `Not stubbed: ${method} ${path}`, code: "NOT_FOUND" });
  }

  /** Answer the API host for this page or context. */
  async attach(target: Page | BrowserContext): Promise<void> {
    await target.route(`${SAVE_API}/**`, (route) => this.answer(route));
  }
}

export interface SeedUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly platformRole: "none" | "operator" | "admin";
  readonly venueId: string | null;
  readonly name: string;
}

/** Sign this context in as the seeded person (the dev build's e2e auth bypass). */
export async function signInAs(target: Page | BrowserContext, user: SeedUser): Promise<void> {
  await target.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed });
  }, user);
}
