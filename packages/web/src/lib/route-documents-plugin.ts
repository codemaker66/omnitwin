import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import {
  ROUTE_DOCUMENTS,
  ROUTE_DOCUMENTS_DIRECTORY,
  routeDocumentHtml,
  type RouteDocument,
} from "./route-documents.js";

// ---------------------------------------------------------------------------
// Writes one titled copy of the built index.html per public page
// (route-documents.ts), so crawlers that do not run JavaScript read each
// page's own title. Build only: development serves index.html as it is.
// ---------------------------------------------------------------------------

/** Writes every route document beside the build and returns their paths. */
export async function writeRouteDocuments(
  outDir: string,
  indexHtml: string,
  documents: readonly RouteDocument[] = ROUTE_DOCUMENTS,
): Promise<string[]> {
  const directory = join(outDir, ROUTE_DOCUMENTS_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const document of documents) {
    const file = join(directory, `${document.name}.html`);
    await writeFile(file, routeDocumentHtml(indexHtml, document), "utf8");
    written.push(file);
  }
  return written;
}

export function routeDocumentsPlugin(): Plugin {
  return {
    name: "venviewer-route-documents",
    apply: "build",
    async writeBundle(options, bundle) {
      const index = bundle["index.html"];
      if (index?.type !== "asset") throw new Error("The build produced no index.html to title the route documents from");
      const html = typeof index.source === "string" ? index.source : new TextDecoder().decode(index.source);
      if (options.dir === undefined) throw new Error("The route documents need the build's output directory");
      await writeRouteDocuments(options.dir, html);
    },
  };
}
