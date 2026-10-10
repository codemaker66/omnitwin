// ---------------------------------------------------------------------------
// Which Met Office BPF v2 collections the sky reads (T-647).
//
// What is known about the collection ids (read 2026-10-10):
// - Production, 10 October: the v2 service accepted the key and listed its
//   collections, but none was improver-percentiles-spot-uk or ended in it.
//   Those are the v1 ids. The Met Office's own download utilities
//   (github.com/MetOffice/weather_datahub_utilities, bpf_download, written
//   for mo-site-specific-blended-probabilistic-forecast/1.0.0) list
//   improver-{percentiles,probabilities}-spot-{uk,global}, and the DataHub
//   glossary names the models mo-improver-….
// - The v2 OpenAPI definition documents a collection as { id, title, links,
//   output_formats } and names no ids. The DataHub's v2 sample files are
//   improver-uk-percentiles-edinburgh.json and
//   improver-uk-probabilistic-edinburgh.json.
// - A third-party v2 client's README (christianjbrown/
//   met-office-weather-datahub-api-sdk-php) names uk-spot-percentiles,
//   uk-spot-probabilities, global-spot-percentiles and
//   global-spot-probabilities, each with one instance, "blended". It has not
//   been checked against a live listing here.
//
// So no spelling is required. A collection is classified by what it
// declares: the keys of its EDR parameter_names when the listing carries
// them (percentile collections hold plain keys such as airTemperature1p5m,
// probability collections the probabilityOf… keys, per the DataHub's "BPF
// v2 parameter name changes" table); otherwise by the words of its id, then
// of its title: "percentile(s)" or "probability"/"probabilities", and "uk"
// or "global". "Probabilistic" marks the probability set in an id, as the
// sample files use it, but not in a title, where it is the product's name.
//
// Among one kind's candidates, the order is:
// 1. collections whose declared parameters the sky reads;
// 2. the UK set, then an unnamed region, then the global set (UK spot sites
//    are post-processed on the finer UK grid, and the venue is in Glasgow);
// 3. the most parameters the sky reads;
// 4. the id, so the choice is stable.
// Probabilities prefer the region the percentiles came from. A percentile
// set that declares neither total cloud nor temperature is never chosen,
// because the forecast needs one of them. Nothing is chosen from a
// collection that cannot be classified.
// ---------------------------------------------------------------------------

export interface ListedCollection {
  readonly id: string;
  readonly title: string | null;
  /** The parameter keys the listing declares for it; null when it declares none. */
  readonly parameters: readonly string[] | null;
}

export type CollectionKind = "percentiles" | "probabilities";
export type CollectionRegion = "uk" | "global";

export interface CollectionChoice {
  readonly id: string;
  readonly region: CollectionRegion | null;
  /** What identified it: the parameters it declares, or the words of its id or title. */
  readonly basis: "parameters" | "name";
}

export interface CollectionSelection {
  readonly percentiles: CollectionChoice | null;
  readonly probabilities: CollectionChoice | null;
}

export interface WantedParameters {
  /** Percentile keys a forecast cannot do without: a percentile set must declare one. */
  readonly percentilesEssential: readonly string[];
  readonly percentiles: readonly string[];
  readonly probabilities: readonly string[];
}

interface Candidate extends CollectionChoice {
  readonly kind: CollectionKind;
  /** How many of its kind's wanted parameters it declares (0 when known by name only). */
  readonly offered: number;
}

function words(text: string | null): ReadonlySet<string> {
  return new Set((text ?? "").toLowerCase().split(/[^a-z0-9]+/u).filter((word) => word !== ""));
}

function kindFromWords(found: ReadonlySet<string>, probabilisticMarksKind: boolean): CollectionKind | null {
  const percentile = found.has("percentile") || found.has("percentiles");
  const probability = found.has("probability") || found.has("probabilities");
  if (percentile && probability) return null;
  if (percentile) return "percentiles";
  if (probability || (probabilisticMarksKind && found.has("probabilistic"))) return "probabilities";
  return null;
}

function regionFromWords(found: ReadonlySet<string>): CollectionRegion | undefined {
  const uk = found.has("uk");
  const global = found.has("global");
  if (uk === global) return undefined;
  return uk ? "uk" : "global";
}

function classify(collection: ListedCollection, wanted: WantedParameters): Candidate | null {
  const idWords = words(collection.id);
  const titleWords = words(collection.title);
  const region = regionFromWords(idWords) ?? regionFromWords(titleWords) ?? null;
  if (collection.parameters !== null && collection.parameters.length > 0) {
    const declared = new Set(collection.parameters);
    const percentiles = wanted.percentiles.filter((key) => declared.has(key)).length;
    const probabilities = wanted.probabilities.filter((key) => declared.has(key)).length;
    if (percentiles === 0 && probabilities === 0) return null;
    if (probabilities === 0) {
      if (!wanted.percentilesEssential.some((key) => declared.has(key))) return null;
      return { id: collection.id, region, basis: "parameters", kind: "percentiles", offered: percentiles };
    }
    if (percentiles === 0) {
      return { id: collection.id, region, basis: "parameters", kind: "probabilities", offered: probabilities };
    }
    // It declares parameters of both kinds: its name decides.
  }
  const kind = kindFromWords(idWords, true) ?? kindFromWords(titleWords, false);
  return kind === null ? null : { id: collection.id, region, basis: "name", kind, offered: 0 };
}

const REGION_ORDER: readonly (CollectionRegion | null)[] = ["uk", null, "global"];

function best(candidates: readonly Candidate[], preferredRegion: CollectionRegion | null | undefined): CollectionChoice | null {
  const regionRank = (region: CollectionRegion | null): number =>
    preferredRegion !== undefined && region === preferredRegion ? -1 : REGION_ORDER.indexOf(region);
  const basisRank = (basis: CollectionChoice["basis"]): number => (basis === "parameters" ? 0 : 1);
  const [first] = [...candidates].sort((a, b) =>
    basisRank(a.basis) - basisRank(b.basis)
    || regionRank(a.region) - regionRank(b.region)
    || b.offered - a.offered
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return first === undefined ? null : { id: first.id, region: first.region, basis: first.basis };
}

/** The percentile and probability collections to read, from a listing. */
export function selectCollections(listed: readonly ListedCollection[], wanted: WantedParameters): CollectionSelection {
  const candidates = listed.map((collection) => classify(collection, wanted)).filter((candidate): candidate is Candidate => candidate !== null);
  const percentiles = best(candidates.filter((candidate) => candidate.kind === "percentiles"), undefined);
  const probabilities = best(candidates.filter((candidate) => candidate.kind === "probabilities"), percentiles?.region);
  return { percentiles, probabilities };
}

// ---------------------------------------------------------------------------
// The listing in a log line. Ids and titles are public metadata from the
// Met Office, but still untrusted text: at most 25 collections, each id and
// title cut to 100 printable characters. Links are never kept; the key
// travels in a request header and appears in no URL.
// ---------------------------------------------------------------------------

const LOGGED_COLLECTIONS = 25;
const LOGGED_TEXT = 100;

function loggable(text: string): string {
  return text.replace(/[^ -~]+/gu, "?").slice(0, LOGGED_TEXT);
}

export interface LoggedCollection {
  readonly id: string;
  readonly title: string | null;
  readonly parameters: number | null;
}

/** Each listed collection's id, title and declared parameter count. */
export function describeListing(listed: readonly ListedCollection[]): LoggedCollection[] {
  return listed.slice(0, LOGGED_COLLECTIONS).map((collection) => ({
    id: loggable(collection.id),
    title: collection.title === null ? null : loggable(collection.title),
    parameters: collection.parameters === null ? null : collection.parameters.length,
  }));
}

/** The listed ids on one line, for an error's detail. */
export function offeredIds(listed: readonly ListedCollection[]): string {
  if (listed.length === 0) return "none";
  const shown = listed.slice(0, LOGGED_COLLECTIONS).map((collection) => loggable(collection.id)).join(", ");
  const more = listed.length - LOGGED_COLLECTIONS;
  return more > 0 ? `${shown} and ${String(more)} more` : shown;
}
