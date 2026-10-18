import type { LivePresenceUser } from "./live-protocol.js";

// ---------------------------------------------------------------------------
// What the office reads about the screens (goal 19 S7, D8): "Wall display
// live · Elaine's phone live", or, when no hallkeeper screen is on, "No
// hallkeeper screen is on; escalating in 2 min". Presence tells the truth:
// a hallkeeper screen is any hallkeeper who is present, or any wall display,
// whoever is signed in on it. The person reading is left out of the line.
// ---------------------------------------------------------------------------

export type DeviceKind = "wall" | "phone" | "desk";

export interface PresenceLineOptions {
  /** The venue's "now" window in seconds, or null when it has set none. */
  readonly nowWindowSeconds: number | null;
  readonly selfUserId: string | null;
}

export const PRESENCE_LINE_COPY = {
  wall: "Wall display live",
  phone: (name: string): string => `${name}'s phone live`,
  desk: (name: string): string => `${name}'s desk live`,
  someScreen: (name: string): string => `${name} live`,
  nobody: "No hallkeeper screen is on",
  escalating: (minutes: number): string => `escalating in ${String(minutes)} min`,
  separator: " · ",
} as const;

function hasHallkeeperScreen(others: readonly LivePresenceUser[]): boolean {
  return others.some((person) => person.role === "hallkeeper" || (person.devices ?? []).includes("wall"));
}

export function presenceLine(users: readonly LivePresenceUser[], options: PresenceLineOptions): string {
  const others = users.filter((person) => person.userId !== options.selfUserId);
  const parts: string[] = [];
  if (others.some((person) => (person.devices ?? []).includes("wall"))) parts.push(PRESENCE_LINE_COPY.wall);
  for (const person of others) {
    const devices = person.devices ?? [];
    if (devices.includes("phone")) parts.push(PRESENCE_LINE_COPY.phone(person.name));
    if (devices.includes("desk")) parts.push(PRESENCE_LINE_COPY.desk(person.name));
    // An older server says nothing of devices: the person is live somewhere.
    if (devices.length === 0 && person.role === "hallkeeper") parts.push(PRESENCE_LINE_COPY.someScreen(person.name));
  }
  if (!hasHallkeeperScreen(others)) {
    const nobody = options.nowWindowSeconds === null
      ? PRESENCE_LINE_COPY.nobody
      : `${PRESENCE_LINE_COPY.nobody}; ${PRESENCE_LINE_COPY.escalating(Math.max(1, Math.ceil(options.nowWindowSeconds / 60)))}`;
    parts.unshift(nobody);
  }
  return parts.join(PRESENCE_LINE_COPY.separator);
}
