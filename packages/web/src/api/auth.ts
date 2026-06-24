import { z } from "zod";
import { api } from "./client.js";

export const PlatformRoleSchema = z.enum(["none", "operator", "admin"]);

export const AuthSessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.string().min(1),
  platformRole: PlatformRoleSchema,
  venueId: z.string().nullable(),
});

export type AuthSessionUser = z.infer<typeof AuthSessionUserSchema>;

export function getCurrentAuthUser(): Promise<AuthSessionUser> {
  return api.get("/auth/me", AuthSessionUserSchema);
}
