import { type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { catalogueIcon } from "../../lib/catalogue.js";
import { railName } from "../../lib/card-defaults.js";
import { cardMainItem, cardParamsFor, describeCard, type CardId } from "../../lib/setup-cards.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useTooltip } from "./Tooltip.js";

// ---------------------------------------------------------------------------
// A mini-card on the rail (card-dock spec §4.1–4.2): a paper mat with the
// piece's render (or its line icon), the short name, the seats or the size,
// and the "×N" pip once the room holds one. Its digit is in the tooltip, not
// on the card. Armed: raised with a copper notch, aria-pressed. Hover only
// colours it; it never opens anything.
// ---------------------------------------------------------------------------

export interface RailCardProps {
  readonly card: CardId;
  /** Its slot, 1–8: the digit that arms it. */
  readonly slot: number;
  readonly armed: boolean;
  readonly inFlight: boolean;
  /** How many of it the room holds now. */
  readonly placed: number;
  readonly onPress: (card: CardId) => void;
  readonly onPointerDown: (card: CardId, event: ReactPointerEvent<HTMLButtonElement>) => void;
}

function iconSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function RailCard({ card, slot, armed, inFlight, placed, onPress, onPointerDown }: RailCardProps): ReactElement {
  const remembered = useCatalogueStore((state) => state.rememberedSeats);
  const params = cardParamsFor(card, {}, remembered);
  const face = params === null ? null : describeCard(params);
  const item = params === null ? undefined : cardMainItem(params);
  const name = card === "round" && face !== null ? face.name : railName(card);
  const meta = face === null ? "Not in the catalogue" : face.seats > 0 ? `${String(face.seats)} seats` : face.size;
  const tooltip = useTooltip({ text: [name, face?.size ?? meta, String(slot)].filter((part) => part !== "").join(" · "), side: "above" });
  const art = item === undefined ? null : item.thumbnailUrl ?? iconSource(catalogueIcon(item));
  if (face === null) {
    // A card that names nothing the catalogue holds stays in its slot, dimmed, and says why.
    return (
      <button {...tooltip} type="button" className="pc-railcard is-missing" aria-disabled="true" aria-label={`${name}: ${meta}`}>
        <span className="pc-railcard__mat" aria-hidden="true" />
        <span className="pc-railcard__words">
          <span className="pc-railcard__name">{name}</span>
          <span className="pc-railcard__meta">{meta}</span>
        </span>
      </button>
    );
  }
  return (
    <button
      {...tooltip}
      type="button"
      className={["pc-railcard", armed ? "is-armed" : "", inFlight ? "is-in-flight" : ""].filter(Boolean).join(" ")}
      aria-pressed={armed}
      aria-label={`${name}, ${meta}${placed > 0 ? `, ${String(placed)} in the room` : ""}`}
      aria-keyshortcuts={String(slot)}
      data-card={card}
      onClick={() => { onPress(card); }}
      onPointerDown={(event) => {
        tooltip.onPointerDown(event);
        onPointerDown(card, event);
      }}
    >
      <span className="pc-railcard__art" aria-hidden="true">
        <span className="pc-railcard__mat">
          {art !== null ? <img src={art} alt="" draggable={false} /> : null}
        </span>
        {placed > 0 ? <span className="pc-railcard__pip">×{placed}</span> : null}
      </span>
      <span className="pc-railcard__words">
        <span className="pc-railcard__name">{name}</span>
        <span className="pc-railcard__meta">{meta}</span>
      </span>
    </button>
  );
}
