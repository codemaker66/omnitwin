import { create } from "zustand";

// ---------------------------------------------------------------------------
// Auth store — Clerk compatibility shim
// Provides the same interface as the old JWT auth store so existing code
// (dashboard, protected routes, API client) continues to work. State is
// populated from Clerk hooks via the ClerkAuthBridge component.
// ---------------------------------------------------------------------------

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly platformRole: "none" | "operator" | "admin";
  readonly venueId: string | null;
  readonly name: string;
}

interface AuthState {
  readonly user: AuthUser | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly accessStatus: "signed_out" | "checking" | "ready" | "pending" | "error";
  readonly accessEmail: string | null;
  readonly accessRetry: number;
  /** The sign-in identity (the provider's user id) that `user`, or the access
   *  check under way, belongs to; null when none was given. */
  readonly accessIdentity: string | null;
}

interface AuthActions {
  /**
   * Start an access check for the signed-in identity. A person the API has
   * already confirmed for this same identity stays (the sign-in provider is
   * mounted again on each move between route groups) while the check runs
   * behind the page; its answer then replaces them, or refuses them, exactly
   * as a first check's would. Any other identity, or none given, starts from
   * nobody.
   */
  readonly beginAccessCheck: (email: string, identity?: string | null) => void;
  readonly failAccessCheck: (message: string, pending: boolean) => void;
  readonly retryAccess: () => void;
  readonly setUser: (user: AuthUser | null) => void;
  readonly setLoading: (isLoading: boolean) => void;
  readonly logout: () => void;
  readonly clearError: () => void;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  accessStatus: "signed_out",
  accessEmail: null,
  accessRetry: 0,
  accessIdentity: null,

  beginAccessCheck: (email, identity = null) => {
    set((state) => {
      const confirmedForThisIdentity = identity !== null && state.accessIdentity === identity
        && state.accessStatus === "ready" && state.user !== null;
      if (confirmedForThisIdentity) return state;
      return { user: null, isAuthenticated: false, isLoading: true, error: null,
        accessStatus: "checking", accessEmail: email, accessIdentity: identity };
    });
  },

  failAccessCheck: (message, pending) => {
    set({ user: null, isAuthenticated: false, isLoading: false, error: message,
      accessStatus: pending ? "pending" : "error" });
  },

  retryAccess: () => {
    set((state) => ({ accessRetry: state.accessRetry + 1 }));
  },

  setUser: (user) => {
    set((state) => ({
      user,
      isAuthenticated: user !== null,
      isLoading: false,
      error: null,
      accessStatus: user === null ? "signed_out" : "ready",
      accessEmail: user?.email ?? null,
      // The API's answer for the identity whose check began it.
      accessIdentity: user === null ? null : state.accessIdentity,
    }));
  },

  setLoading: (isLoading) => { set({ isLoading }); },

  logout: () => {
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      accessStatus: "signed_out",
      accessEmail: null,
      accessIdentity: null,
    });
  },

  clearError: () => { set({ error: null }); },
}));
