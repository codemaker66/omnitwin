import { forwardRef, useRef, type FocusEvent, type ReactElement } from "react";
import { Armchair } from "lucide-react";
import type { CatalogueCard, VariantColour } from "../../lib/card-defaults.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import { setupCardPreviewUrl } from "../../lib/crafted-furniture.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import {
  CARD_COLOURWAYS,
  cardMainItem,
  cardMainSlug,
  cardParamsFor,
  describeCard,
  isSetupCardId,
  pieceCardId,
  pieceCardSlug,
  type CardId,
  type CardParams,
  type TableColourway,
} from "../../lib/setup-cards.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { useSpringCssVariable } from "../../lib/use-spring-value.js";
import { FurnitureCataloguePreview } from "../shared/FurnitureCataloguePreview.js";
import { keyAccessibleName } from "./Keys.js";
import type { StoreFace } from "./store-figures.js";
import { useTooltip } from "./Tooltip.js";
import "./chrome.css";
import "./catalogue.css";

// ---------------------------------------------------------------------------
// The catalogue's full card (card-dock spec §4.1–4.3; T-671 slice 12′).
//
// 104 × 124 of paper: the piece's crafted render (or its drawn icon) on a
// paper mat, a seat chip on dining pieces, the "×8" pip once the room holds
// some, the name on one line and its size. A colourway family carries its
// swatches, a family of sizes its sizes, each arming that one piece. Armed,
// the card rises 6 px on `detent` with a copper notch and a copper-edged mat
// (aria-pressed); a card that cannot go down here is dimmed and says why.
// ---------------------------------------------------------------------------

/** One of a card's pieces, or one of a setup's cloths. */
export type CardChoice =
  | { readonly kind: "variant"; readonly slug: string }
  | { readonly kind: "colourway"; readonly colourway: TableColourway };

export interface CardChoiceOption {
  readonly key: string;
  /** What a person hears and reads in the tooltip ("White", "6 × 4 ft"). */
  readonly label: string;
  /** A swatch's colour; null for a size. */
  readonly colour: VariantColour;
  /** A size's own words on the card ("6×4"); null for a swatch. */
  readonly text: string | null;
  readonly choice: CardChoice;
}

/**
 * The render's square, wider than the 60 px mat is tall: the crafted previews
 * stand their piece in the middle of the frame, so the mat's clip takes only
 * empty paper above and below, and the piece reads at the mockup's size.
 */
const ART_PX = 84;

const COLOUR_WORDS:Readonly<Record<NonNullable<VariantColour>, string>> = {
  white: "White",
  black: "Black",
  wood: "Wood",
  bare: "Bare",
  green: "Green",
  blue: "Blue",
};

/** The colourways a setup offers, or none. */
function setupColourways(id: CardId): readonly TableColourway[] {
  return id === "round" || id === "top-table" || id === "long-table" ? CARD_COLOURWAYS[id] : [];
}

/** A size's words, short enough for the card: "8 × 4 ft" reads "8×4". */
function shortSize(label: string): string {
  return label.replace(/\s*ft$/u, "").replace(/\s*×\s*/gu, "×");
}

/**
 * The swatches or sizes a card offers: a setup's cloths, a family's colours,
 * or a family's sizes. A card with one piece, or pieces told apart by
 * neither, offers none.
 */
export function cardChoices(card: CatalogueCard): readonly CardChoiceOption[] {
  if (card.variants.length === 0) {
    return setupColourways(card.id).map((colourway) => ({
      key: colourway,
      label: COLOUR_WORDS[colourway],
      colour: colourway,
      text: null,
      choice: { kind: "colourway", colourway },
    }));
  }
  if (card.variants.length < 2) return [];
  if (card.variants.every((variant) => variant.colour !== null)) {
    return card.variants.map((variant) => ({
      key: variant.slug,
      label: variant.colour === null ? variant.slug : COLOUR_WORDS[variant.colour],
      colour: variant.colour,
      text: null,
      choice: { kind: "variant", slug: variant.slug },
    }));
  }
  if (card.variants.every((variant) => variant.label !== undefined)) {
    return card.variants.map((variant) => {
      const label = variant.label ?? variant.slug;
      return { key: variant.slug, label, colour: null, text: shortSize(label), choice: { kind: "variant", slug: variant.slug } };
    });
  }
  return [];
}

/** The pieces a card puts in the room: its variants, or a setup's main piece in each of its cloths. */
export function cardSlugs(card: CatalogueCard): readonly string[] {
  if (card.variants.length > 0) return card.variants.map((variant) => variant.slug);
  const colourways = setupColourways(card.id);
  const asks = colourways.length === 0 ? [{}] : colourways.map((colourway) => ({ colourway }));
  const slugs = new Set<string>();
  for (const ask of asks) {
    const params = cardParamsFor(card.id, ask, {});
    if (params !== null) slugs.add(cardMainSlug(params));
  }
  return [...slugs];
}

/** How many of this card's pieces the room holds, from a count by slug. */
export function placedCount(card: CatalogueCard, placedBySlug: ReadonlyMap<string, number>): number {
  return cardSlugs(card).reduce((sum, slug) => sum + (placedBySlug.get(slug) ?? 0), 0);
}

/** The variant of this card in hand, when the card in hand is one of its pieces. */
export function armedVariantSlug(card: CatalogueCard, armedCardId: CardId | null): string | null {
  if (armedCardId === null) return null;
  const slug = pieceCardSlug(armedCardId);
  if (slug === null) return null;
  return card.variants.some((variant) => variant.slug === slug) ? slug : null;
}

/** Whether this card is the one in hand (any of its pieces). */
export function isCardArmed(card: CatalogueCard, armedCardId: CardId | null): boolean {
  if (armedCardId === null) return false;
  return card.variants.length === 0 ? armedCardId === card.id : armedVariantSlug(card, armedCardId) !== null;
}

/** What a card shows now: its own figures while in hand, its defaults otherwise. */
export interface CardFaceNow {
  readonly name: string;
  readonly size: string;
  readonly seats: number;
  readonly item: CatalogueItem | undefined;
  /** The swatch or size that is in hand, by option key. */
  readonly currentChoice: string | null;
  /** What the card sets down now, for the store's figure; null when the catalogue holds none of it. */
  readonly params: CardParams | null;
}

export function cardFaceNow(card: CatalogueCard, armedCardId: CardId | null, cardParams: CardParams | null): CardFaceNow {
  const armed = isCardArmed(card, armedCardId) && cardParams !== null;
  if (card.variants.length === 0) {
    const params = armed ? cardParams : cardParamsFor(card.id, {}, {});
    if (params === null) return { name: card.name, size: "", seats: 0, item: undefined, currentChoice: null, params: null };
    const face = describeCard(params);
    const colourway = armed && "colourway" in params ? params.colourway : null;
    return { name: face.name, size: face.size, seats: face.seats, item: cardMainItem(params), currentChoice: colourway, params };
  }
  const armedSlug = armed ? armedVariantSlug(card, armedCardId) : null;
  const slug = armedSlug ?? card.variants[0]?.slug ?? "";
  const params = armedSlug !== null ? cardParams : cardParamsFor(pieceCardId(slug), {}, {});
  if (params === null) return { name: card.name, size: "", seats: 0, item: undefined, currentChoice: null, params: null };
  const face = describeCard(params);
  return { name: card.name, size: face.size, seats: face.seats, item: cardMainItem(params), currentChoice: armedSlug, params };
}

/** Sizes as a person hears them: "1.83 m round" is "1.83 metres round"; "2 × 1 m" is "2 by 1 metres". */
export function spokenSize(size: string): string {
  return size.replace(/\s*×\s*/gu, " by ").replace(/(\d) m\b/gu, "$1 metres");
}

/** The card's full accessible name (spec §15): "Round of 10, 1.83 metres round, 10 seats, 8 in this room". */
export function cardAccessibleName(face: Pick<CardFaceNow, "name" | "size" | "seats">, placed: number, disabledReason?: string, store?: StoreFace | null): string {
  const parts = [face.name];
  if (face.size !== "") parts.push(spokenSize(face.size));
  if (face.seats > 0) parts.push(`${String(face.seats)} seats`);
  if (placed > 0) parts.push(`${String(placed)} in this room`);
  // Staff also hear the store (spec §15): "22 in store". A refusal already says it as the reason.
  if (store !== undefined && store !== null && !store.refused) parts.push(store.spoken);
  return keyAccessibleName({ label: face.name, tip: parts.join(", "), disabledReason });
}

interface ChoiceKeyProps {
  readonly cardName: string;
  readonly option: CardChoiceOption;
  readonly current: boolean;
  readonly disabled: boolean;
  readonly onChoose: (choice: CardChoice) => void;
}

/** One swatch or size: the pointer's way to a card's other pieces (C cycles them from the keys). */
function ChoiceKey({ cardName, option, current, disabled, onChoose }: ChoiceKeyProps): ReactElement {
  const tooltip = useTooltip({ text: option.label, side: "above" });
  const classes = [
    "pc-ccard__choice",
    option.text === null ? "pc-ccard__choice--swatch" : "pc-ccard__choice--size",
    current ? "is-current" : "",
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      tabIndex={-1}
      aria-label={`${cardName}, ${option.label}`}
      aria-pressed={current}
      aria-disabled={disabled ? true : undefined}
      data-colour={option.colour ?? undefined}
      onClick={() => {
        if (disabled) return;
        onChoose(option.choice);
      }}
      {...tooltip}
    >
      {option.text === null ? <span className="pc-ccard__disc" aria-hidden="true" /> : <span aria-hidden="true">{option.text}</span>}
    </button>
  );
}

export interface FullCardProps {
  readonly card: CatalogueCard;
  readonly face: CardFaceNow;
  readonly armed: boolean;
  /** Pieces of this card already in the room. */
  readonly placed: number;
  /** The roving tab stop: one card in the row is 0. */
  readonly tabIndex: 0 | -1;
  /** The card cannot go down here now; this says why. */
  readonly disabledReason?: string;
  /** What the store says, for staff only. */
  readonly store?: StoreFace | null;
  /** The card itself: arms it, or puts it down when it is in hand. */
  readonly onPress: () => void;
  /** A swatch or a size: arms that piece. */
  readonly onChoose: (choice: CardChoice) => void;
  readonly onFocusCard: () => void;
}

/** The catalogue's full card. The ref is the card's own button, for the row's roving focus. */
export const FullCard = forwardRef<HTMLButtonElement, FullCardProps>(function FullCard(
  { card, face, armed, placed, tabIndex, disabledReason, store = null, onPress, onChoose, onFocusCard },
  ref,
): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const disabled = disabledReason !== undefined;
  const choices = cardChoices(card);
  const sizes = choices.length > 0 && choices.every((option) => option.text !== null);
  const tooltip = useTooltip({
    text: disabled ? disabledReason : face.size === "" ? face.name : `${face.name} · ${face.size}`,
    side: "above",
  });
  // Raised 6 px on detent while in hand; reduced motion keeps the notch and aria-pressed only.
  useSpringCssVariable(rootRef, "--pc-ccard-raise", armed && !prefersReducedMotion() ? -6 : 0, SPRING_PRESETS.detent);

  const classes = ["pc-ccard", "pc-paper", armed ? "is-armed" : "", disabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  return (
    <div ref={rootRef} className={classes} data-card-id={card.id}>
      <button
        ref={ref}
        type="button"
        className="pc-ccard__face"
        aria-pressed={armed}
        aria-disabled={disabled ? true : undefined}
        aria-label={cardAccessibleName(face, placed, disabledReason, store)}
        tabIndex={tabIndex}
        onClick={() => {
          if (disabled) return;
          onPress();
        }}
        {...tooltip}
        onFocus={(event: FocusEvent<HTMLButtonElement>) => {
          tooltip.onFocus(event);
          onFocusCard();
        }}
      >
        <span className="pc-ccard__mat" aria-hidden="true">
          {isSetupCardId(card.id)
            // A setup card shows its whole set (Q-21); a piece card shows its piece.
            ? <img className="pc-ccard__set" src={setupCardPreviewUrl(card.id)} alt="" width={ART_PX} height={ART_PX} loading="lazy" decoding="async" draggable={false} />
            : face.item !== undefined ? <FurnitureCataloguePreview item={face.item} size={ART_PX} /> : null}
        </span>
        {face.seats > 0 ? (
          <span className="pc-ccard__seats pc-num" aria-hidden="true">
            <Armchair className="pc-ccard__seat-icon" aria-hidden="true" />
            {face.seats}
          </span>
        ) : null}
        {placed > 0 ? <span className="pc-ccard__pip pc-num" aria-hidden="true">×{placed}</span> : null}
        <span className="pc-ccard__name">{face.name}</span>
        {sizes ? null : <span className="pc-ccard__size pc-num">{face.size}</span>}
        {store !== null ? <span className={`pc-ccard__store pc-num${store.refused ? " is-empty" : ""}`}>{store.line}</span> : null}
      </button>
      {choices.length > 0 ? (
        <div
          className={`pc-ccard__choices${sizes ? " pc-ccard__choices--sizes" : ""}`}
          role="group"
          aria-label={sizes ? `${face.name} sizes` : `${face.name} colours`}
        >
          {choices.map((option) => (
            <ChoiceKey
              key={option.key}
              cardName={face.name}
              option={option}
              current={armed && face.currentChoice === option.key}
              disabled={disabled}
              onChoose={onChoose}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});
