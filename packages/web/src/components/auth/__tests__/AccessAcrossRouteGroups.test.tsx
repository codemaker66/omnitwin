import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { ClerkRouteProvider } from "../ClerkRouteProvider.js";
import { ProtectedRoute } from "../ProtectedRoute.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { _resetTokenGetterForTests, getTokenGetter } from "../../../api/auth-bridge.js";

// ---------------------------------------------------------------------------
// Fresh read web-shell-api-6. Each route group mounts a sign-in provider of
// its own (router.tsx: a page's withClerk, the staff pages' parent route, the
// planner's boundary), so a move between groups mounts a new bridge. It used
// to throw away the person it had already confirmed: the page gave way to
// "Checking access..." and waited for /auth/me again on every crossing.
//
// The confirmed person now stays while the sign-in identity is the same, and
// the bridge asks /auth/me again behind the page. Every other way out ends
// where a first check ends: an identity that changed is checked from scratch,
// and a re-check refused (401, 403) or lost on the network ends exactly as a
// first check meeting the same answer does. Only the sign-in SDK and the
// network are replaced; the providers, guards and store are the real ones.
// ---------------------------------------------------------------------------

interface Person {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly token: string;
}

const sdk = vi.hoisted(() => ({
  /** The browser's one sign-in session: null once nobody is signed in. */
  session: null as { readonly userId: string; readonly email: string; readonly name: string; readonly token: string } | null,
  listeners: new Set<() => void>(),
}));

vi.mock("@clerk/react", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void): (() => void) => {
    sdk.listeners.add(listener);
    return () => { sdk.listeners.delete(listener); };
  };
  const getToken = (): Promise<string | null> => Promise.resolve(sdk.session?.token ?? null);
  return {
    ClerkProvider: ({ children }: { readonly children: ReactNode }): ReactNode => children,
    useUser: () => {
      const session = useSyncExternalStore(subscribe, () => sdk.session);
      return session === null
        ? { isLoaded: true, isSignedIn: false, user: null }
        : { isLoaded: true, isSignedIn: true, user: { id: session.userId,
          primaryEmailAddress: { emailAddress: session.email, verification: { status: "verified" } } } };
    },
    useAuth: () => ({ getToken }),
    useClerk: () => ({ status: "ready", signOut: () => Promise.resolve(), openUserProfile: () => undefined }),
  };
});

/** The browser's session changes: here, or in another tab of the same browser. */
function signIn(person: Person | null): void {
  act(() => {
    sdk.session = person;
    for (const listener of [...sdk.listeners]) listener();
  });
}

const ELAINE: Person = { userId: "clerk_elaine", email: "elaine@example.test", name: "Elaine", token: "token-for-elaine" };
const FINLAY: Person = { userId: "clerk_finlay", email: "finlay@example.test", name: "Finlay", token: "token-for-finlay" };
const PEOPLE = [ELAINE, FINLAY];

type Answer = (person: Person | undefined) => Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The API as far as /auth/me goes: it answers whoever the token names, with
 *  the role the server holds for them now. */
const server = {
  roles: new Map<string, string>(),
  /** Answers that replace the usual one, taken in order. */
  answers: [] as Answer[],
  /** Who asked /auth/me, in order. */
  asked: [] as (string | null)[],
};

function usualAnswer(person: Person | undefined): Promise<Response> {
  if (person === undefined) return Promise.resolve(json(401, { error: "Authentication required", code: "UNAUTHORIZED" }));
  return Promise.resolve(json(200, { data: { id: `db-${person.userId}`, email: person.email, name: person.name,
    role: server.roles.get(person.userId) ?? "hallkeeper", platformRole: "none", venueId: "trades-hall" } }));
}

const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const authorization = new Headers(init?.headers).get("Authorization");
  const person = PEOPLE.find((candidate) => authorization === `Bearer ${candidate.token}`);
  if (url.pathname !== "/auth/me") return Promise.resolve(json(200, { data: {} }));
  server.asked.push(person?.email ?? null);
  return (server.answers.shift() ?? usualAnswer)(person);
});

const refused401: Answer = () => Promise.resolve(json(401, { error: "Invalid or expired token", code: "UNAUTHORIZED" }));
const invitationRequired: Answer = () => Promise.resolve(json(403, { error: "Invitation required", code: "INVITATION_REQUIRED" }));
const emailUnverified: Answer = () => Promise.resolve(json(403, { error: "Verify your email", code: "EMAIL_UNVERIFIED" }));
const networkLost: Answer = () => Promise.reject(new TypeError("Failed to fetch"));

/** The next /auth/me waits; release() lets the server give `answer`. */
function holdNextCheck(answer: Answer = usualAnswer): { readonly release: () => Promise<void> } {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  server.answers.push((person) => gate.then(() => answer(person)));
  return {
    release: async () => {
      await act(async () => {
        open();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
      });
    },
  };
}

/** Pass-through wrappers standing for router.tsx's own (PreloadRouteCode,
 *  PreloadStaffRoute): different parents, so each group's provider is its own
 *  and a move between groups mounts a new one, as in the application. */
function PageOfItsOwn({ children }: { readonly children: ReactElement }): ReactElement {
  return children;
}
function StaffPages({ children }: { readonly children: ReactElement }): ReactElement {
  return children;
}

const STAFF_ROLES = ["hallkeeper", "admin"] as const;

function open(path: string): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter([
    { path: "/", element: <p>Venue home</p> },
    { path: "/login", element: <p>Sign in</p> },
    {
      path: "/hallkeeper/:configId",
      element: (
        <PageOfItsOwn>
          <ClerkRouteProvider><ProtectedRoute allowedRoles={STAFF_ROLES}><p>Setup sheet</p></ProtectedRoute></ClerkRouteProvider>
        </PageOfItsOwn>
      ),
    },
    {
      element: <StaffPages><ClerkRouteProvider><Outlet /></ClerkRouteProvider></StaffPages>,
      children: [{ path: "/dashboard", element: <ProtectedRoute allowedRoles={STAFF_ROLES}><p>Dashboard</p></ProtectedRoute> }],
    },
  ], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

async function go(router: ReturnType<typeof createMemoryRouter>, path: string): Promise<void> {
  await act(async () => { await router.navigate(path); });
}

const CHECKING = /Checking access/u;

/** Elaine, confirmed on the dashboard: where every crossing below starts. */
async function confirmedOnDashboard(): Promise<ReturnType<typeof createMemoryRouter>> {
  signIn(ELAINE);
  const router = open("/dashboard");
  expect(await screen.findByText("Dashboard")).toBeTruthy();
  return router;
}

interface Ending {
  readonly heading: string | null;
  readonly page: boolean;
  readonly user: unknown;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly accessStatus: string;
}

function ending(): Ending {
  const { user, isAuthenticated, isLoading, error, accessStatus } = useAuthStore.getState();
  return {
    heading: screen.queryByRole("heading", { level: 1 })?.textContent ?? null,
    page: screen.queryByText("Setup sheet") !== null,
    user, isAuthenticated, isLoading, error, accessStatus,
  };
}

function freshPage(): void {
  cleanup();
  server.answers.length = 0;
  server.asked.length = 0;
  _resetTokenGetterForTests();
  useAuthStore.setState(useAuthStore.getInitialState(), true);
}

/** Where a first check of the setup sheet ends when /auth/me gives `answer`:
 *  the path every crossing took before. */
async function firstCheckEnding(answer: Answer): Promise<Ending> {
  signIn(ELAINE);
  server.answers.push(answer);
  open("/hallkeeper/sheet-1");
  await waitFor(() => { expect(useAuthStore.getState().isLoading).toBe(false); });
  const end = ending();
  freshPage();
  return end;
}

beforeEach(() => {
  server.roles.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  freshPage();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sdk.session = null;
  sdk.listeners.clear();
});

describe("a confirmed person moving between route groups", () => {
  it("keeps the page through the move and asks /auth/me again behind it", async () => {
    signIn(ELAINE);
    const first = holdNextCheck();
    const router = open("/dashboard");
    // The first check of the session waits for the API, as it always has.
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText("Dashboard")).toBeNull();
    await first.release();
    expect(await screen.findByText("Dashboard")).toBeTruthy();

    const behind = holdNextCheck();
    await go(router, "/hallkeeper/sheet-1");
    expect(screen.getByText("Setup sheet")).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(server.asked).toEqual([ELAINE.email, ELAINE.email]);
    await behind.release();
    expect(screen.getByText("Setup sheet")).toBeTruthy();
    expect(useAuthStore.getState()).toMatchObject({ accessStatus: "ready", isAuthenticated: true, user: { email: ELAINE.email } });

    await go(router, "/dashboard");
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    await waitFor(() => { expect(server.asked).toEqual([ELAINE.email, ELAINE.email, ELAINE.email]); });
  });

  it("applies a role changed on the server once the check behind the page answers", async () => {
    const router = await confirmedOnDashboard();
    server.roles.set(ELAINE.userId, "planner");
    const behind = holdNextCheck();
    await go(router, "/hallkeeper/sheet-1");
    // Until the answer comes, the page is the one her old role was given;
    // each request it makes is still decided by the API on its own.
    expect(screen.getByText("Setup sheet")).toBeTruthy();

    await behind.release();
    expect(await screen.findByRole("heading", { name: "Access needed" })).toBeTruthy();
    expect(screen.queryByText("Setup sheet")).toBeNull();
    expect(useAuthStore.getState().user?.role).toBe("planner");
  });

  it.each([
    ["is refused 401", refused401],
    ["is refused 403 for want of an invitation", invitationRequired],
    ["is refused 403 for an unverified email", emailUnverified],
    ["fails on the network", networkLost],
  ] as const)("a check behind the page that %s ends where a first check meeting the same answer ends", async (_how, answer) => {
    const expected = await firstCheckEnding(answer);
    expect(expected.page).toBe(false);
    expect(expected.isAuthenticated).toBe(false);

    const router = await confirmedOnDashboard();
    const behind = holdNextCheck(answer);
    await go(router, "/hallkeeper/sheet-1");
    expect(screen.getByText("Setup sheet")).toBeTruthy();
    await behind.release();
    await waitFor(() => { expect(ending()).toEqual(expected); });
  });

  it("checks a different person from scratch, never showing the one confirmed before", async () => {
    const router = await confirmedOnDashboard();
    // A page with no sign-in code: no bridge hears what follows.
    await go(router, "/");
    // In another tab, Elaine signs out and Finlay signs in.
    signIn(null);
    signIn(FINLAY);

    const check = holdNextCheck();
    await go(router, "/hallkeeper/sheet-1");
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText("Setup sheet")).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, accessStatus: "checking" });

    await check.release();
    expect(await screen.findByText("Setup sheet")).toBeTruthy();
    expect(useAuthStore.getState().user?.email).toBe(FINLAY.email);
    expect(server.asked).toEqual([ELAINE.email, FINLAY.email]);
  });

  it("ends signed out when the person signs out, and drops the check still behind the page", async () => {
    const router = await confirmedOnDashboard();
    const behind = holdNextCheck();
    await go(router, "/hallkeeper/sheet-1");
    expect(screen.getByText("Setup sheet")).toBeTruthy();

    signIn(null);
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, accessStatus: "signed_out" });
    expect(getTokenGetter()).toBeNull();

    // Elaine's answer, arriving after she has gone, changes nothing.
    await behind.release();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, accessStatus: "signed_out" });
    expect(screen.getByText("Sign in")).toBeTruthy();
  });
});
