import { sql } from "drizzle-orm";
import { users } from "../db/schema.js";

// ---------------------------------------------------------------------------
// A person's name as the product shows it (T-619): their display name when
// they have one, otherwise the name on their account. Capped at the 200
// characters every read model carries — `display_name` is unbounded text, and
// one long value must never fail the whole response it travels in. Null only
// when the joined `users` row is absent: an ownerless booking, or an owner
// whose account has gone (`owner_user_id` is ON DELETE SET NULL).
//
// Use it with a LEFT JOIN on `users`; the Diary's calendar read and the hold
// reminder pass both do, so the drawer and the reminder name the same person.
// ---------------------------------------------------------------------------

export const USER_DISPLAY_NAME_MAX = 200;

export const userDisplayName = sql<string | null>`left(coalesce(nullif(btrim(${users.displayName}), ''), ${users.name}), ${sql.raw(String(USER_DISPLAY_NAME_MAX))})`;
