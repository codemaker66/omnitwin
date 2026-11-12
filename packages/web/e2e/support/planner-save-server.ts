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
  /** The note this piece's note replaces, as the sender last had it confirmed. */
  readonly replacesNote?: string;
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
  const replacesNote = value["replacesNote"];
  return {
    ...(typeof id === "string" ? { id } : {}),
    assetDefinitionId: asset,
    positionX: number("positionX"), positionY: number("positionY"), positionZ: number("positionZ"),
    rotationX: number("rotationX"), rotationY: number("rotationY"), rotationZ: number("rotationZ"),
    scale: number("scale"), sortOrder: number("sortOrder"),
    metadata: isRecord(metadata) ? metadata : null,
    ...(typeof replacesNote === "string" ? { replacesNote } : {}),
  };
}

/**
 * The API's refusals over a held note, in its own words (#389,
 * packages/api/src/routes/public-configs.ts NOTE_HELD_REFUSAL and
 * HELD_PIECE_OMITTED_REFUSAL): the planner shows them as they arrive, so a
 * spec run against the API itself meets these same sentences.
 */
export const NOTE_HELD_SENTENCE = "A note on this plan cannot be changed from here, and this save tried to change it. Clear the note you wrote on that piece.";
export const HELD_PIECE_OMITTED_SENTENCE = "Nothing was saved: this save would remove a piece with a note that cannot be shown here. Reload the page to put it back.";

/**
 * How #389 takes a public batch save. `settle`: the notes are settled one by
 * one (settledNotes), because the save is not taken as the whole truth: that
 * needs the plan's claim secret AND the save's own word that it was read with
 * the notes (`notesAsSent = madeHere && notesIncluded === true`). `withhold`:
 * the answer keeps each held note from its reader, as withoutUnsentNotes
 * does, because the reader is not the plan's maker (`madeHere ? stored rows :
 * withoutUnsentNotes(...)`).
 */
interface PublicSaveRules {
  readonly settle: boolean;
  readonly withhold: boolean;
}

/** The note a batch piece sends, if any. */
function sentNote(object: BatchObject): string | null {
  const note = object.metadata?.["notes"];
  return typeof note === "string" && note !== "" ? note : null;
}

/** The database keeps positions to the millimetre and turns to 5 places. */
function fixed(value: number, places: number): string {
  return value.toFixed(places);
}

/** The claim secret a new draft's creating browser is given, and presents
 *  again (X-Plan-Claim-Secret) on its anonymous reads and saves of that draft. */
function claimSecretFor(layoutId: string): string {
  return `secret-${layoutId}-0123456789`;
}

/** One server shared by every context a spec opens. */
export class PlannerSaveServer {
  private readonly layouts = new Map<string, StoredLayout>();
  private nextId = 1;
  /** Every batch save that reached the server: which layout, at what revision. */
  readonly saves: { readonly configId: string; readonly expectedRevision: number; readonly objectCount: number }[] = [];
  /** While true, a batch save never arrives (the connection drops it). */
  dropSaves = false;
  /**
   * Notes on rows, by row id, that a reader without the plan's claim secret
   * is not shown: the API's rules for them (packages/api/src/routes/
   * public-configs.ts). Such a reader gets the row marked noteHeld and without
   * its note. A public save not taken as the whole truth (PublicSaveRules: from
   * such a reader, or from the maker without saying it read the notes) keeps
   * the note of a row it sends without one, and is refused if it leaves the row
   * out (409 HELD_PIECE_OMITTED). Empty, the server answers as it always did.
   */
  readonly heldNotes = new Map<string, string>();
  /** While true, the signed-in read refuses a public preview (403), as the API does for anyone off its venue's floor. */
  previewsOffTheFloor = false;

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

  /**
   * The layout's rows as a reader gets them: `marked`, a held note is only
   * marked, except on the rows in `sentHere`, whose note the answering save
   * itself sent (the API gives a note back only there); otherwise it is there.
   */
  private rows(layout: StoredLayout, marked: boolean, sentHere: ReadonlySet<string> = new Set<string>()): readonly WirePlacedObject[] {
    if (this.heldNotes.size === 0) return layout.objects;
    return layout.objects.map((object) => {
      const note = this.heldNotes.get(object.id);
      if (note === undefined) return object;
      const rest = Object.fromEntries(Object.entries(object.metadata ?? {}).filter(([key]) => key !== "notes"));
      return { ...object, metadata: marked && !sentHere.has(object.id) ? { ...rest, noteHeld: true } : { ...rest, notes: note } };
    });
  }

  private wire(layout: StoredLayout, marked = false): Record<string, unknown> {
    return {
      id: layout.id, spaceId: layout.spaceId, venueId: SAVE_VENUE.id, userId: layout.userId, name: layout.name,
      isPublicPreview: layout.isPublicPreview, revision: layout.revision, updatedAt: layout.updatedAt,
      objects: this.rows(layout, marked), metadata: null, reviewStatus: "draft",
    };
  }

  private batchSave(layout: StoredLayout, body: unknown, { settle, withhold }: PublicSaveRules): { readonly status: number; readonly json: unknown } {
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
    const sent = new Set(batch.flatMap((object) => (object.id === undefined ? [] : [object.id])));
    if (settle && layout.objects.some((object) => this.heldNotes.has(object.id) && !sent.has(object.id))) {
      return { status: 409, json: { error: HELD_PIECE_OMITTED_SENTENCE, code: "HELD_PIECE_OMITTED" } };
    }
    // From such a save, a stored piece's note is kept when the piece says
    // nothing of it, and changed or cleared only by a save that names the note
    // it replaces; any other change is refused (the API's settledNotes).
    if (settle && batch.some((object) => {
      const held = object.id === undefined ? undefined : this.heldNotes.get(object.id);
      if (held === undefined) return false;
      const note = sentNote(object);
      return note !== held && object.replacesNote !== held && (note !== null || object.replacesNote !== undefined);
    })) {
      return { status: 409, json: { error: NOTE_HELD_SENTENCE, code: "NOTE_HELD" } };
    }
    const kept = new Set(layout.objects.map((object) => object.id));
    // Updates first, then inserts, each in input order: the API's echo order.
    const updates = batch.filter((object) => object.id !== undefined && kept.has(object.id));
    const inserts = batch.filter((object) => object.id === undefined || !kept.has(object.id));
    const placed: readonly (readonly [BatchObject, string])[] = [
      ...updates.map((object) => [object, object.id ?? this.mint("row")] as const),
      ...inserts.map((object) => [object, this.mint("row")] as const),
    ];
    const row = (object: BatchObject, id: string): WirePlacedObject => ({
      id, configurationId: layout.id, assetDefinitionId: object.assetDefinitionId,
      positionX: fixed(object.positionX, 3), positionY: fixed(object.positionY, 3), positionZ: fixed(object.positionZ, 3),
      rotationX: fixed(object.rotationX, 5), rotationY: fixed(object.rotationY, 5), rotationZ: fixed(object.rotationZ, 5),
      scale: fixed(object.scale, 3), sortOrder: object.sortOrder, metadata: object.metadata ?? null,
    });
    layout.objects = placed.map(([object, id]) => row(object, id));
    // Such a reader's notes are the server's to hold like any other: kept from
    // every reader but the plan's maker, and given back only in the answer to
    // the save that sent them.
    const sentHere = new Set<string>();
    if (settle) {
      for (const [object, id] of placed) {
        const note = sentNote(object);
        if (note !== null) {
          this.heldNotes.set(id, note);
          sentHere.add(id);
        } else if (object.replacesNote !== undefined && object.replacesNote === this.heldNotes.get(id)) {
          this.heldNotes.delete(id);
        }
      }
    }
    layout.revision += 1;
    layout.updatedAt = new Date().toISOString();
    this.saves.push({ configId: layout.id, expectedRevision, objectCount: batch.length });
    return { status: 200, json: { data: { objects: this.rows(layout, withhold, sentHere), revision: layout.revision } } };
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
      // A new plan holds no note, so its creating answer says they are all here.
      return json(201, { data: { ...this.wire(layout), claimSecret: claimSecretFor(id), notesIncluded: true } });
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
      if (layout === undefined) return json(404, { error: "No layout", code: "NOT_FOUND" });
      if (!path.startsWith("/public/") && this.previewsOffTheFloor && layout.isPublicPreview) {
        return json(403, { error: "This layout is not yours to open here", code: "FORBIDDEN" });
      }
      if (!path.startsWith("/public/")) return json(200, { data: this.wire(layout) });
      // The public read says whether it carries the plan's notes: it does only
      // for the browser that presents the plan's claim secret. This server
      // keeps a piece's note like any other detail and withholds none, so a
      // spec that saves notes from two browsers must first give it the API's
      // note rules (packages/api/src/routes/public-configs.ts).
      const notesIncluded = request.headers()["x-plan-claim-secret"] === claimSecretFor(layout.id);
      return json(200, { data: { ...this.wire(layout, !notesIncluded), notesIncluded } });
    }
    const save = /^\/(?:public\/)?configurations\/([^/]+)\/objects\/batch$/u.exec(path);
    if (method === "POST" && save !== null && this.dropSaves) return route.abort("connectionreset");
    if (method === "POST" && save !== null) {
      const layout = this.layouts.get(save[1] ?? "");
      if (layout === undefined) return json(404, { error: "No layout", code: "NOT_FOUND" });
      // The signed-in route stores the batch as sent. The public one takes the
      // notes as sent only from the plan's maker saving a copy it says was read
      // with them, and answers only the maker with every note (#389).
      const body: unknown = request.postDataJSON();
      const publicSave = path.startsWith("/public/");
      const madeHere = publicSave && request.headers()["x-plan-claim-secret"] === claimSecretFor(layout.id);
      const notesAsSent = madeHere && isRecord(body) && body["notesIncluded"] === true;
      const outcome = this.batchSave(layout, body, { settle: publicSave && !notesAsSent, withhold: publicSave && !madeHere });
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
