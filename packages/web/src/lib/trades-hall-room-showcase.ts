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
  readonly heroImagePosition?: string;
  readonly heroImageKind: "room-photo" | "venue-context";
  readonly eventTypes: readonly string[];
  readonly guestGuidance: string;
  readonly highlights: readonly string[];
  readonly planningHref: string | null;
  readonly requestLayoutHref: string;
  readonly enquiryHref: string;
}

export interface PublicRoomSelectionCard {
  readonly id: string;
  readonly canonicalRoomSlug: TradesHallRuntimeRoomSlug | null;
  readonly name: string;
  readonly shortName: string;
  readonly image: string;
  readonly imageAlt: string;
  readonly imagePosition?: string;
  readonly tone: string;
  readonly mood: string;
  readonly bestFor: readonly string[];
  readonly planningNote: string;
  readonly statusCopy: string;
  readonly routeHref: string | null;
  readonly requestLayoutHref: string | null;
  readonly enquiryHref: string;
}

export const tradesHallVenueImages = {
  grandHall: "/images/venue/grand-hall-room.jpg",
  receptionRoom: "/images/venue/reception-room.jpg",
  robertAdamRoom: "/images/venue/robert-adam-room.jpg",
  saloon: "/images/venue/saloon-room.jpg",
  exterior: "/images/venue/trades-hall-exterior.jpg",
} as const;

const venueContextImage = tradesHallVenueImages.exterior;
const venueContextImagePosition = "center 44%";

export const TRADES_HALL_ROOM_SHOWCASE_PROFILES = {
  "grand-hall": {
    slug: "grand-hall",
    name: "Grand Hall",
    shortName: "Grand Hall",
    heroImage: tradesHallVenueImages.grandHall,
    heroImageAlt: "Grand Hall dressed for a candlelit wedding dinner",
    heroImagePosition: "center 48%",
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
    heroImage: tradesHallVenueImages.receptionRoom,
    heroImageAlt: "Reception Room dressed for a wedding ceremony with floral aisle",
    heroImagePosition: "center 52%",
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
    heroImage: tradesHallVenueImages.robertAdamRoom,
    heroImageAlt: "Robert Adam Room ceremony aisle with floral arch and chandelier",
    heroImagePosition: "center 36%",
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
    heroImage: tradesHallVenueImages.saloon,
    heroImageAlt: "Saloon set for a candlelit wedding ceremony",
    heroImagePosition: "center 46%",
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
    heroImagePosition: venueContextImagePosition,
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
    heroImagePosition: venueContextImagePosition,
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
    heroImagePosition: venueContextImagePosition,
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

function roomShowcaseRoute(roomSlug: TradesHallRuntimeRoomSlug): string {
  return `/venues/trades-hall/rooms/${roomSlug}`;
}

export const publicRoomSelectionCards: readonly PublicRoomSelectionCard[] = [
  {
    id: "grand-hall",
    canonicalRoomSlug: "grand-hall",
    name: "The Grand Hall",
    shortName: "Grand Hall",
    image: TRADES_HALL_ROOM_SHOWCASE_PROFILES["grand-hall"].heroImage,
    imageAlt: TRADES_HALL_ROOM_SHOWCASE_PROFILES["grand-hall"].heroImageAlt,
    imagePosition: TRADES_HALL_ROOM_SHOWCASE_PROFILES["grand-hall"].heroImagePosition,
    tone: "Flagship scale",
    mood: "Grand dinner, gala, ceremony, and ceilidh planning.",
    bestFor: ["Wedding dinner", "Gala", "Conference"],
    planningNote: TRADES_HALL_ROOM_SHOWCASE_PROFILES["grand-hall"].guestGuidance,
    statusCopy: "Client-safe preview. Human review required before final room details.",
    routeHref: roomShowcaseRoute("grand-hall"),
    requestLayoutHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["grand-hall"].requestLayoutHref,
    enquiryHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["grand-hall"].enquiryHref,
  },
  {
    id: "deacon-convener-room",
    canonicalRoomSlug: null,
    name: "Deacon Convener's Room",
    shortName: "Deacon Convener's",
    image: venueContextImage,
    imageAlt: "Trades Hall exterior used as venue context for the Deacon Convener's Room enquiry",
    imagePosition: venueContextImagePosition,
    tone: "Private host room",
    mood: "A venue-team conversation for hosted moments and private support use.",
    bestFor: ["VIP welcome", "Hosted meeting", "Support room"],
    planningNote: "Planning-grade guidance: room details should be confirmed by the venue team before it is used in a layout.",
    statusCopy: "Enquiry-only room selection. No public runtime package is exposed.",
    routeHref: null,
    requestLayoutHref: null,
    enquiryHref: "/?room=deacon-convener-room#contact",
  },
  {
    id: "lady-conveners-room",
    canonicalRoomSlug: "lady-convenors-room",
    name: "Lady Convener's Room",
    shortName: "Lady Convener's",
    image: TRADES_HALL_ROOM_SHOWCASE_PROFILES["lady-convenors-room"].heroImage,
    imageAlt: TRADES_HALL_ROOM_SHOWCASE_PROFILES["lady-convenors-room"].heroImageAlt,
    imagePosition: TRADES_HALL_ROOM_SHOWCASE_PROFILES["lady-convenors-room"].heroImagePosition,
    tone: "Private support",
    mood: "A quieter room for private dining, VIP reception, or event preparation.",
    bestFor: ["Private dining", "VIP reception", "Green room"],
    planningNote: TRADES_HALL_ROOM_SHOWCASE_PROFILES["lady-convenors-room"].guestGuidance,
    statusCopy: "Client-safe venue context until a public room visual is available.",
    routeHref: roomShowcaseRoute("lady-convenors-room"),
    requestLayoutHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["lady-convenors-room"].requestLayoutHref,
    enquiryHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["lady-convenors-room"].enquiryHref,
  },
  {
    id: "reception-room",
    canonicalRoomSlug: "reception-room",
    name: "The Reception Room",
    shortName: "Reception",
    image: TRADES_HALL_ROOM_SHOWCASE_PROFILES["reception-room"].heroImage,
    imageAlt: TRADES_HALL_ROOM_SHOWCASE_PROFILES["reception-room"].heroImageAlt,
    imagePosition: TRADES_HALL_ROOM_SHOWCASE_PROFILES["reception-room"].heroImagePosition,
    tone: "Arrival warmth",
    mood: "Ceremony, drinks reception, photography, and arrival planning.",
    bestFor: ["Ceremony", "Drinks reception", "Photography"],
    planningNote: TRADES_HALL_ROOM_SHOWCASE_PROFILES["reception-room"].guestGuidance,
    statusCopy: "Planning-grade guidance. Final arrangements confirmed by the venue team.",
    routeHref: roomShowcaseRoute("reception-room"),
    requestLayoutHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["reception-room"].requestLayoutHref,
    enquiryHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["reception-room"].enquiryHref,
  },
  {
    id: "robert-adam-room",
    canonicalRoomSlug: "robert-adam-room",
    name: "The Robert Adam Room",
    shortName: "Robert Adam",
    image: TRADES_HALL_ROOM_SHOWCASE_PROFILES["robert-adam-room"].heroImage,
    imageAlt: TRADES_HALL_ROOM_SHOWCASE_PROFILES["robert-adam-room"].heroImageAlt,
    imagePosition: TRADES_HALL_ROOM_SHOWCASE_PROFILES["robert-adam-room"].heroImagePosition,
    tone: "Period detail",
    mood: "Intimate ceremonies, private dining, boardroom use, and talks.",
    bestFor: ["Ceremony", "Private dining", "Boardroom"],
    planningNote: TRADES_HALL_ROOM_SHOWCASE_PROFILES["robert-adam-room"].guestGuidance,
    statusCopy: "Planning-grade guidance. Human review required before final details.",
    routeHref: roomShowcaseRoute("robert-adam-room"),
    requestLayoutHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["robert-adam-room"].requestLayoutHref,
    enquiryHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["robert-adam-room"].enquiryHref,
  },
  {
    id: "saloon",
    canonicalRoomSlug: "saloon",
    name: "The Saloon",
    shortName: "Saloon",
    image: TRADES_HALL_ROOM_SHOWCASE_PROFILES.saloon.heroImage,
    imageAlt: TRADES_HALL_ROOM_SHOWCASE_PROFILES.saloon.heroImageAlt,
    imagePosition: TRADES_HALL_ROOM_SHOWCASE_PROFILES.saloon.heroImagePosition,
    tone: "Elegant mid-scale",
    mood: "Ceremony, dinner, reception, speeches, and multi-phase planning.",
    bestFor: ["Ceremony", "Dinner", "Speeches"],
    planningNote: TRADES_HALL_ROOM_SHOWCASE_PROFILES.saloon.guestGuidance,
    statusCopy: "Planning-grade guidance. Final details confirmed by the venue team.",
    routeHref: roomShowcaseRoute("saloon"),
    requestLayoutHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES.saloon.requestLayoutHref,
    enquiryHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES.saloon.enquiryHref,
  },
  {
    id: "north-gallery",
    canonicalRoomSlug: "north-gallery",
    name: "The North Gallery",
    shortName: "North Gallery",
    image: TRADES_HALL_ROOM_SHOWCASE_PROFILES["north-gallery"].heroImage,
    imageAlt: TRADES_HALL_ROOM_SHOWCASE_PROFILES["north-gallery"].heroImageAlt,
    imagePosition: TRADES_HALL_ROOM_SHOWCASE_PROFILES["north-gallery"].heroImagePosition,
    tone: "Movement and pause",
    mood: "Arrival, drinks, exhibition, photography, and overflow planning.",
    bestFor: ["Arrival", "Drinks", "Exhibition"],
    planningNote: TRADES_HALL_ROOM_SHOWCASE_PROFILES["north-gallery"].guestGuidance,
    statusCopy: "Venue context shown until room-specific public visual is available.",
    routeHref: roomShowcaseRoute("north-gallery"),
    requestLayoutHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["north-gallery"].requestLayoutHref,
    enquiryHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["north-gallery"].enquiryHref,
  },
  {
    id: "south-gallery",
    canonicalRoomSlug: "south-gallery",
    name: "The South Gallery",
    shortName: "South Gallery",
    image: TRADES_HALL_ROOM_SHOWCASE_PROFILES["south-gallery"].heroImage,
    imageAlt: TRADES_HALL_ROOM_SHOWCASE_PROFILES["south-gallery"].heroImageAlt,
    imagePosition: TRADES_HALL_ROOM_SHOWCASE_PROFILES["south-gallery"].heroImagePosition,
    tone: "Route support",
    mood: "Arrival, drinks, exhibition, photography, and overflow planning.",
    bestFor: ["Arrival", "Drinks", "Overflow"],
    planningNote: TRADES_HALL_ROOM_SHOWCASE_PROFILES["south-gallery"].guestGuidance,
    statusCopy: "Venue context shown until room-specific public visual is available.",
    routeHref: roomShowcaseRoute("south-gallery"),
    requestLayoutHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["south-gallery"].requestLayoutHref,
    enquiryHref: TRADES_HALL_ROOM_SHOWCASE_PROFILES["south-gallery"].enquiryHref,
  },
] as const;

export function getRoomShowcaseProfile(roomSlug: string): RoomShowcaseProfile | null {
  if (!TRADES_HALL_RUNTIME_ROOM_SLUGS.includes(roomSlug as TradesHallRuntimeRoomSlug)) {
    return null;
  }
  return TRADES_HALL_ROOM_SHOWCASE_PROFILES[roomSlug as TradesHallRuntimeRoomSlug];
}
