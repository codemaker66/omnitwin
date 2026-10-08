import { describe, expect, it } from "vitest";
import type { SearchResults } from "../../../../api/clients.js";
import {
  activeKeyAfter,
  buildFindGroups,
  findScope,
  FIND_GROUP_LIMIT,
  matchPlaces,
  normaliseQuery,
  rowsOf,
  wantsClientSearch,
  type FindPlace,
} from "../find-model.js";

// ---------------------------------------------------------------------------
// Find's model (T-635, roadmap Tier A #8): what a typed name, date or page
// finds, in which order, and where each finding opens.
// ---------------------------------------------------------------------------

const TODAY = "2026-10-07";

const STAFF_PLACES: readonly FindPlace[] = [
  { id: "plan", label: "Plan", href: "/plan" },
  { id: "diary", label: "Diary", href: "/diary" },
  { id: "hallkeeper", label: "Hallkeeper", href: "/hallkeeper/today" },
  { id: "rota", label: "Rota", href: "/dashboard?view=rota" },
  { id: "enquiries", label: "Enquiries", href: "/dashboard?view=enquiries" },
  { id: "pipeline", label: "Pipeline", href: "/dashboard?view=pipeline" },
  { id: "reviews", label: "Pending reviews", href: "/dashboard?view=reviews" },
  { id: "proposals", label: "Proposals", href: "/dashboard?view=proposals" },
  { id: "search", label: "Clients", href: "/dashboard?view=search" },
  { id: "settings", label: "Venue settings", href: "/dashboard?view=settings" },
];

/** What sales is offered: no Clients, and so no client search (Blake's C2). */
const SALES_PLACES = STAFF_PLACES.filter((place) => place.id !== "search" && place.id !== "hallkeeper" && place.id !== "plan");
/** A hallkeeper: Clients (people and layouts), but no pipeline. */
const HALLKEEPER_PLACES = STAFF_PLACES.filter((place) => place.id !== "pipeline" && place.id !== "proposals");

const AILSA = "00000000-0000-4000-8000-000000009511";
const ACCOUNT = "00000000-0000-4000-8000-000000009521";
const ORPHAN_ACCOUNT = "00000000-0000-4000-8000-000000009522";
const DEAL = "00000000-0000-4000-8000-000000009531";
const PROPOSAL = "00000000-0000-4000-8000-000000009541";
const LAYOUT = "00000000-0000-4000-8000-000000009571";

const NOTHING: SearchResults = { users: [], guestLeads: [], configurations: [], contacts: [], accounts: [], deals: [], proposals: [] };

const HENDERSON: SearchResults = {
  ...NOTHING,
  contacts: [{ id: AILSA, name: "Ailsa Henderson", email: "ailsa@example.test", phone: null, accountName: "Henderson Family" }],
  accounts: [
    { id: ACCOUNT, name: "Henderson Family", accountType: "individual", primaryContactId: AILSA },
    { id: ORPHAN_ACCOUNT, name: "Henderson Trust", accountType: "organisation", primaryContactId: null },
  ],
  deals: [{ id: DEAL, title: "Wedding reception, 5 June", stage: "proposal_sent", preferredDate: "2027-06-05", guestCount: 160, contactName: "Ailsa Henderson" }],
  proposals: [{ id: PROPOSAL, title: "Henderson wedding proposal", status: "sent", currentVersion: 2, opportunityId: DEAL, sentAt: "2026-09-30T14:00:00.000Z" }],
  configurations: [{ id: LAYOUT, name: "Henderson rounds", spaceName: "Grand Hall", userName: "Ailsa Henderson", createdAt: "2026-09-01T10:00:00.000Z" }],
};

function build(query: string, overrides: Partial<Parameters<typeof buildFindGroups>[0]> = {}) {
  return buildFindGroups({
    query: normaliseQuery(query),
    today: TODAY,
    places: STAFF_PLACES,
    board: null,
    clients: null,
    ...overrides,
  });
}

describe("normaliseQuery", () => {
  it("trims and folds runs of spaces, so what is searched is what was meant", () => {
    expect(normaliseQuery("  Ailsa   Henderson ")).toBe("Ailsa Henderson");
    expect(normaliseQuery("\t")).toBe("");
  });
});

describe("matchPlaces", () => {
  it("lists every place, in the header's order, before anything is typed", () => {
    expect(matchPlaces("", STAFF_PLACES).map((place) => place.id)).toEqual(STAFF_PLACES.map((place) => place.id));
  });

  it("finds a page by the start of its name or of any word in it", () => {
    expect(matchPlaces("pip", STAFF_PLACES).map((place) => place.id)).toEqual(["pipeline"]);
    expect(matchPlaces("reviews", STAFF_PLACES).map((place) => place.id)).toEqual(["reviews"]);
    expect(matchPlaces("Venue", STAFF_PLACES).map((place) => place.id)).toEqual(["settings"]);
  });

  it("finds a page by the words a venue team uses for it", () => {
    expect(matchPlaces("calendar", STAFF_PLACES).map((place) => place.id)).toEqual(["diary"]);
    expect(matchPlaces("holds", STAFF_PLACES).map((place) => place.id)).toEqual(["diary"]);
    expect(matchPlaces("quotes", STAFF_PLACES).map((place) => place.id)).toEqual(["proposals"]);
    expect(matchPlaces("deals", STAFF_PLACES).map((place) => place.id)).toEqual(["pipeline"]);
    expect(matchPlaces("function sheet", STAFF_PLACES).map((place) => place.id)).toEqual(["hallkeeper"]);
    expect(matchPlaces("changeover", STAFF_PLACES).map((place) => place.id)).toEqual(["settings"]);
  });

  it("matches a team's word only from three letters, so one letter finds pages by name alone", () => {
    expect(matchPlaces("p", STAFF_PLACES).map((place) => place.id)).toEqual(["plan", "pipeline", "reviews", "proposals"]);
  });

  it("puts a page named by the words ahead of one only called that", () => {
    // "sale" starts no page's name; "sales" is the Pipeline's word.
    expect(matchPlaces("sale", STAFF_PLACES).map((place) => place.id)).toEqual(["pipeline"]);
    // "set" starts "Venue settings"' second word and the Hallkeeper's "setup".
    expect(matchPlaces("set", STAFF_PLACES).map((place) => place.id)).toEqual(["settings", "hallkeeper"]);
  });

  it("never offers a page the person cannot open", () => {
    expect(matchPlaces("clients", SALES_PLACES)).toEqual([]);
    expect(matchPlaces("contacts", SALES_PLACES)).toEqual([]);
  });

  it("finds nothing for words that name no page", () => {
    expect(matchPlaces("henderson", STAFF_PLACES)).toEqual([]);
  });
});

describe("the date row", () => {
  it("answers a date said the British way with the Diary on that day, room by room", () => {
    const [first] = build("14 nov");
    expect(first?.key).toBe("date");
    expect(first?.label).toBe("Date");
    expect(first?.rows).toEqual([expect.objectContaining({
      key: "date:2026-11-14",
      title: "Saturday 14 November 2026",
      detail: "See each room in the Diary",
      target: { kind: "href", href: "/diary?date=2026-11-14&goto=2026-11-14", newTab: false },
    })]);
    expect(build("05/06/27")[0]?.rows[0]?.key).toBe("date:2027-06-05");
    expect(build("today")[0]?.rows[0]?.key).toBe("date:2026-10-07");
  });

  it("does not take a month or a name for a date", () => {
    for (const words of ["June", "May Henderson", "Grand Hall"]) {
      expect(build(words).some((group) => group.key === "date")).toBe(false);
    }
  });

  it("is offered only to those who open the Diary", () => {
    const places = STAFF_PLACES.filter((place) => place.id !== "diary");
    expect(build("14 nov", { places }).some((group) => group.key === "date")).toBe(false);
  });
});

describe("client findings", () => {
  it("are grouped as the Clients desk groups them, after the pages, with the search row last", () => {
    const groups = build("henderson", { clients: { status: "ready", query: "henderson", results: HENDERSON } });
    expect(groups.map((group) => group.key)).toEqual(["people", "organisations", "deals", "proposals", "layouts", "search"]);
    expect(groups.at(-1)?.rows).toEqual([expect.objectContaining({
      key: "search", title: "Search clients for “henderson”", detail: "See everything found on the Clients desk",
      target: { kind: "href", href: "/dashboard?view=search&q=henderson", newTab: false },
    })]);
  });

  it("open where each already lives: a client on the Clients desk over the results, a deal in the pipeline, a proposal on its desk, a layout in a new tab", () => {
    const rows = rowsOf(build("henderson", { clients: { status: "ready", query: "henderson", results: HENDERSON } }));
    const target = (key: string) => rows.find((row) => row.key === key)?.target;
    expect(target(`contact:${AILSA}`)).toEqual({ kind: "href", href: `/dashboard?view=search&q=henderson&client=contact%3A${AILSA}`, newTab: false });
    expect(target(`account:${ACCOUNT}`)).toEqual({ kind: "href", href: `/dashboard?view=search&q=henderson&client=contact%3A${AILSA}`, newTab: false });
    // An organisation with no contact recorded opens the desk on what was found.
    expect(target(`account:${ORPHAN_ACCOUNT}`)).toEqual({ kind: "href", href: "/dashboard?view=search&q=henderson", newTab: false });
    expect(target(`deal:${DEAL}`)).toEqual({ kind: "href", href: `/dashboard?view=pipeline&opportunity=${DEAL}`, newTab: false });
    expect(target(`proposal:${PROPOSAL}`)).toEqual({ kind: "href", href: `/dashboard?view=proposals&proposal=${PROPOSAL}`, newTab: false });
    expect(target(`layout:${LAYOUT}`)).toEqual({ kind: "href", href: `/plan/${LAYOUT}`, newTab: true });
  });

  it("are read out as the Clients desk reads them", () => {
    const rows = rowsOf(build("henderson", { clients: { status: "ready", query: "henderson", results: HENDERSON } }));
    expect(rows.find((row) => row.key === `deal:${DEAL}`)?.label).toBe("Wedding reception, 5 June, deal, Saturday 5 June 2027, Proposal sent · Ailsa Henderson · 160 guests");
    expect(rows.find((row) => row.key === `layout:${LAYOUT}`)?.label).toContain("opens in a new tab");
  });

  it("show at most five of a kind; the search row opens the rest", () => {
    const many: SearchResults = {
      ...NOTHING,
      contacts: Array.from({ length: 9 }, (_, index) => ({
        id: `00000000-0000-4000-8000-0000000096${String(index).padStart(2, "0")}`, name: `Henderson ${String(index)}`,
        email: `h${String(index)}@example.test`, phone: null, accountName: null,
      })),
    };
    const people = build("henderson", { clients: { status: "ready", query: "henderson", results: many } }).find((group) => group.key === "people");
    expect(people?.rows).toHaveLength(FIND_GROUP_LIMIT);
  });

  it("are never an answer to an earlier query", () => {
    const groups = build("hendersen", { clients: { status: "ready", query: "henderson", results: HENDERSON } });
    expect(groups.map((group) => group.key)).toEqual(["search"]);
  });

  it("keep the search row while the search is on its way, so Enter always goes somewhere", () => {
    const groups = build("henderson", { clients: { status: "loading", query: "henderson" } });
    expect(rowsOf(groups).map((row) => row.key)).toEqual(["search"]);
  });

  it("are not offered to those the client search refuses", () => {
    const groups = build("henderson", { places: SALES_PLACES, clients: null });
    expect(groups).toEqual([]);
    expect(wantsClientSearch("henderson", SALES_PLACES, TODAY)).toBe(false);
  });

  it("are not searched for a date, which the Diary answers and no client is called", () => {
    expect(wantsClientSearch("14 nov", STAFF_PLACES, TODAY)).toBe(false);
    expect(wantsClientSearch("today", STAFF_PLACES, TODAY)).toBe(false);
    expect(build("14 nov").map((group) => group.key)).toEqual(["date"]);
    // A month alone names no date, so a name like "May" is still searched.
    expect(wantsClientSearch("May", STAFF_PLACES, TODAY)).toBe(true);
  });

  it("show a deal's date first, as the Clients desk's tile does", () => {
    const rows = rowsOf(build("henderson", { clients: { status: "ready", query: "henderson", results: HENDERSON } }));
    expect(rows.find((row) => row.key === `deal:${DEAL}`)?.detail).toBe("Sat 5 Jun 2027 · Proposal sent · Ailsa Henderson · 160 guests");
  });

  it("are searched from two characters, as the API asks", () => {
    expect(wantsClientSearch("h", STAFF_PLACES, TODAY)).toBe(false);
    expect(wantsClientSearch("he", STAFF_PLACES, TODAY)).toBe(true);
    expect(build("h").some((group) => group.key === "search")).toBe(false);
  });
});

describe("the board's own findings", () => {
  it("come after a date and before the pages, under the board's own name", () => {
    const groups = build("13 nov", {
      board: { label: "On the board", rows: [{ id: "booking:b1", title: "Chamber dinner", detail: "Grand Hall · 19:00", kind: "Booking" }] },
    });
    expect(groups.map((group) => group.key)).toEqual(["date", "board"]);
    expect(groups[1]?.label).toBe("On the board");
    expect(groups[1]?.rows[0]).toEqual(expect.objectContaining({
      key: "board:booking:b1", title: "Chamber dinner", label: "Chamber dinner, booking, Grand Hall · 19:00",
      target: { kind: "local", id: "booking:b1" },
    }));
  });
});

describe("activeKeyAfter", () => {
  const rows = rowsOf(build("henderson", { clients: { status: "ready", query: "henderson", results: HENDERSON } }));

  it("is the first row until the person moves", () => {
    expect(activeKeyAfter(rows, "search", false)).toBe(`contact:${AILSA}`);
  });

  it("stays on the row the person moved to while more arrive", () => {
    expect(activeKeyAfter(rows, `deal:${DEAL}`, true)).toBe(`deal:${DEAL}`);
  });

  it("falls back to the first row when the one moved to has gone, and to none when nothing is listed", () => {
    expect(activeKeyAfter(rows, "deal:gone", true)).toBe(`contact:${AILSA}`);
    expect(activeKeyAfter([], "search", true)).toBeNull();
  });
});

describe("findScope", () => {
  it("says what this person's Find covers, and nothing it does not", () => {
    expect(findScope(STAFF_PLACES, false)).toBe("Dates, pages, people, organisations, deals, proposals and layouts, by a near spelling too.");
    expect(findScope(HALLKEEPER_PLACES, false)).toBe("Dates, pages, people and layouts, by a near spelling too.");
    expect(findScope(SALES_PLACES, false)).toBe("Dates and pages.");
    expect(findScope(SALES_PLACES, true)).toBe("Dates, pages and what the board has read.");
  });
});
