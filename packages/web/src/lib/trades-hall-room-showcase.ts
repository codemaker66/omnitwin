import {
  TRADES_HALL_RUNTIME_ROOM_SLUGS,
  type TradesHallRuntimeRoomSlug,
} from "@omnitwin/types";

export interface RoomShowcaseProfile {
  readonly slug: TradesHallRuntimeRoomSlug;
  readonly name: string;
  readonly shortName: string;
  readonly heroImage: string;
  readonly heroImageAlt: string;
  readonly heroImageKind: "room-photo" | "venue-context";
  readonly eventTypes: readonly string[];
  readonly guestGuidance: string;
  readonly highlights: readonly string[];
  readonly planningHref: string | null;
  readonly requestLayoutHref: string;
  readonly enquiryHref: string;
}

const venueContextImage = "/images/venue/grand-hall-facade-3.jpg";

export const TRADES_HALL_ROOM_SHOWCASE_PROFILES = {
  "grand-hall": {
    slug: "grand-hall",
    name: "Grand Hall",
    shortName: "Grand Hall",
    heroImage: "/rooms/Grand-Hall-scaled-opt.jpg",
    heroImageAlt: "Grand Hall set for a formal event",
    heroImageKind: "room-photo",
    eventTypes: ["Wedding dinner", "Gala", "Conference", "Ceremony", "Ceilidh"],
    guestGuidance: "Planning-grade guidance: suited to larger layouts, with final guest numbers confirmed by the venue team.",
    highlights: [
      "Landmark Trades Hall setting",
      "Flexible dinner, ceremony, and reception layouts",
      "Strong arrival moment for larger events",
    ],
    planningHref: "/plan?space=grand-hall",
    requestLayoutHref: "/plan?space=grand-hall&intent=request-layout",
    enquiryHref: "/?room=grand-hall#contact",
  },
  "reception-room": {
    slug: "reception-room",
    name: "Reception Room",
    shortName: "Reception",
    heroImage: "/rooms/reception-wedding-opt.jpg",
    heroImageAlt: "Reception Room arranged for an event",
    heroImageKind: "room-photo",
    eventTypes: ["Ceremony", "Drinks reception", "Private dinner", "Photography", "Arrival"],
    guestGuidance: "Planning-grade guidance: best reviewed against the chosen layout, service style, and guest movement needs.",
    highlights: [
      "Warm arrival or reception setting",
      "Works well as a companion space to larger room plans",
      "Useful for ceremonies, welcome drinks, and portraits",
    ],
    planningHref: "/plan?space=reception-room",
    requestLayoutHref: "/plan?space=reception-room&intent=request-layout",
    enquiryHref: "/?room=reception-room#contact",
  },
  "robert-adam-room": {
    slug: "robert-adam-room",
    name: "Robert Adam Room",
    shortName: "Robert Adam",
    heroImage: "/rooms/robert-adam-wedding-opt.jpg",
    heroImageAlt: "Robert Adam Room prepared for a ceremony",
    heroImageKind: "room-photo",
    eventTypes: ["Ceremony", "Private dining", "Boardroom", "Talk", "Reception"],
    guestGuidance: "Planning-grade guidance: suited to more focused gatherings, with final details checked by the venue team.",
    highlights: [
      "Detailed period room character",
      "Good fit for intimate dining or ceremony moments",
      "Pairs cleanly with reception and gallery movement plans",
    ],
    planningHref: "/plan?space=robert-adam-room",
    requestLayoutHref: "/plan?space=robert-adam-room&intent=request-layout",
    enquiryHref: "/?room=robert-adam-room#contact",
  },
  saloon: {
    slug: "saloon",
    name: "Saloon",
    shortName: "Saloon",
    heroImage: "/rooms/saloon_TH_use.png",
    heroImageAlt: "Saloon prepared for a venue event",
    heroImageKind: "room-photo",
    eventTypes: ["Ceremony", "Dinner", "Reception", "Speeches", "Private event"],
    guestGuidance: "Planning-grade guidance: strong for mid-scale event formats, subject to layout and service review.",
    highlights: [
      "Elegant standalone room experience",
      "Useful for ceremonies, dinners, and speeches",
      "Can support multi-phase event planning",
    ],
    planningHref: "/plan?space=saloon",
    requestLayoutHref: "/plan?space=saloon&intent=request-layout",
    enquiryHref: "/?room=saloon#contact",
  },
  "lady-convenors-room": {
    slug: "lady-convenors-room",
    name: "Lady Convenor's Room",
    shortName: "Lady Convenor's",
    heroImage: venueContextImage,
    heroImageAlt: "Trades Hall exterior used as venue context while the room preview is prepared",
    heroImageKind: "venue-context",
    eventTypes: ["Private dining", "VIP reception", "Green room", "Planning meeting", "Wedding party preparation"],
    guestGuidance: "Planning-grade guidance: reviewed as a smaller room or support space before any final arrangement is confirmed.",
    highlights: [
      "Useful as a private support room",
      "Candidate room for a future runtime visual package",
      "Best reviewed with venue team notes before client sign-off",
    ],
    planningHref: null,
    requestLayoutHref: "/plan?space=lady-convenors-room&intent=request-layout",
    enquiryHref: "/?room=lady-convenors-room#contact",
  },
  "north-gallery": {
    slug: "north-gallery",
    name: "North Gallery",
    shortName: "North Gallery",
    heroImage: venueContextImage,
    heroImageAlt: "Trades Hall exterior used as venue context while the gallery preview is prepared",
    heroImageKind: "venue-context",
    eventTypes: ["Arrival", "Drinks", "Exhibition", "Photography", "Overflow"],
    guestGuidance: "Planning-grade guidance: best treated as a movement or support zone until room-specific details are reviewed.",
    highlights: [
      "Supports arrival and circulation planning",
      "Useful for gallery-style event moments",
      "Room-specific runtime preview can be added once the asset is registered",
    ],
    planningHref: null,
    requestLayoutHref: "/plan?space=north-gallery&intent=request-layout",
    enquiryHref: "/?room=north-gallery#contact",
  },
  "south-gallery": {
    slug: "south-gallery",
    name: "South Gallery",
    shortName: "South Gallery",
    heroImage: venueContextImage,
    heroImageAlt: "Trades Hall exterior used as venue context while the gallery preview is prepared",
    heroImageKind: "venue-context",
    eventTypes: ["Arrival", "Drinks", "Exhibition", "Photography", "Overflow"],
    guestGuidance: "Planning-grade guidance: best reviewed as part of the wider event route and room sequence.",
    highlights: [
      "Supports circulation and overflow plans",
      "Can complement larger room experiences",
      "Room-specific runtime preview can be added once the asset is registered",
    ],
    planningHref: null,
    requestLayoutHref: "/plan?space=south-gallery&intent=request-layout",
    enquiryHref: "/?room=south-gallery#contact",
  },
} as const satisfies Record<TradesHallRuntimeRoomSlug, RoomShowcaseProfile>;

export const roomShowcaseRoutes = TRADES_HALL_RUNTIME_ROOM_SLUGS.map((roomSlug) => (
  `/venues/trades-hall/rooms/${roomSlug}`
));

export function getRoomShowcaseProfile(roomSlug: string): RoomShowcaseProfile | null {
  if (!TRADES_HALL_RUNTIME_ROOM_SLUGS.includes(roomSlug as TradesHallRuntimeRoomSlug)) {
    return null;
  }
  return TRADES_HALL_ROOM_SHOWCASE_PROFILES[roomSlug as TradesHallRuntimeRoomSlug];
}
