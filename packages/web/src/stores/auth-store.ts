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
}

interface AuthActions {
  readonly beginAccessCheck: (email: string) => void;
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

  beginAccessCheck: (email) => {
    set({ user: null, isAuthenticated: false, isLoading: true, error: null,
      accessStatus: "checking", accessEmail: email });
  },

  failAccessCheck: (message, pending) => {
    set({ user: null, isAuthenticated: false, isLoading: false, error: message,
      accessStatus: pending ? "pending" : "error" });
  },

  retryAccess: () => {
    set((state) => ({ accessRetry: state.accessRetry + 1 }));
  },

  setUser: (user) => {
    set({
      user,
      isAuthenticated: user !== null,
      isLoading: false,
      error: null,
      accessStatus: user === null ? "signed_out" : "ready",
      accessEmail: user?.email ?? null,
    });
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
    });
  },

  clearError: () => { set({ error: null }); },
}));
