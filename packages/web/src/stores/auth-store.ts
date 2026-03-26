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
  readonly venueId: string | null;
  readonly name: string;
}

interface AuthState {
  readonly user: AuthUser | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
}

interface AuthActions {
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

  setUser: (user) => {
    set({
      user,
      isAuthenticated: user !== null,
      isLoading: false,
    });
  },

  setLoading: (isLoading) => { set({ isLoading }); },

  logout: () => {
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  },

  clearError: () => { set({ error: null }); },
}));
