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
  /** The Clerk session that owns private browser-memory resources. */
  readonly authSessionId: string | null;
  /** Monotonic browser-session/authoritative-claims generation for private resources. */
  readonly authContextRevision: number;
}

interface AuthActions {
  /**
   * Clerk callers must pass their current session ID. Sessionless callers are
   * treated conservatively as a new auth context on every update.
   */
  readonly setUser: (user: AuthUser | null, authSessionId?: string | null) => void;
  readonly setLoading: (isLoading: boolean) => void;
  readonly logout: () => void;
  readonly clearError: () => void;
}

type AuthStore = AuthState & AuthActions;

function samePrivateResourceClaims(left: AuthUser | null, right: AuthUser | null): boolean {
  return left?.id === right?.id &&
    left?.venueId === right?.venueId &&
    left?.role === right?.role &&
    left?.platformRole === right?.platformRole;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  authSessionId: null,
  authContextRevision: 0,

  setUser: (user, authSessionId) => {
    set((state) => {
      const nextSessionId = authSessionId ?? null;
      const authContextChanged = authSessionId === undefined ||
        state.authSessionId !== nextSessionId ||
        !samePrivateResourceClaims(state.user, user);
      return {
        user,
        isAuthenticated: user !== null,
        isLoading: false,
        authSessionId: nextSessionId,
        authContextRevision: state.authContextRevision + (authContextChanged ? 1 : 0),
      };
    });
  },

  setLoading: (isLoading) => { set({ isLoading }); },

  logout: () => {
    set((state) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      authSessionId: null,
      authContextRevision: state.authContextRevision + 1,
    }));
  },

  clearError: () => { set({ error: null }); },
}));
