import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly venueId: string | null;
  readonly name: string;
}

export interface AuthResponse {
  readonly user: AuthUser;
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

// ---------------------------------------------------------------------------
// Auth API functions
// ---------------------------------------------------------------------------

export async function register(
  email: string,
  password: string,
  name: string,
  role?: string,
): Promise<AuthResponse> {
  return api.post<AuthResponse>("/auth/register", { email, password, name, role }, true);
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  return api.post<AuthResponse>("/auth/login", { email, password }, true);
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  return api.post<TokenPair>("/auth/refresh", { refreshToken }, true);
}
