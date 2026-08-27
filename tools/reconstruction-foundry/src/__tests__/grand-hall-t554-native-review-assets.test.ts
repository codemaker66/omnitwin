import { Script } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_NATIVE_REVIEW_API_CONTRACT,
  GRAND_HALL_T554_NATIVE_REVIEW_ASSETS,
  GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT,
  GRAND_HALL_T554_NATIVE_REVIEW_HTML,
  GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS,
  GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET,
  GRAND_HALL_T554_RAW_RGB8_TILE_BYTE_LENGTH,
  assertGrandHallT554RawRgb8TileLength,
} from "../grand-hall-t554-native-review-assets.js";

describe("Grand Hall T-554 native-review static assets", () => {
  it("ships only fixed same-origin HTML, stylesheet, and external script assets", () => {
    expect(GRAND_HALL_T554_NATIVE_REVIEW_ASSETS).toHaveLength(3);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_ASSETS.map((asset) => asset.route)).toEqual([
      GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.document,
      GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.stylesheet,
      GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.script,
    ]);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).toContain(
      `href="${GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.stylesheet}"`,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).toContain(
      `src="${GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS.script}"`,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).not.toMatch(/<style\b/iu);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).not.toMatch(
      /<script(?![^>]*\bsrc=)[^>]*>/iu,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).not.toMatch(
      /\s(?:style|on[a-z]+)=/iu,
    );
    expect(() => new Script(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT)).not.toThrow();
  });

  it("is compatible with the no-inline, no-external, no-worker local CSP", () => {
    const allAssets = [
      GRAND_HALL_T554_NATIVE_REVIEW_HTML,
      GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET,
      GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT,
    ].join("\n");
    expect(allAssets).not.toMatch(/https?:\/\//iu);
    expect(allAssets).not.toMatch(/(?:src|href)=["']\/\//iu);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).not.toMatch(
      /\b(?:Worker|SharedWorker|WebSocket|EventSource|eval|Function)\s*\(/u,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).not.toContain(
      "serviceWorker",
    );
  });

  it("never persists credentials, puts them in queries or DOM, or exposes a final gate", () => {
    const client = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT;
    const allAssets = [
      GRAND_HALL_T554_NATIVE_REVIEW_HTML,
      GRAND_HALL_T554_NATIVE_REVIEW_STYLESHEET,
      client,
    ].join("\n");
    expect(client).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/iu);
    expect(client).not.toMatch(/URLSearchParams|[?&](?:token|bootstrap|bearer)=/iu);
    expect(client).not.toMatch(/setAttribute\([^)]*(?:bearer|bootstrap|token)/iu);
    expect(allAssets).not.toMatch(/accept/iu);
  });

  it("clears the one-time fragment before exchanging it as strict JSON", () => {
    const client = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT;
    const fragmentRead = client.indexOf("window.location.hash");
    const fragmentClear = client.indexOf("window.history.replaceState");
    const bootstrapFetch = client.indexOf("fetch(routes.bootstrap");
    expect(fragmentRead).toBeGreaterThan(-1);
    expect(fragmentClear).toBeGreaterThan(fragmentRead);
    expect(bootstrapFetch).toBeGreaterThan(fragmentClear);
    expect(client).toContain('method: "POST"');
    expect(client).toContain('"Content-Type": "application/json"');
    expect(client).toContain("JSON.stringify({");
    expect(client).toContain("bootstrap: bootstrapSecret");
  });

  it("routes every post-bootstrap API request through the closure-held bearer", () => {
    const client = GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT;
    expect(client.match(/\bfetch\(/gu)).toHaveLength(2);
    expect(client).toContain("fetch(routes.bootstrap");
    expect(client).toContain("fetch(path");
    expect(client).toContain('Authorization: "Bearer " + bearer');
    expect(client).toContain("if (bearer === null || !apiPaths.has(path))");
  });

  it("uses one fixed API route table consistently and no arbitrary path field", () => {
    const routeValues = Object.values(GRAND_HALL_T554_NATIVE_REVIEW_ROUTE_PATHS);
    expect(new Set(routeValues).size).toBe(routeValues.length);
    for (const route of routeValues) {
      expect(route).toMatch(/^\/(?:$|[a-z0-9./-]+$)/u);
      expect(route).not.toMatch(/[?#*{}:]/u);
    }
    for (const contract of Object.values(GRAND_HALL_T554_NATIVE_REVIEW_API_CONTRACT)) {
      expect(routeValues).toContain(contract.path);
      expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).toContain(
        JSON.stringify(contract.path),
      );
      for (const field of contract.requestFields) {
        expect(field).not.toMatch(/path|file|uri|url|hash|digest|byte|count|bitmap/iu);
      }
    }
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).not.toContain(
      "subjectSha256",
    );
  });

  it("guards exact RGB8 tile length and paints without smoothing at integer offsets", () => {
    expect(GRAND_HALL_T554_RAW_RGB8_TILE_BYTE_LENGTH).toBe(256 * 256 * 3);
    expect(() => {
      assertGrandHallT554RawRgb8TileLength(
        GRAND_HALL_T554_RAW_RGB8_TILE_BYTE_LENGTH,
      );
    }).not.toThrow();
    expect(() => {
      assertGrandHallT554RawRgb8TileLength(
        GRAND_HALL_T554_RAW_RGB8_TILE_BYTE_LENGTH - 1,
      );
    }).toThrow(/RGB8 tile byte length/iu);
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).toContain(
      "context.imageSmoothingEnabled = false",
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).toContain(
      "if (raw.byteLength !== rawTileByteLength)",
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).toContain(
      "context.putImageData(imageData, column * tileWidth, row * tileHeight)",
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).not.toMatch(
      /(?:column|row)\s*%/u,
    );
  });

  it("renders the fixed 148-source evidence workflow without authority controls", () => {
    expect(GRAND_HALL_T554_NATIVE_REVIEW_BROWSER_JAVASCRIPT).toContain(
      "if (nextState.sources.length !== 148)",
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).toContain("INCLUDE");
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).toContain("EXCLUDE");
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).toContain("UNSURE");
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).toMatch(
      /adjacent rooms, facade imagery, invented content, generated fill/iu,
    );
    expect(GRAND_HALL_T554_NATIVE_REVIEW_HTML).toContain("Authority: none");
  });
});
