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
// ---------------------------------------------------------------------------

export interface RouteDocument {
  /** The file the build writes, under route-documents/ in the output. */
  readonly name: string;
  /** The request paths served this document; the first is canonical. */
  readonly paths: readonly [string, ...string[]];
  readonly title: string;
  readonly description: string;
}

export const ROUTE_DOCUMENTS_DIRECTORY = "route-documents";
export const SITE_ORIGIN = "https://venviewer.com";

const LEGAL_OWNER = "The Trades House of Glasgow";

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

/** index.html as one route's document: its title, description, canonical
 *  address and the matching Open Graph tags. Everything else is unchanged. */
export function routeDocumentHtml(indexHtml: string, document: RouteDocument): string {
  const url = `${SITE_ORIGIN}${document.paths[0]}`;
  const title = escapeAttribute(document.title);
  const description = escapeAttribute(document.description);
  let html = replaceOnce(indexHtml, /<title>[^<]*<\/title>/u, `<title>${escapeText(document.title)}</title>`, "<title>");
  html = replaceOnce(html, /<meta name="description" content="[^"]*" \/>/u,
    `<meta name="description" content="${description}" />`, "description");
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*" \/>/u,
    `<link rel="canonical" href="${escapeAttribute(url)}" />`, "canonical link");
  html = replaceOnce(html, /<meta property="og:title" content="[^"]*" \/>/u,
    `<meta property="og:title" content="${title}" />`, "og:title");
  html = replaceOnce(html, /<meta property="og:description" content="[^"]*" \/>/u,
    `<meta property="og:description" content="${description}" />`, "og:description");
  html = replaceOnce(html, /<meta property="og:url" content="[^"]*" \/>/u,
    `<meta property="og:url" content="${escapeAttribute(url)}" />`, "og:url");
  return html;
}
