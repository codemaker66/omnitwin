import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq } from "drizzle-orm";
import { crowdedDayOpenRequests } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { seedCrowdedDay } from "../test-support/crowded-day-seed.js";

// ---------------------------------------------------------------------------
// Write the crowded Trades Hall day into the LOCAL demo stack (L9).
//
//   VENVIEWER_CROWDED_DAY_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/omnitwin_dev \
//     pnpm --filter @omnitwin/api exec tsx src/scripts/seed-crowded-day-local.ts [YYYY-MM-DD] [--attach-email you@example]
//
// A new venue of its own each run (nothing existing is changed or deleted),
// on the given date, or today in London so the Day Board opens on it. The
// fixture's people have no sign-in; to see the day signed in, --attach-email
// points ONE existing local account at the new venue (its venue only; its
// role stays as it is, and must be a floor role to see the board). Refused
// for any target but the named local database on 127.0.0.1:54329, reached
// through the local neon bridge on 54331. Never point it at production.
// ---------------------------------------------------------------------------

const ALLOWED_DATABASES = new Set(["/omnitwin_dev", "/venviewer_crowded_day"]);

const databaseUrl = process.env["VENVIEWER_CROWDED_DAY_DATABASE_URL"];
if (databaseUrl === undefined) {
  throw new Error("Set VENVIEWER_CROWDED_DAY_DATABASE_URL to the local demo database (127.0.0.1:54329/omnitwin_dev)");
}
const target = new URL(databaseUrl);
if (target.hostname !== "127.0.0.1" || target.port !== "54329" || !ALLOWED_DATABASES.has(target.pathname)) {
  throw new Error("Seed refused: the crowded day is written only to omnitwin_dev or venviewer_crowded_day on 127.0.0.1:54329");
}

const args = process.argv.slice(2);
const attachAt = args.indexOf("--attach-email");
const attachEmail = attachAt === -1 ? null : args[attachAt + 1] ?? null;
if (attachAt !== -1 && attachEmail === null) throw new Error("--attach-email needs an address");
const dateArg = args.find((arg, index) => /^\d{4}-\d{2}-\d{2}$/u.test(arg) && index !== attachAt + 1);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date());
const date = dateArg ?? today;

neonConfig.wsProxy = (host) => `${host}:54331/v1`;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineTLS = false;
neonConfig.pipelineConnect = false;
const pool = new Pool({ connectionString: databaseUrl });
try {
  const db = drizzle(pool, { schema });
  const seeded = await seedCrowdedDay(db, date);
  if (attachEmail !== null) {
    const moved = await db.update(schema.users)
      .set({ venueId: seeded.venueId, updatedAt: new Date() })
      .where(eq(schema.users.email, attachEmail))
      .returning({ id: schema.users.id, role: schema.users.role });
    if (moved.length === 0) throw new Error(`No local account ${attachEmail}; the day was written, nobody was attached`);
    process.stdout.write(`Attached ${attachEmail} (${moved[0]?.role ?? "unknown role"}) to the crowded day's venue.\n`);
  }
  const busiest = new Date(seeded.day.busiestAtMs).toISOString();
  process.stdout.write(`${JSON.stringify({
    venueId: seeded.venueId,
    venueName: seeded.day.venue.name,
    date: seeded.day.date,
    busiestMoment: busiest,
    rooms: seeded.day.rooms.length,
    functions: seeded.day.calendar.entries.filter((entry) => entry.entryType === "booking").length,
    openRequests: crowdedDayOpenRequests(seeded.day).length,
    people: seeded.day.people.map((person) => ({ name: person.name, role: person.role, id: seeded.personId(person.name) })),
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
