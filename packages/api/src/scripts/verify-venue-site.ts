import { pathToFileURL } from "node:url";
import { z } from "zod";
import { VenueSkySchema } from "@omnitwin/types";
import { TRADES_HALL_SITE, TRADES_HALL_VENUE_SLUG, siteAgreement } from "../lib/venue-site.js";

// ---------------------------------------------------------------------------
// Read-only check of a deployed API (T-647): Trades Hall's stored location
// agrees with the site agreed with T-639 within 100 m, and its sky answers.
//
//   pnpm --filter @omnitwin/api venue:verify-site -- --api https://api.venviewer.com
//
// Uses only public endpoints (GET /venues, GET /venues/:id/sky); needs no
// credentials and writes nothing. Exits 1 when the location is missing or
// disagrees, or the sky answer does not match the contract.
// ---------------------------------------------------------------------------

const VenueListSchema = z.object({
  data: z.array(z.object({
    id: z.string().uuid(),
    slug: z.string(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  })),
});

function apiBase(argv: readonly string[]): URL {
  const index = argv.indexOf("--api");
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined) throw new Error("Usage: venue:verify-site -- --api <https://api origin>");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("--api must be an https origin (or a loopback address)");
  }
  return url;
}

// Operator-facing, secret-free lines (this script reads only public data).
const say = (line: string): void => { process.stdout.write(`${line}\n`); };
const complain = (line: string): void => { process.stderr.write(`${line}\n`); };

async function getJson(url: URL): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

export async function verifyVenueSite(base: URL): Promise<boolean> {
  const list = await getJson(new URL("/venues?limit=100", base));
  if (list.status !== 200) throw new Error(`GET /venues answered ${String(list.status)}`);
  const venue = VenueListSchema.parse(list.body).data.find((row) => row.slug === TRADES_HALL_VENUE_SLUG);
  if (venue === undefined) {
    complain(`No venue with slug ${TRADES_HALL_VENUE_SLUG} in the first 100 venues.`);
    return false;
  }
  const agreement = siteAgreement({ latitude: venue.latitude ?? null, longitude: venue.longitude ?? null });
  if (!agreement.agrees) {
    complain(`Trades Hall location ${agreement.reason === "not_located" ? "is not set (has migration 0086 run?)" : `is ${String(Math.round(agreement.distanceM ?? 0))} m from the agreed site`}.`);
    return false;
  }
  say(`Trades Hall location agrees with ${String(TRADES_HALL_SITE.latitude)}, ${String(TRADES_HALL_SITE.longitude)} (${agreement.distanceM.toFixed(1)} m).`);

  const sky = await getJson(new URL(`/venues/${venue.id}/sky`, base));
  if (sky.status === 503) {
    say(`Sky: 503 ${JSON.stringify(sky.body)}`);
    return true;
  }
  if (sky.status !== 200) {
    complain(`GET /venues/${venue.id}/sky answered ${String(sky.status)}.`);
    return false;
  }
  const parsed = VenueSkySchema.safeParse((sky.body as { data?: unknown }).data);
  if (!parsed.success) {
    complain("The sky answer does not match the VenueSky contract.");
    return false;
  }
  say(`Sky: ${parsed.data.kind}${parsed.data.degraded === null ? "" : ` (${parsed.data.degraded.reason})`}, issued ${parsed.data.issuedAt ?? "unstated"}.`);
  return true;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyVenueSite(apiBase(process.argv.slice(2)))
    .then((ok) => { process.exitCode = ok ? 0 : 1; })
    .catch((error: unknown) => {
      complain(error instanceof Error ? error.message : "verification failed");
      process.exitCode = 1;
    });
}
