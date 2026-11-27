// ---------------------------------------------------------------------------
// Titled documents for crawlers that do not run JavaScript (fix-first item
// 19, 16 October 2026).
//
// Every app route is served the same index.html, so a crawler or AI assistant
// that reads only HTML saw "Trades Hall of Glasgow — weddings and events" and
// the front door's canonical address on every page. The build writes a copy of
// index.html for each public page below, with that page's own title,
// description and canonical address (route-documents-plugin.ts), and
// vercel.json serves each path its copy. The app inside is unchanged.
//
// Only pages a person can open without signing in, and that have one fixed
// title, belong here. The route inventory test proves every path here is a
// real route and that vercel.json serves each one its document.
//
// The links venue staff and guests send each other belong here too, one card
// per kind under its router pattern (/proposal-share/:token). Link previews in
// chat and mail read only this HTML, so before these cards a couple's proposal
// unfurled as the front door's wedding card (5 November 2026, from X's note on
// serving link-preview bots what they read). Such a card is unlisted: it says
// what kind of page the link opens and never names the event, the person or
// the token; it has no canonical address, because each link is its own page;
// and it asks not to be indexed, as robots.txt already does for these paths.
// ---------------------------------------------------------------------------

export interface RouteDocument {
  /** The file the build writes, under route-documents/ in the output. */
  readonly name: string;
  /** The request paths served this document; the first is canonical unless the
   *  document is unlisted. Unlisted paths are router patterns (/plan/:code). */
  readonly paths: readonly [string, ...string[]];
  readonly title: string;
  readonly description: string;
  /** One card for many private links: no canonical address or og:url, and noindex. */
  readonly unlisted?: true;
}

export const ROUTE_DOCUMENTS_DIRECTORY = "route-documents";
export const SITE_ORIGIN = "https://venviewer.com";

const LEGAL_OWNER = "The Trades House of Glasgow";
const VENUE = "Trades Hall Glasgow";

export const ROUTE_DOCUMENTS: readonly RouteDocument[] = [
  {
    name: "privacy",
    paths: ["/privacy", "/legal/privacy"],
    title: `Privacy Policy — ${LEGAL_OWNER}`,
    description:
      "How the Trades House of Glasgow handles the personal information you send through this site, why we hold it, how long we keep it, and what you can ask us to do with it.",
  },
  {
    name: "terms",
    paths: ["/terms", "/legal/terms"],
    title: `Terms of Service — ${LEGAL_OWNER}`,
    description:
      "The terms on which you may use this site and the planning tools on it — what the service is, what it is not, and what happens when you send an enquiry.",
  },
  {
    name: "accessibility",
    paths: ["/accessibility", "/legal/accessibility"],
    title: `Accessibility Statement — ${LEGAL_OWNER}`,
    description:
      "What we have done to make this site usable, what we know is still wrong with it, and how to reach a person if something here blocks you.",
  },
  {
    name: "trades-house-leaflet",
    paths: ["/trades-house/leaflet"],
    title: "Visitor leaflet — Trades House Glasgow",
    description: "The Trades House of Glasgow's visitor leaflet.",
  },
  {
    name: "pricing",
    paths: ["/pricing"],
    title: "Venviewer subscriptions — not yet public",
    description:
      "Venviewer subscriptions are not yet public, and nothing can be bought here. To talk about Venviewer for your venue, write to blake@venviewer.com.",
  },
  {
    name: "proposal",
    paths: ["/proposal-share/:token", "/proposal/:shareCode"],
    title: `Your proposal from ${VENUE}`,
    description: `A proposal for your event from the events team at ${VENUE}. Open the link to read it.`,
    unlisted: true,
  },
  {
    name: "supplier-pass",
    paths: ["/supplier-share/:token"],
    title: `Supplier pass — ${VENUE}`,
    description: `The details of an event at ${VENUE} that the events team has shared with a supplier.`,
    unlisted: true,
  },
  {
    name: "plan-view",
    paths: ["/plan-view/:token"],
    title: `View-only plan — ${VENUE}`,
    description: `A view-only plan of an event's room at ${VENUE}, shared by the person planning it.`,
    unlisted: true,
  },
  {
    name: "layout",
    paths: ["/plan/:code"],
    title: `An event layout — ${VENUE}`,
    description: `A room layout made in the ${VENUE} planner. Open the link to see it in 3D.`,
    unlisted: true,
  },
  {
    name: "planner",
    paths: ["/plan"],
    title: `Plan your event — ${VENUE}`,
    description: `Lay out your event in the rooms of ${VENUE} in 3D, then send the plan to the events team.`,
    unlisted: true,
  },
];

/** The document for a route path, if it has one. */
export function routeDocumentFor(path: string): RouteDocument | undefined {
  return ROUTE_DOCUMENTS.find((document) => document.paths.includes(path));
}

/** The published path of a document's file, as vercel.json rewrites to it. */
export function routeDocumentFile(document: RouteDocument): string {
  return `/${ROUTE_DOCUMENTS_DIRECTORY}/${document.name}.html`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

/** Replaces exactly one match, or throws: a build must fail loudly rather
 *  than publish a document that still carries the front door's title. */
function replaceOnce(html: string, pattern: RegExp, replacement: string, what: string): string {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`));
  if (matches === null || matches.length !== 1) {
    throw new Error(`index.html must have exactly one ${what} for the titled route documents; found ${String(matches?.length ?? 0)}`);
  }
  return html.replace(pattern, () => replacement);
}

/** Removes the one line holding a match, or throws as replaceOnce does. */
function removeLineOnce(html: string, pattern: RegExp, what: string): string {
  return replaceOnce(html, new RegExp(`\\r?\\n[ \\t]*${pattern.source}`, pattern.flags), "", what);
}

const CANONICAL_LINK = /<link rel="canonical" href="[^"]*" \/>/u;
const OG_URL = /<meta property="og:url" content="[^"]*" \/>/u;

/** index.html as one route's document: its title, description, canonical
 *  address and the matching Open Graph tags. An unlisted document drops the
 *  canonical address and og:url (a scraper keeps the address it was given) and
 *  adds noindex. Everything else is unchanged. */
export function routeDocumentHtml(indexHtml: string, document: RouteDocument): string {
  const url = `${SITE_ORIGIN}${document.paths[0]}`;
  const title = escapeAttribute(document.title);
  const description = escapeAttribute(document.description);
  const newline = indexHtml.includes("\r\n") ? "\r\n" : "\n";
  const robots = document.unlisted === true ? `${newline}    <meta name="robots" content="noindex, nofollow" />` : "";
  let html = replaceOnce(indexHtml, /<title>[^<]*<\/title>/u, `<title>${escapeText(document.title)}</title>`, "<title>");
  html = replaceOnce(html, /<meta name="description" content="[^"]*" \/>/u,
    `<meta name="description" content="${description}" />${robots}`, "description");
  html = document.unlisted === true
    ? removeLineOnce(html, CANONICAL_LINK, "canonical link")
    : replaceOnce(html, CANONICAL_LINK, `<link rel="canonical" href="${escapeAttribute(url)}" />`, "canonical link");
  html = replaceOnce(html, /<meta property="og:title" content="[^"]*" \/>/u,
    `<meta property="og:title" content="${title}" />`, "og:title");
  html = replaceOnce(html, /<meta property="og:description" content="[^"]*" \/>/u,
    `<meta property="og:description" content="${description}" />`, "og:description");
  html = document.unlisted === true
    ? removeLineOnce(html, OG_URL, "og:url")
    : replaceOnce(html, OG_URL, `<meta property="og:url" content="${escapeAttribute(url)}" />`, "og:url");
  return html;
}
