import { useRef, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { RiteCountUp } from "./RiteCountUp.js";
import { useSeen } from "./useSeen.js";
import type { RoomTone } from "./useRoomTone.js";
import {
  CAPACITY_DISCLOSURE,
  enquiryMailtoHref,
  ROOM_CHAPTERS,
  ROOM_INDEX_CARDS,
  ROOM_INDEX_ENQUIRE_LABEL,
  ROOM_INDEX_EXPLORE_LABEL,
  ROOM_INDEX_TITLE,
  ROOM_TONE_LABEL,
  ROOM_TONE_ON_HINT,
  type RoomChapter,
} from "./rite-copy.js";

// -----------------------------------------------------------------------------
// ContemplationAct — Act III, the four rooms as chapters.
//
// Each room, empty, one per chapter: a full-bleed photograph drifting at
// dusk-speed, the name in serif, one line of prose, and the capacities
// whispered in the margin with the SAFE disclosure. A corner toggle offers
// the acoustic of the empty hall — never autoplay.
// -----------------------------------------------------------------------------

interface ChapterProps {
  readonly chapter: RoomChapter;
  readonly reducedMotion: boolean;
}

function Chapter({ chapter, reducedMotion }: ChapterProps): ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const seen = useSeen(ref, 0.3);

  return (
    <article
      ref={ref}
      className={`rite-chapter${seen ? " is-seen" : ""}`}
      aria-label={chapter.name}
    >
      <div className="rite-stage">
        <figure className="rite-chapter-media">
          <img
            src={chapter.image}
            alt={chapter.alt}
            loading="lazy"
            decoding="async"
            style={{ objectPosition: chapter.imagePosition }}
          />
        </figure>
        <div className="rite-chapter-body">
          <h2 className="rite-chapter-name">{chapter.name}</h2>
          <p className="rite-chapter-line">{chapter.line}</p>
          <Link className="rite-chapter-link" to={chapter.showcaseHref}>
            Enter the room <span aria-hidden>→</span>
          </Link>
        </div>
        <aside className="rite-chapter-margin">
          <p className="rite-chapter-capacities">
            <span>
              <RiteCountUp to={chapter.standing} static={reducedMotion} /> standing
            </span>
            <span aria-hidden> · </span>
            <span>
              <RiteCountUp to={chapter.banquet} static={reducedMotion} /> banquet
            </span>
          </p>
          <p className="rite-chapter-disclosure">{CAPACITY_DISCLOSURE}</p>
        </aside>
      </div>
    </article>
  );
}

export interface ContemplationActProps {
  readonly reducedMotion: boolean;
  readonly roomTone: RoomTone;
  /** The toggle is only offered while the chapters are on stage. */
  readonly toneVisible: boolean;
}

export function ContemplationAct({
  reducedMotion,
  roomTone,
  toneVisible,
}: ContemplationActProps): ReactElement {
  return (
    <section className="rite-act rite-contemplation" id="rooms" aria-label="The four rooms">
      {ROOM_CHAPTERS.map((chapter) => (
        <Chapter key={chapter.slug} chapter={chapter} reducedMotion={reducedMotion} />
      ))}

      {/* The index — all eight rooms, none orphaned by the four chapters. */}
      <div className="rite-index">
        <h2 className="rite-index-title">{ROOM_INDEX_TITLE}</h2>
        <ul className="rite-index-list">
          {ROOM_INDEX_CARDS.map((card) => (
            <li key={card.id} className="rite-index-row">
              <span className="rite-index-name">{card.name}</span>
              <span className="rite-index-links">
                {card.routeHref !== null && (
                  <Link to={card.routeHref} aria-label={`Explore ${card.name}`}>
                    {ROOM_INDEX_EXPLORE_LABEL} <span aria-hidden>→</span>
                  </Link>
                )}
                <a
                  href={enquiryMailtoHref(card.name)}
                  aria-label={`Enquire about ${card.name}`}
                >
                  {ROOM_INDEX_ENQUIRE_LABEL}
                </a>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {roomTone.supported && (
        <button
          type="button"
          className={`rite-tone-toggle${roomTone.playing ? " is-on" : ""}${toneVisible ? " is-visible" : ""}`}
          onClick={roomTone.toggle}
          aria-pressed={roomTone.playing}
          title={roomTone.playing ? ROOM_TONE_ON_HINT : ROOM_TONE_LABEL}
        >
          <span className="rite-tone-ripple" aria-hidden />
          {ROOM_TONE_LABEL}
        </button>
      )}
    </section>
  );
}
