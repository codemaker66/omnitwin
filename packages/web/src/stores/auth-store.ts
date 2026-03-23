import { create } from "zustand";
import type { AuthUser } from "../api/auth.js";
import * as authApi from "../api/auth.js";

// ---------------------------------------------------------------------------
// Auth store — manages JWT tokens, user session, localStorage persistence
// ---------------------------------------------------------------------------

interface AuthState {
  readonly user: AuthUser | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
}

interface AuthActions {
  readonly login: (email: string, password: string) => Promise<void>;
  readonly register: (email: string, password: string, name: string, role?: string) => Promise<void>;
  readonly logout: () => void;
  readonly refreshTokens: () => Promise<boolean>;
  readonly initialize: () => Promise<void>;
  readonly clearError: () => void;
}

type AuthStore = AuthState & AuthActions;

function persistTokens(accessToken: string, refreshToken: string, user: AuthUser): void {
  localStorage.setItem("omnitwin_access_token", accessToken);
  localStorage.setItem("omnitwin_refresh_token", refreshToken);
  localStorage.setItem("omnitwin_user", JSON.stringify(user));
}

function clearTokens(): void {
  localStorage.removeItem("omnitwin_access_token");
  localStorage.removeItem("omnitwin_refresh_token");
  localStorage.removeItem("omnitwin_user");
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authApi.login(email, password);
      persistTokens(result.accessToken, result.refreshToken, result.user);
      set({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  register: async (email, password, name, role) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authApi.register(email, password, name, role);
      persistTokens(result.accessToken, result.refreshToken, result.user);
      set({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed";
      set({ isLoading: false, error: message });
      throw err;
    }
  },

  logout: () => {
    clearTokens();
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  },

  refreshTokens: async () => {
    const rt = get().refreshToken;
    if (rt === null) return false;
    try {
      const result = await authApi.refresh(rt);
      const user = get().user;
      if (user !== null) {
        persistTokens(result.accessToken, result.refreshToken, user);
      }
      set({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      return true;
    } catch {
      get().logout();
      return false;
    }
  },

  initialize: async () => {
    set({ isLoading: true });
    const accessToken = localStorage.getItem("omnitwin_access_token");
    const refreshToken = localStorage.getItem("omnitwin_refresh_token");
    const userJson = localStorage.getItem("omnitwin_user");

    if (accessToken === null || refreshToken === null || userJson === null) {
      set({ isLoading: false });
      return;
    }

    try {
      const user = JSON.parse(userJson) as AuthUser;

      // Check if access token is expired by decoding JWT payload
      const payload = JSON.parse(atob(accessToken.split(".")[1] ?? "")) as { exp: number };
      const nowSec = Math.floor(Date.now() / 1000);

      if (payload.exp > nowSec) {
        // Token still valid
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        // Token expired — try refresh
        const result = await authApi.refresh(refreshToken);
        persistTokens(result.accessToken, result.refreshToken, user);
        set({
          user,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          isAuthenticated: true,
          isLoading: false,
        });
      }
    } catch {
      clearTokens();
      set({ isLoading: false });
    }
  },

  clearError: () => { set({ error: null }); },
}));
