import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { describePaperClaim, parseSheetPaperLink } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The sheet check's offline answer (public/sheet-check-sw.js), run as written
// against a stand-in worker global: it must answer a sheet-check navigation
// that cannot reach the network with the paper's own version, in the same
// words as the page, and must leave every other request alone.
// ---------------------------------------------------------------------------

interface FakeRequest { readonly mode: string; readonly url: string }
interface FakeFetchEvent {
  readonly request: FakeRequest;
  respondWith(response: Promise<Response>): void;
}
type FetchListener = (event: FakeFetchEvent) => void;

const ORIGIN = "https://venviewer.com";
const SNAPSHOT = "5b8f2c1e-3d4a-4f6b-9c7d-1e2f3a4b5c6d";
const CONFIG = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

let onFetch: FetchListener | undefined;
const network = vi.fn<(request: FakeRequest) => Promise<Response>>();

beforeAll(async () => {
  const source = await readFile(resolve("public/sheet-check-sw.js"), "utf8");
  const worker = {
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
    addEventListener(type: string, listener: unknown): void {
      if (type === "fetch") onFetch = listener as FetchListener;
    },
  };
  // The worker script uses only these globals.
  runInNewContext(source, { self: worker, fetch: network, Response, URL });
});

function navigate(path: string, mode = "navigate"): Promise<Response> | undefined {
  let answered: Promise<Response> | undefined;
  if (onFetch === undefined) throw new Error("The worker registered no fetch listener");
  onFetch({ request: { mode, url: `${ORIGIN}${path}` }, respondWith: (response) => { answered = response; } });
  return answered;
}

async function offlineText(path: string): Promise<string> {
  network.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const response = await navigate(path);
  if (response === undefined) throw new Error("The worker did not answer");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  return response.text();
}

describe("the sheet check's offline answer", () => {
  it("says it cannot check and repeats the paper's own version and printed minute", async () => {
    const path = `/sheet-check?s=${SNAPSHOT}&v=7&h=0123456789abcdef&p=2026-10-17T06:02`;
    const html = await offlineText(path);
    expect(html).toContain("Can't check: no signal.");
    expect(html).toContain("Your copy is v7, printed 17 Oct 06:02.");
    expect(html).toContain("ask the duty manager");
    // Same words as the page uses (packages/types describePaperClaim).
    const link = parseSheetPaperLink(new URL(`${ORIGIN}${path}`).searchParams);
    expect(link).not.toBeNull();
    if (link !== null) expect(html).toContain(describePaperClaim(link.claim));
  });

  it("calls a draft printout a draft", async () => {
    const html = await offlineText(`/sheet-check?c=${CONFIG}&p=2026-10-17T06:02`);
    expect(html).toContain("Your copy is a draft, printed 17 Oct 06:02.");
  });

  it("never echoes markup from a link", async () => {
    const html = await offlineText(`/sheet-check?s=${SNAPSHOT}&v=7&h=0123456789abcdef&p=%3Cscript%3Ealert(1)%3C/script%3E`);
    expect(html).toContain("Your copy is v7.");
    expect(html).not.toContain("alert(1)");
    const forged = await offlineText(`/sheet-check?s=${SNAPSHOT}&v=7%3Cb%3E&h=0123456789abcdef`);
    expect(forged).toContain("This link is not a sheet check.");
    expect(forged).not.toContain("<b>");
  });

  it("passes the real page through whenever the network answers", async () => {
    const page = new Response("live page");
    network.mockResolvedValueOnce(page);
    expect(await navigate(`/sheet-check?c=${CONFIG}`)).toBe(page);
  });

  it("leaves everything outside the sheet check alone", () => {
    expect(navigate("/hallkeeper/today")).toBeUndefined();
    expect(navigate("/sheet-check?c=x", "cors")).toBeUndefined();
  });
});
