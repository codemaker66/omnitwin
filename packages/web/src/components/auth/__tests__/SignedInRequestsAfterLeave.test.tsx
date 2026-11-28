import { useEffect, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ActionLogBatch } from "@omnitwin/types";
import { ClerkRouteProvider } from "../ClerkRouteProvider.js";
import { ProtectedRoute } from "../ProtectedRoute.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { api } from "../../../api/client.js";
import { postActionBatch } from "../../../api/action-log.js";
import { _resetTokenGetterForTests, getTokenGetter } from "../../../api/auth-bridge.js";

// ---------------------------------------------------------------------------
// Fresh read web-shell-api-2. The planner sends what is left to save as its
// route goes (EditorBridge's unmount flush), and the action log's flush
// follows that save. Both are built a moment after every cleanup of the
// route change has run. The sign-in bridge used to drop the token getter in
// its own cleanup, so when the next page had no sign-in provider (the venue's
// home page, where the planner's header sends a signed-in client), the last
// save went with no credentials and the API refused it.
//
// Only the sign-in SDK and the network are replaced. The SDK stand-in keeps
// to what the installed source does (@clerk/react 6.11.0 with @clerk/shared
// 4.21.0): one Clerk per browser (`globalThis.Clerk`) holds the live session;
// a provider's unmount only forgets its own wrapper
// (`IsomorphicClerk.clearInstance()`); and useAuth().getToken reads that
// session each time it is called, answering null once nobody is signed in
// (`if (!isomorphicClerk.session) return null`).
// ---------------------------------------------------------------------------

interface Session {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
}

const sdk = vi.hoisted(() => ({
  /** The browser's one Clerk session: null once nobody is signed in. */
  session: null as Session | null,
}));

vi.mock("@clerk/react", () => {
  const getToken = (): Promise<string | null> => Promise.resolve(sdk.session?.token ?? null);
  return {
    ClerkProvider: ({ children }: { readonly children: ReactNode }): ReactNode => children,
    useUser: () => sdk.session === null
      ? { isLoaded: true, isSignedIn: false, user: null }
      : { isLoaded: true, isSignedIn: true, user: { id: sdk.session.userId,
        primaryEmailAddress: { emailAddress: sdk.session.email, verification: { status: "verified" } } } },
    useAuth: () => ({ getToken }),
    useClerk: () => ({ status: "ready", signOut: () => Promise.resolve(), openUserProfile: () => undefined }),
  };
});

const ELAINE: Session = { userId: "clerk_elaine", email: "elaine@example.test", token: "token-for-elaine" };
const FINLAY: Session = { userId: "clerk_finlay", email: "finlay@example.test", token: "token-for-finlay" };
const PEOPLE = [ELAINE, FINLAY];

const CONFIG = "00000000-0000-4000-8000-000000000001";
const BATCH: ActionLogBatch = {
  batchId: "0d4d0b6e-3a63-4a5d-9c1e-2f6b8a7c5d4e",
  revision: 3,
  actions: [{
    id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    actor: { kind: "operator" },
    intent: "object.place",
    payload: { label: "Place" },
    inverse: { removed: [] },
    provenance: { surface: "planner" },
    ts: "2026-07-18T10:00:00.000Z",
  }],
};

interface Sent { readonly path: string; readonly authorization: string | null }
const sent: Sent[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The API, as far as these requests go: it answers whoever the token names. */
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const authorization = new Headers(init?.headers).get("Authorization");
  sent.push({ path: url.pathname, authorization });
  const person = PEOPLE.find((candidate) => authorization === `Bearer ${candidate.token}`);
  if (person === undefined) return Promise.resolve(json(401, { error: "Authentication required", code: "UNAUTHORIZED" }));
  if (url.pathname === "/auth/me") {
    return Promise.resolve(json(200, { data: { id: `db-${person.userId}`, email: person.email, name: "Planner",
      role: "planner", platformRole: "none", venueId: "trades-hall" } }));
  }
  if (url.pathname.endsWith("/actions")) return Promise.resolve(json(200, { data: { accepted: 1, duplicates: 0 } }));
  return Promise.resolve(json(200, { data: { saved: true } }));
});

/** What the planner sends as its route goes, made as EditorBridge's flush
 *  makes it: after a save in flight has settled, so after every cleanup of
 *  the same commit; then the action log's flush, which follows the save. */
const leaving: Promise<void>[] = [];
function SavesAsItLeaves(): ReactElement {
  useEffect(() => () => {
    leaving.push((async () => {
      await Promise.resolve();
      await api.post(`/configurations/${CONFIG}/objects/batch`, { objects: [] }).catch(() => undefined);
      await postActionBatch(CONFIG, BATCH).catch(() => undefined);
    })());
  }, []);
  return <p>Planner</p>;
}

function SignedInPage({ children }: { readonly children: ReactElement }): ReactElement {
  return <MemoryRouter><ClerkRouteProvider><ProtectedRoute>{children}</ProtectedRoute></ClerkRouteProvider></MemoryRouter>;
}

/** The venue's home page: no sign-in provider at all. */
function VenueHome(): ReactElement {
  return <p>Venue home</p>;
}

beforeEach(() => {
  sent.length = 0;
  leaving.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  _resetTokenGetterForTests();
  // As a page opens: nothing known yet.
  useAuthStore.setState(useAuthStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sdk.session = null;
});

describe("requests made as a signed-in page goes", () => {
  it("sends the planner's last save, and the action log after it, with the person's credentials when the next page has no sign-in", async () => {
    sdk.session = ELAINE;
    const view = render(<SignedInPage><SavesAsItLeaves /></SignedInPage>);
    await screen.findByText("Planner");
    sent.length = 0;

    view.rerender(<VenueHome />);
    await act(async () => { await Promise.all(leaving); });

    expect(sent).toEqual([
      { path: `/configurations/${CONFIG}/objects/batch`, authorization: "Bearer token-for-elaine" },
      { path: `/configurations/${CONFIG}/actions`, authorization: "Bearer token-for-elaine" },
    ]);
  });

  it("follows a sign-out made after the bridge has gone, and never sends the earlier person's token for the next", async () => {
    sdk.session = ELAINE;
    const view = render(<SignedInPage><p>Diary</p></SignedInPage>);
    await screen.findByText("Diary");
    view.rerender(<VenueHome />);

    // Elaine signs out in another tab; this page has no bridge to hear it.
    sdk.session = null;
    sent.length = 0;
    await api.get(`/configurations/${CONFIG}`).catch(() => undefined);
    expect(sent).toEqual([{ path: `/configurations/${CONFIG}`, authorization: null }]);

    // Finlay signs in on a page with the provider, then leaves it for one without.
    sdk.session = FINLAY;
    view.rerender(<SignedInPage><p>Diary</p></SignedInPage>);
    await screen.findByText("Diary");
    await waitFor(() => { expect(useAuthStore.getState().user?.email).toBe("finlay@example.test"); });
    view.rerender(<VenueHome />);
    await api.get(`/configurations/${CONFIG}`).catch(() => undefined);

    const after = sent.slice(1);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((request) => request.authorization === "Bearer token-for-finlay")).toBe(true);
  });

  it("still lets go of the getter when a mounted bridge sees the person sign out", async () => {
    sdk.session = ELAINE;
    const view = render(<SignedInPage><p>Diary</p></SignedInPage>);
    await screen.findByText("Diary");
    expect(getTokenGetter()).not.toBeNull();

    sdk.session = null;
    view.rerender(<SignedInPage><p>Diary</p></SignedInPage>);
    await waitFor(() => { expect(getTokenGetter()).toBeNull(); });
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, accessStatus: "signed_out" });
  });
});
