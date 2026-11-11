import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { buildLayoutPathKey, ConfigurationReviewStatusSchema, isPlannerEditable } from "@omnitwin/types";
import {
  configurations,
  configurationClaimSecrets,
  configurationLayoutRevisions,
  layoutAliases,
  placedObjects,
  spaces,
  assetDefinitions,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { syncPlacedObjectBatch, type PlacedObjectBatchItem, type PlacedObjectRow } from "../lib/placed-object-batch.js";
import { writeOrRefuse } from "../services/people-records.js";
import { emit } from "../observability/event-bus.js";
import { generateUniqueShortCode } from "../services/shortcode.js";
import {
  PLAN_CLAIM_SECRET_HEADER,
  claimSecretMatches,
  generateClaimSecret,
  hashClaimSecret,
} from "../services/configuration-claim-secrets.js";
import { GuestSaveBudget } from "../services/guest-save-budget.js";
import {
  validatePlacementsInPolygon,
  loadSpacePolygon,
  placementOutOfBoundsBody,
} from "../lib/placement-validation.js";
import {
  configurationRevisionEtag,
  loadRevisionChange,
  revisionConflictBody,
} from "../lib/configuration-revision.js";
import {
  generateVisitorPlanPdf,
  loadVisitorPlan,
  visitorPlanFilename,
} from "../services/visitor-plan-pdf.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ConfigIdParam = z.object({ configId: z.uuid() });

const CreatePublicConfigBody = z.object({
  spaceId: z.uuid(),
  name: z.string().trim().min(1).max(200).default("Untitled Layout"),
});

// What one anonymous save may carry. Every accepted save is stored twice (the
// plan's pieces, and whole in its revision log), by anyone, with no account.
//
// A piece's metadata as the planner writes it is a 500-character note, an
// 80-character label, two dressing names, a group id and three flags: about
// 2 KB at its largest, in any script.
const MAX_PUBLIC_OBJECT_METADATA_BYTES = 4 * 1024;
// A plan at the 500-piece cap with every piece labelled is about 300 KB.
const PUBLIC_BATCH_BODY_LIMIT_BYTES = 512 * 1024;

/** What a piece says, in place of its note, to a reader the note is kept from
 *  (withoutNote below). It is this route's word to a reader, never a fact
 *  about the piece, so a save that sends it back does not store it. */
const NOTE_HELD = "noteHeld";

const PublicObjectMetadata = z.record(z.string(), z.unknown()).refine(
  (metadata) => Buffer.byteLength(JSON.stringify(metadata)) <= MAX_PUBLIC_OBJECT_METADATA_BYTES,
  "A piece's details are too large to save",
).transform((metadata) => Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== NOTE_HELD)));

/** The bytes a save asks the database to keep: its body as sent. */
function saveBytes(request: FastifyRequest): number {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > 0) return declared;
  return Buffer.byteLength(JSON.stringify(request.body ?? null));
}

// ---------------------------------------------------------------------------
// Who reads a guest plan's notes (final review, TENANCY-3)
//
// Anyone holding a guest plan's id can open and edit the plan; that is what a
// shared link is. A piece's note is whatever the guest typed on a table, which
// can be health information ("nut allergy, seat by the door"), and the plan's
// row also carries the venue's review note and event instructions. Those go
// only to the browser that made the plan: it alone was given the plan's claim
// secret (POST /configurations below) and presents it in a request header
// (PLAN_CLAIM_SECRET_HEADER). Staff read them signed in, through
// GET /configurations/:id. A plan with no stored secret (made before migration
// 0102, or already claimed) has no such browser.
//
// One address answering two readers differently needs two more things said.
//
// A read says which answer it is. `notesIncluded` is true only on an answer
// that carries the plan's notes. On any other, each piece that holds a note
// says so (`noteHeld`) in place of the note, so the planner can show that the
// piece has one instead of an empty field to write over.
//
// A save says what it was made from. That the saving browser holds the secret
// says nothing about the copy it is saving: a page that read the plan without
// its notes keeps unsaved work on the device, and the maker's browser later
// restores it and saves. So a save's notes are taken as the whole truth only
// when it presents the secret AND declares (`notesIncluded`) that the document
// it saves was read with them. Every other save is settled note by note
// (settledNotes below): it never clears or changes the note of a piece it
// sends without having read that note, and it is never answered 200 for a
// note that was not taken.
//
// A piece left out of a save is removed, and its note with it. Anyone holding
// the plan's id may remove a piece, as before, except a piece that holds a
// note: a save not taken as the whole truth never read that note, so one that
// leaves such a piece out is refused whole (HELD_PIECE_OMITTED_REFUSAL). The
// planner shows which pieces hold a note the person cannot see. The browser
// that made the plan, saving a document read with its notes, and venue staff
// signed in (routes/placed-objects.ts) remove any piece, as before.
// ---------------------------------------------------------------------------

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function presentsClaimSecret(db: Database, configId: string, request: FastifyRequest): Promise<boolean> {
  const presented = request.headers[PLAN_CLAIM_SECRET_HEADER];
  if (typeof presented !== "string" || presented.length < 16 || presented.length > 256) return false;
  const [secret] = await db.select({ secretHash: configurationClaimSecrets.secretHash })
    .from(configurationClaimSecrets)
    .where(eq(configurationClaimSecrets.configurationId, configId))
    .limit(1);
  return secret !== undefined && claimSecretMatches(secret.secretHash, presented);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The note a piece holds, if it holds one. */
function noteOf(metadata: unknown): string | null {
  const note = isRecord(metadata) ? metadata["notes"] : undefined;
  return typeof note === "string" && note.length > 0 ? note : null;
}

/** A piece as any holder of the plan's id reads it: where it stands and how it
 *  is dressed. Its note is left out, and a piece that holds one says so. The
 *  mark is only ever this route's word: one found on the row is not passed on. */
function withoutNote<T extends { readonly metadata: unknown }>(piece: T): T {
  if (!isRecord(piece.metadata) || !("notes" in piece.metadata || NOTE_HELD in piece.metadata)) return piece;
  const kept = Object.fromEntries(Object.entries(piece.metadata).filter(([key]) => key !== "notes" && key !== NOTE_HELD));
  return { ...piece, metadata: noteOf(piece.metadata) === null ? kept : { ...kept, [NOTE_HELD]: true } };
}

/** The plan's row as any holder of its id reads it: without the venue's
 *  review note or the event instructions kept in its metadata. */
function withoutVenueNotes<T extends { readonly reviewNote: string | null; readonly metadata: unknown }>(plan: T): T {
  return { ...plan, reviewNote: null, metadata: null };
}

const BatchObjectItem = z.object({
  id: z.uuid().optional(),
  assetDefinitionId: z.uuid(),
  positionX: z.number(),
  positionY: z.number(),
  positionZ: z.number(),
  rotationX: z.number().default(0),
  rotationY: z.number().default(0),
  rotationZ: z.number().default(0),
  scale: z.number().positive().default(1),
  sortOrder: z.number().int().nonnegative().default(0),
  metadata: PublicObjectMetadata.nullable().optional(),
  // The note this piece's note replaces, as its sender last had it confirmed
  // (settledNotes). Read for the save, never stored.
  replacesNote: z.string().max(MAX_PUBLIC_OBJECT_METADATA_BYTES).optional(),
});

type IncomingPiece = z.infer<typeof BatchObjectItem>;

const BatchBody = z.object({
  expectedRevision: z.number().int().min(1),
  objects: z.array(BatchObjectItem).max(500),
  // The document being saved was read with the plan's notes, so its notes are
  // the whole truth. Believed only with the plan's claim secret.
  notesIncluded: z.boolean().optional(),
});

interface SettledNotes {
  /** The batch to store. */
  readonly pieces: readonly PlacedObjectBatchItem[];
  /** The pieces whose note this save would have changed without having read it. */
  readonly refused: readonly string[];
  /** The stored pieces holding a note that this save leaves out, and so would remove. */
  readonly omitted: readonly string[];
}

/**
 * The notes of a save that has not shown it read the plan's notes, settled
 * against the notes the plan holds. Such a save comes from a browser that
 * sends each piece back without the note it never saw, so:
 *
 *   - a piece sent without a note keeps the note it holds. It cannot mean
 *     "clear": that would erase every note the first time a chair was moved;
 *   - a note lands on a piece that holds none, and a piece sent with the note
 *     it already holds is unchanged;
 *   - a piece that names the note it replaces (`replacesNote`), and names it
 *     rightly, has shown its sender knows that note, so its note is taken as
 *     sent: changed or cleared. This is how a browser goes on writing,
 *     corrects or removes a note it wrote itself, which the planner's
 *     autosave often stores half-typed;
 *   - any other note on a piece that holds a different one refuses the whole
 *     save. Storing the old note and answering 200 threw the sender's words
 *     away unseen;
 *   - a stored piece that holds a note and is not in the save at all refuses
 *     the whole save too: the batch removes every piece it leaves out, and
 *     the note with it.
 *
 * Must run inside the save's transaction, after the revision is advanced, so
 * the notes read are the ones this save replaces: every route that writes a
 * plan's pieces holds the plan's row first, so no note can land between this
 * read and the batch.
 */
async function settledNotes(
  tx: Transaction,
  configId: string,
  incoming: readonly IncomingPiece[],
): Promise<SettledNotes> {
  const stored = await tx.select({ id: placedObjects.id, metadata: placedObjects.metadata })
    .from(placedObjects)
    .where(eq(placedObjects.configurationId, configId));
  const held = new Map<string, string>();
  for (const row of stored) {
    const note = noteOf(row.metadata);
    if (note !== null) held.set(row.id, note);
  }
  const refused: string[] = [];
  const pieces = incoming.map((piece) => {
    if (piece.id === undefined) return piece;
    const storedNote = held.get(piece.id);
    if (storedNote === undefined) return piece;
    const sent = noteOf(piece.metadata);
    if (sent === storedNote || piece.replacesNote === storedNote) return piece;
    if (sent === null && piece.replacesNote === undefined) {
      return { ...piece, metadata: { ...(piece.metadata ?? {}), notes: storedNote } };
    }
    refused.push(piece.id);
    return piece;
  });
  const sent = new Set(incoming.flatMap((piece) => (piece.id === undefined ? [] : [piece.id])));
  const omitted = [...held.keys()].filter((id) => !sent.has(id));
  return { pieces, refused, omitted };
}

/**
 * A save's answer to a browser that is not shown the plan's notes: each piece
 * as stored, with its note only where this save itself sent that very note.
 * That tells the sender nothing it did not write, and the planner takes the
 * answer as the document, so leaving the note out wiped what the person had
 * just typed from their screen. Any other piece that holds a note says so.
 */
function withoutUnsentNotes(
  saved: readonly PlacedObjectRow[],
  incoming: readonly IncomingPiece[],
): readonly PlacedObjectRow[] {
  const sent = new Map<string, string | null>();
  for (const piece of incoming) {
    if (piece.id !== undefined) sent.set(piece.id, noteOf(piece.metadata));
  }
  return saved.map((row) => {
    // A piece this save placed holds exactly what the save sent.
    if (!sent.has(row.id)) return row;
    return sent.get(row.id) === noteOf(row.metadata) ? row : withoutNote(row);
  });
}

/**
 * The refusal of a save that would change a note its sender was not shown.
 * Nothing of the save is stored. The planner shows `error` as it stands, a
 * page loaded before it knew this code included.
 *
 * It does not say which piece. A refusal costs its sender nothing and leaves
 * no trace, so naming the pieces would let one save try a guess at every held
 * note at once and read off which were right. As it is, a guess is one save,
 * within the route's limit, and a right one is written to the plan.
 */
const NOTE_HELD_REFUSAL = {
  error: "A note on this plan cannot be changed from here, and this save tried to change it. Reload the page, or clear the note you wrote on that piece.",
  code: "NOTE_HELD",
} as const;

/**
 * The refusal of a save, not taken as the whole truth, that leaves out a
 * stored piece holding a note: the batch would remove the piece and the note
 * its sender was never shown. Nothing of the save is stored.
 *
 * Its own code, never NOTE_HELD: the planner answers NOTE_HELD by forgetting
 * its own words over held notes and sending again, which cannot put a piece
 * back. Its advice to reload rests on the planner putting back, from the plan
 * as read, any held piece its kept work lacks (the web half; release lead's
 * ruling R-B). It names no piece and discloses nothing new: every read
 * without the notes already marks which pieces hold one (`noteHeld`).
 */
const HELD_PIECE_OMITTED_REFUSAL = {
  error: "Nothing was saved: this save would remove a piece with a note that cannot be shown here. Reload the page to put it back.",
  code: "HELD_PIECE_OMITTED",
} as const;

/** How a guest save ends. Only "saved" keeps anything it wrote. */
type GuestSaveOutcome =
  | { readonly status: "saved"; readonly objects: readonly PlacedObjectRow[]; readonly revision: number }
  | { readonly status: "conflict"; readonly currentRevision: number }
  | { readonly status: "locked"; readonly reviewStatus: string }
  | { readonly status: "note-held" }
  | { readonly status: "held-piece-omitted" };

// Punch list #24: accepts a data URL (PNG or JPEG) as the thumbnail for a
// public preview config. The .max() checks the data URL's length; every
// character after the prefix must be plain base64, so 270,000 characters is
// 270 KB stored and about 200 KB decoded. The Grand Hall's 800×533 plan is
// 514 KB as PNG (685,350 characters, refused here) and 72 KB as JPEG at 0.85
// (96,443), so the planner sends JPEG (web lib/ortho-capture.ts,
// PLAN_THUMBNAIL); the sheet PDF embeds either (sheet-pdf/blocks.ts
// diagramBytes). The long-term answer is R2 upload with a presigned URL; this
// is the pragmatic single-tenant path.
const MAX_THUMBNAIL_STRING_LEN = 270_000;
/** Each accepted thumbnail type, with the bytes its image must start with. */
const THUMBNAIL_TYPES = [
  { prefix: "data:image/png;base64,", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { prefix: "data:image/jpeg;base64,", signature: [0xff, 0xd8, 0xff] },
] as const;
/** Padded base64 and nothing else, as canvas.toDataURL writes it (linear to test, even at the cap). */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** A PNG or JPEG data URL, plain base64 throughout, whose bytes begin as its declared type's do. */
function isThumbnailDataUrl(value: string): boolean {
  const type = THUMBNAIL_TYPES.find(({ prefix }) => value.startsWith(prefix));
  if (type === undefined) return false;
  const body = value.slice(type.prefix.length);
  if (body.length % 4 !== 0 || !BASE64.test(body)) return false;
  // Twelve base64 characters decode to the first nine bytes, enough for either signature.
  const head = Buffer.from(body.slice(0, 12), "base64");
  return type.signature.every((byte, index) => head[index] === byte);
}
const ThumbnailBody = z.object({
  thumbnailUrl: z.string()
    .max(MAX_THUMBNAIL_STRING_LEN, "Thumbnail data URL too large (max ~200KB decoded)")
    .refine(isThumbnailDataUrl, "Must be a PNG or JPEG data URL whose bytes match its type"),
});

/** A guest plan the venue has taken into review holds still for its snapshot
 *  until it is sent back, as a signed-in planner's does; a status this code
 *  does not know holds it too. */
function lockedFor(reviewStatus: string): { error: string; code: "CONFIG_LOCKED"; reviewStatus: string } | null {
  const status = ConfigurationReviewStatusSchema.safeParse(reviewStatus);
  if (status.success && isPlannerEditable(status.data)) return null;
  return { error: "This plan is with the venue for review, so it cannot be changed now.", code: "CONFIG_LOCKED", reviewStatus };
}

// ---------------------------------------------------------------------------
// Plugin — public (no auth) configuration endpoints
// ---------------------------------------------------------------------------

export async function publicConfigRoutes(
  server: FastifyInstance,
  opts: { db: Database; saveBudget?: GuestSaveBudget },
): Promise<void> {
  const { db } = opts;
  const saveBudget = opts.saveBudget ?? new GuestSaveBudget();

  // POST /public/configurations — create anonymous preview config
  server.post("/configurations", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const parsed = CreatePublicConfigBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify space exists and get venueId
    const [space] = await db.select({ id: spaces.id, venueId: spaces.venueId })
      .from(spaces)
      .where(and(eq(spaces.id, parsed.data.spaceId), isNull(spaces.deletedAt)))
      .limit(1);

    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    // Generate a guest-URL shortcode up-front so the insert below can
    // persist it atomically with the config row. Uniqueness is verified
    // against the live `configurations.short_code` index via the
    // existence probe.
    const shortCode = await generateUniqueShortCode(async (candidate) => {
      const [hit] = await db
        .select({ id: configurations.id })
        .from(configurations)
        .where(and(eq(configurations.shortCode, candidate), isNull(configurations.deletedAt)))
        .limit(1);
      return hit !== undefined;
    });

    // The plan and its claim secret are written together: the secret goes to
    // this browser alone, and is what lets it claim the plan into an account
    // later (migration 0102). Only its hash is stored.
    const claimSecret = generateClaimSecret();
    const config = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(configurations).values({
        spaceId: parsed.data.spaceId,
        venueId: space.venueId,
        userId: null,
        name: parsed.data.name,
        layoutStyle: "custom",
        isPublicPreview: true,
        visibility: "public",
        shortCode,
      }).returning();
      if (inserted === undefined) return undefined;
      await tx.insert(configurationClaimSecrets).values({
        configurationId: inserted.id,
        secretHash: hashClaimSecret(claimSecret),
      });
      return inserted;
    });

    if (config === undefined) {
      return reply.status(500).send({ error: "Insert returned no row", code: "INSERT_FAILED" });
    }

    // Seed layout_aliases so the resolver's fast path (Tier 1) hits
    // immediately — both the UUID form and the canonical shortcode URL
    // point at this row, neither retired. Alias insert errors are
    // swallowed: the resolver's Tier 2 direct-column fallback still
    // serves the URL correctly, so a transient alias-write failure
    // doesn't block config creation.
    try {
      await db.insert(layoutAliases).values([
        {
          configurationId: config.id,
          kind: "uuid",
          pathKey: buildLayoutPathKey("uuid", { uuid: config.id }),
          retiredAt: null,
        },
        {
          configurationId: config.id,
          kind: "shortcode",
          pathKey: buildLayoutPathKey("shortcode", { shortCode }),
          retiredAt: null,
        },
      ]);
    } catch (err) {
      // Operational signal — resolver's Tier 2 fallback still serves the URL.
      console.warn("public-configs: layout_aliases seed failed (resolver Tier 2 still covers):", err);
    }

    reply.header("ETag", configurationRevisionEtag(config.revision));
    // A new plan holds no note, so the browser that made it has them all.
    return reply.status(201).send({ data: { ...config, claimSecret, notesIncluded: true } });
  });

  // POST /public/configurations/:configId/objects/batch — save objects to preview config
  //
  // The planner saves itself three seconds after every change: at most twenty
  // saves a minute from one tab, and hundreds an hour from an engaged guest.
  // Sixty a minute per address lets several people behind one connection (a
  // home, an office, an open day) save at that pace, and an address that does
  // exceed it saves again within the minute. What an address may store is
  // bounded separately, in bytes, by the allowance charged below.
  server.post("/configurations/:configId/objects/batch", {
    bodyLimit: PUBLIC_BATCH_BODY_LIMIT_BYTES,
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const parsed = BatchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Only allow saving to public preview configs. Guest autosaves need the
    // revision and room only — never the stored thumbnail data URL.
    const [config] = await db.select({ revision: configurations.revision, spaceId: configurations.spaceId, reviewStatus: configurations.reviewStatus })
      .from(configurations)
      .where(and(
        eq(configurations.id, params.data.configId),
        eq(configurations.isPublicPreview, true),
        isNull(configurations.deletedAt),
      ))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }
    const locked = lockedFor(config.reviewStatus);
    if (locked !== null) return reply.status(409).send(locked);

    if (config.revision !== parsed.data.expectedRevision) {
      // When, never who: an anonymous caller is not told who edited.
      const change = await loadRevisionChange(db, params.data.configId, config.revision,
        { discloseActor: false, callerUserId: null, log: request.log });
      reply.header("ETag", configurationRevisionEtag(config.revision));
      return reply.status(409).send(revisionConflictBody(parsed.data.expectedRevision, config.revision, change));
    }

    // Verify all referenced assetDefinitionIds exist before touching the DB.
    // Without this check, malformed batches can insert placed_objects rows with
    // broken FK references (the DB constraint will reject them, but a clear 422
    // is more informative than a generic 500 from a FK violation).
    const uniqueAssetIds = [...new Set(parsed.data.objects.map((o) => o.assetDefinitionId))];
    if (uniqueAssetIds.length > 0) {
      const found = await db.select({ id: assetDefinitions.id })
        .from(assetDefinitions)
        .where(inArray(assetDefinitions.id, uniqueAssetIds));
      if (found.length !== uniqueAssetIds.length) {
        const foundIds = new Set(found.map((a) => a.id));
        const missingIds = uniqueAssetIds.filter((id) => !foundIds.has(id));
        return reply.status(422).send({
          error: "Unknown asset definition IDs",
          code: "ASSET_NOT_FOUND",
          details: { missingIds },
        });
      }
    }

    // Polygon containment check — every placement must lie inside the
    // space's floor-plan outline. Guest submissions get the same gate as
    // authenticated batches; we don't want anonymous users inserting
    // objects outside the room either (they'd just show up as visual
    // glitches in the hallkeeper sheet later).
    if (parsed.data.objects.length > 0) {
      const outline = await loadSpacePolygon(db, config.spaceId);
      if (outline === null) {
        return reply.status(500).send({ error: "Space outline missing for configuration", code: "INTERNAL_ERROR" });
      }
      const invalid = validatePlacementsInPolygon(parsed.data.objects, outline);
      if (invalid.length > 0) {
        return reply.status(422).send(placementOutOfBoundsBody(invalid));
      }
    }

    const configId = params.data.configId;

    // This save is about to be written: it draws on what its address may
    // store (services/guest-save-budget.ts). Saves refused above cost nothing.
    const allowance = saveBudget.charge(request.ip, saveBytes(request), Date.now());
    if (!allowance.ok) {
      reply.header("Retry-After", String(allowance.retryAfterSeconds));
      return reply.status(429).send({ error: "Too many requests — please slow down.", code: "RATE_LIMITED" });
    }

    const madeHere = await presentsClaimSecret(db, configId, request);
    // The notes are taken as sent only from the browser that made the plan,
    // saving a document it read with them.
    const notesAsSent = madeHere && parsed.data.notesIncluded === true;

    // Atomic batch: delete stale + update + insert in one transaction. A save
    // refused for a held note, or for a piece holding one that it leaves out,
    // has already advanced the revision by then, so its transaction is rolled
    // back and keeps nothing.
    const saveResult = await writeOrRefuse<GuestSaveOutcome>(db, async (tx, refuse) => {
      const txResults: PlacedObjectRow[] = [];

      const [advanced] = await tx.update(configurations)
        .set({
          revision: sql`${configurations.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(configurations.id, configId),
          eq(configurations.revision, parsed.data.expectedRevision),
          eq(configurations.isPublicPreview, true),
          // Still in the editable state read above: a review begun since holds it.
          eq(configurations.reviewStatus, config.reviewStatus),
          isNull(configurations.deletedAt),
        ))
        .returning({ revision: configurations.revision });

      if (advanced === undefined) {
        const [current] = await tx.select({ revision: configurations.revision, reviewStatus: configurations.reviewStatus })
          .from(configurations)
          .where(and(
            eq(configurations.id, configId),
            eq(configurations.isPublicPreview, true),
            isNull(configurations.deletedAt),
          ))
          .limit(1);
        // A review begun since the check holds the plan: that, not a newer
        // version, is why nothing was saved.
        if (current !== undefined && lockedFor(current.reviewStatus) !== null) {
          return { status: "locked" as const, reviewStatus: current.reviewStatus };
        }
        return {
          status: "conflict" as const,
          currentRevision: current?.revision ?? config.revision,
        };
      }

      const settled: SettledNotes = notesAsSent
        ? { pieces: parsed.data.objects, refused: [], omitted: [] }
        : await settledNotes(tx, configId, parsed.data.objects);
      // A save that would remove a held note is answered for that first: the
      // planner's resend after NOTE_HELD would still leave the piece out.
      if (settled.omitted.length > 0) return refuse({ status: "held-piece-omitted" });
      if (settled.refused.length > 0) return refuse({ status: "note-held" });
      txResults.push(...await syncPlacedObjectBatch(tx, configId, settled.pieces));

      await tx.insert(configurationLayoutRevisions).values({
        configurationId: configId,
        revision: advanced.revision,
        source: "public_batch",
        actorUserId: null,
        payload: {
          objectCount: txResults.length,
          objects: txResults,
        },
      });

      return {
        status: "saved" as const,
        objects: txResults,
        revision: advanced.revision,
      };
    });

    if (saveResult.status === "locked") {
      return reply.status(409).send(lockedFor(saveResult.reviewStatus));
    }
    if (saveResult.status === "note-held") {
      return reply.status(409).send(NOTE_HELD_REFUSAL);
    }
    if (saveResult.status === "held-piece-omitted") {
      return reply.status(409).send(HELD_PIECE_OMITTED_REFUSAL);
    }
    if (saveResult.status === "conflict") {
      const change = await loadRevisionChange(db, configId, saveResult.currentRevision,
        { discloseActor: false, callerUserId: null, log: request.log });
      reply.header("ETag", configurationRevisionEtag(saveResult.currentRevision));
      return reply.status(409).send(
        revisionConflictBody(parsed.data.expectedRevision, saveResult.currentRevision, change),
      );
    }

    // Commit, then announce: the transaction above has resolved, so an
    // uncommitted write can never be broadcast (live co-editing v1).
    emit(request.log, "layout.changed", {
      configId,
      revision: saveResult.revision,
      actorUserId: null,
      source: "public_batch",
      at: new Date().toISOString(),
    });
    reply.header("ETag", configurationRevisionEtag(saveResult.revision));
    const saved = madeHere ? saveResult.objects : withoutUnsentNotes(saveResult.objects, parsed.data.objects);
    return { data: { objects: saved, revision: saveResult.revision } };
  });

  // POST /public/configurations/:configId/thumbnail — set floor plan diagram
  //
  // Uses POST (not PATCH) because the public API client's `api.post()`
  // supports `skipAuth` while `api.patch()` does not. Consistent with
  // the other public config endpoints which are all POST.
  //
  // Punch list #24: the hallkeeper sheet PDF prints `configurations.thumbnailUrl`
  // for a layout saved with no plan; with a plan it draws the plan itself
  // (sheet-pdf/blocks.ts). The ortho capture happens in the browser
  // (Three.js scene → JPEG data URL, PLAN_THUMBNAIL). This endpoint stores the
  // data URL in the thumbnailUrl column. Only works for unclaimed public preview
  // configs — claimed configs use the authenticated PATCH /configurations/:id.
  //
  // Security: no auth required (consistent with other public config endpoints).
  // Scoped to isPublicPreview=true. Body is validated as a PNG or JPEG data URL
  // whose bytes match its type, within 270,000 characters (about 200 KB
  // decoded). Rate-limited to 20/hour to prevent abuse.
  server.post("/configurations/:configId/thumbnail", {
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const parsed = ThumbnailBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Only allow thumbnail updates on unclaimed public preview configs
    const [config] = await db.select({ id: configurations.id, reviewStatus: configurations.reviewStatus })
      .from(configurations)
      .where(and(
        eq(configurations.id, params.data.configId),
        eq(configurations.isPublicPreview, true),
        isNull(configurations.deletedAt),
      ))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }
    const locked = lockedFor(config.reviewStatus);
    if (locked !== null) return reply.status(409).send(locked);

    const [updated] = await db.update(configurations)
      .set({ thumbnailUrl: parsed.data.thumbnailUrl, updatedAt: new Date() })
      .where(and(
        eq(configurations.id, params.data.configId),
        eq(configurations.isPublicPreview, true),
        isNull(configurations.userId),
        eq(configurations.reviewStatus, config.reviewStatus),
        isNull(configurations.deletedAt),
      ))
      .returning();

    if (updated === undefined) {
      const [now] = await db.select({ reviewStatus: configurations.reviewStatus })
        .from(configurations)
        .where(and(eq(configurations.id, params.data.configId), eq(configurations.isPublicPreview, true), isNull(configurations.deletedAt)))
        .limit(1);
      const lockedNow = now === undefined ? null : lockedFor(now.reviewStatus);
      if (lockedNow !== null) return reply.status(409).send(lockedNow);
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }
    reply.header("ETag", configurationRevisionEtag(updated.revision));
    const madeHere = await presentsClaimSecret(db, params.data.configId, request);
    return { data: madeHere ? updated : withoutVenueNotes(updated) };
  });

  // GET /public/configurations/:configId — get a PUBLIC PREVIEW config with objects
  //
  // SECURITY: this endpoint is anonymous (no auth header required) so it
  // MUST only return public-preview configurations. Once a config is
  // claimed (`isPublicPreview = false`), it becomes private and is
  // accessible only via the authenticated `GET /configurations/:id`
  // endpoint, which enforces ownership/venue access via canAccessResource.
  //
  // Punch list #2 / #33: the previous version had no filter, so any
  // leaked or guessed UUID could expose a private claimed layout — and
  // the frontend was loading every config (claimed or not) through this
  // endpoint, which made the bug invisible until diligence.
  server.get("/configurations/:configId", async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const [config] = await db.select()
      .from(configurations)
      .where(and(
        eq(configurations.id, params.data.configId),
        eq(configurations.isPublicPreview, true),
        isNull(configurations.deletedAt),
      ))
      .limit(1);

    if (config === undefined) {
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }

    const objects = await db.select()
      .from(placedObjects)
      .where(eq(placedObjects.configurationId, params.data.configId))
      .orderBy(placedObjects.sortOrder);

    reply.header("ETag", configurationRevisionEtag(config.revision));
    // One address, two answers, told apart by a request header: nothing
    // between here and the reader may keep either to hand to the other.
    reply.header("Cache-Control", "private, no-store");
    const madeHere = await presentsClaimSecret(db, params.data.configId, request);
    return {
      data: madeHere
        ? { ...config, objects, notesIncluded: true }
        : { ...withoutVenueNotes(config), objects: objects.map(withoutNote), notesIncluded: false },
    };
  });

  // GET /public/configurations/:configId/plan.pdf — the visitor's plan, to send on
  //
  // Fix-first item 11: an organiser with no account can hand the plan to
  // someone else. The organiser's own browser asks with the id it already
  // holds, under exactly the GET rule above (a live public preview). The PDF
  // it gets back is read-only by nature and carries no configuration id,
  // short code or planner URL, no prices, and the line "Drawn by a visitor;
  // not reviewed by the venue." (services/visitor-plan-pdf.ts). Drawing is
  // CPU work, so the hourly limit sits below the batch save's.
  server.get("/configurations/:configId/plan.pdf", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ConfigIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid config ID", code: "VALIDATION_ERROR" });
    }

    const plan = await loadVisitorPlan(db, params.data.configId);
    if (plan === null) {
      return reply.status(404).send({ error: "Public preview configuration not found", code: "NOT_FOUND" });
    }

    const pdf = await generateVisitorPlanPdf(plan);
    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${visitorPlanFilename(plan.roomName)}"`)
      // A guest plan keeps changing; a cached copy would send yesterday's layout.
      .header("Cache-Control", "no-store")
      .header("Content-Length", pdf.length)
      .send(pdf);
  });
}
