import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Where "Sign In to Save" leaves the person (audit web-auth-routing-2).
//
// Clerk's <SignIn> navigates once the person has signed in, and with no
// address given it goes to the site's front page ("/"; Clerk's documented
// default for fallbackRedirectUrl). The dialog is on a plan, so it names that
// plan's own address; the page then makes the plan theirs
// (hooks/use-planner-draft-claim.ts).
// ---------------------------------------------------------------------------

const signIn = vi.hoisted(() => vi.fn());
vi.mock("@clerk/react", () => ({
  SignIn: (props: Record<string, unknown>) => {
    signIn(props);
    return <div>Secure sign in</div>;
  },
}));
vi.mock("../../../api/configurations.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/configurations.js")>(),
  claimConfig: vi.fn(),
}));

const { AuthModal } = await import("../AuthModal.js");
const { useAuthStore } = await import("../../../stores/auth-store.js");

function addressGivenToClerk(): unknown {
  const props = signIn.mock.calls.at(-1)?.[0] as { fallbackRedirectUrl?: unknown } | undefined;
  return props?.fallbackRedirectUrl;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().setUser(null);
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("the sign-in dialog on a plan", () => {
  it("sends the person back to the plan they were saving, with its options, once they have signed in", () => {
    // Clerk's own steps live in the fragment; the plan's address does not include it.
    window.history.pushState({}, "", "/plan/draft-1?chrome=v2#/factor-one");
    render(<AuthModal onClose={vi.fn()} />);

    expect(screen.getByText("Secure sign in")).toBeDefined();
    expect(addressGivenToClerk()).toBe("/plan/draft-1?chrome=v2");
  });

  it("names the planner when the address it is on is not one to come back to", () => {
    window.history.pushState({}, "", "/login?returnTo=%2Fplan");
    render(<AuthModal onClose={vi.fn()} />);

    expect(addressGivenToClerk()).toBe("/plan");
  });
});
