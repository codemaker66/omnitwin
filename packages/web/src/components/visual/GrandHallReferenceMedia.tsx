import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

export interface GrandHallReferenceMember {
  readonly memberId: string;
  readonly url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly role: string;
  readonly mediaType: string;
  readonly provenance: string;
  readonly classification?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface GrandHallReferenceVideo {
  readonly member: GrandHallReferenceMember;
  readonly provenanceClass: "edited_reference_video";
  readonly lineage: "capture_or_generation_lineage_unverified";
  readonly playback: "manual_only";
  readonly preload: "metadata";
}

export interface GrandHallReferenceMediaProps {
  readonly capturedImages: readonly GrandHallReferenceMember[];
  readonly unclassifiedImages: readonly GrandHallReferenceMember[];
  readonly generatedImages: readonly GrandHallReferenceMember[];
  readonly video: GrandHallReferenceVideo;
}

type ReferenceKind = "captured" | "unclassified" | "video" | "generated";
type MediaStatus = "loading" | "metadata" | "ready" | "error";

interface ReferenceChoice {
  readonly id: string;
  readonly kind: ReferenceKind;
  readonly label: string;
  readonly member: GrandHallReferenceMember;
  readonly badge: string | null;
  readonly description: string;
}

function humanFileSize(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1_000).toLocaleString("en-GB")} KB`;
}

function compactId(memberId: string): string {
  return memberId
    .replace(/^reference-/u, "")
    .replace(/^operator-/u, "")
    .replaceAll("-", " ");
}

export function GrandHallReferenceMedia({
  capturedImages,
  unclassifiedImages,
  generatedImages,
  video,
}: GrandHallReferenceMediaProps): ReactElement {
  const choices = useMemo<readonly ReferenceChoice[]>(() => [
    ...capturedImages.map((member) => ({
      id: member.memberId,
      kind: "captured" as const,
      label: compactId(member.memberId),
      member,
      badge: null,
      description: member.classification === "reference_floorplan_image"
        ? "Captured-reference floor plan · no spatial registration"
        : member.classification === "venue_exterior_reference_image"
          ? "Venue exterior reference · no room alignment"
          : "Captured reference image · no spatial registration",
    })),
    ...unclassifiedImages.map((member) => ({
      id: member.memberId,
      kind: "unclassified" as const,
      label: "operator reference",
      member,
      badge: "LINEAGE UNVERIFIED",
      description:
        "Operator-supplied reference image · capture lineage unverified",
    })),
    {
      id: video.member.memberId,
      kind: "video" as const,
      label: "edited reference video",
      member: video.member,
      badge: "LINEAGE UNVERIFIED",
      description:
        "Edited reference video · provenance not classified · no spatial alignment",
    },
    ...generatedImages.map((member) => ({
      id: member.memberId,
      kind: "generated" as const,
      label: "generated concept",
      member,
      badge: "GENERATED",
      description:
        "Embedded C2PA claim inspected; not cryptographically validated · generated concept only",
    })),
  ], [capturedImages, generatedImages, unclassifiedImages, video.member]);
  const firstChoiceId = choices[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(firstChoiceId);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<MediaStatus>("loading");
  const selected = choices.find((choice) => choice.id === selectedId) ?? choices[0];
  const activeIdentity = selected === undefined
    ? "empty"
    : `${selected.member.memberId}:${selected.member.sha256}:${String(revision)}`;
  const activeIdentityRef = useRef(activeIdentity);
  const videoRef = useRef<HTMLVideoElement>(null);
  activeIdentityRef.current = activeIdentity;

  useEffect(() => {
    if (choices.some((choice) => choice.id === selectedId)) return;
    setSelectedId(firstChoiceId);
  }, [choices, firstChoiceId, selectedId]);

  useEffect(() => {
    setStatus("loading");
  }, [activeIdentity]);

  useEffect(() => {
    if (selected?.kind !== "video") return;
    const element = videoRef.current;
    return () => {
      if (element === null) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [activeIdentity, selected?.kind]);

  const reportStatus = useCallback((identity: string, next: MediaStatus) => {
    if (activeIdentityRef.current !== identity) return;
    setStatus((current) => current === "error" && next !== "loading" ? current : next);
  }, []);

  if (selected === undefined) {
    return (
      <section className="grand-hall-reference-media is-empty" aria-label="Reference media">
        <p>No exact reference-media member is available.</p>
      </section>
    );
  }

  const mediaKey = activeIdentity;
  const generated = selected.kind === "generated";
  const videoSelected = selected.kind === "video";

  return (
    <section
      className="grand-hall-reference-media"
      aria-label="Grand Hall reference media"
      data-testid="grand-hall-reference-media"
    >
      <nav className="grand-hall-reference-media__choices" aria-label="Reference media sources">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={choice.id === selected.id ? "is-active" : undefined}
            aria-pressed={choice.id === selected.id}
            onClick={() => {
              setSelectedId(choice.id);
              setRevision(0);
            }}
          >
            <span>{choice.label}</span>
            {choice.badge !== null && <em>{choice.badge}</em>}
          </button>
        ))}
      </nav>

      <div className="grand-hall-reference-media__viewport">
        {videoSelected ? (
          <video
            key={mediaKey}
            ref={videoRef}
            crossOrigin="anonymous"
            src={selected.member.url}
            controls
            playsInline
            preload="metadata"
            aria-label="Edited reference video · provenance not classified"
            onLoadedMetadata={() => {
              reportStatus(mediaKey, "metadata");
            }}
            onCanPlay={() => {
              reportStatus(mediaKey, "ready");
            }}
            onError={() => {
              reportStatus(mediaKey, "error");
            }}
          />
        ) : (
          <img
            key={mediaKey}
            crossOrigin="anonymous"
            src={selected.member.url}
            alt={`${selected.label} — Grand Hall reference`}
            decoding="async"
            onLoad={() => {
              reportStatus(mediaKey, "ready");
            }}
            onError={() => {
              reportStatus(mediaKey, "error");
            }}
          />
        )}
        {generated && (
          <strong className="grand-hall-reference-media__generated-badge">
            GENERATED · CONCEPT ONLY
          </strong>
        )}
        {status !== "ready" && (
          <div
            className={`grand-hall-reference-media__status is-${status}`}
            role={status === "error" ? "alert" : "status"}
          >
            {status === "error" ? (
              <>
                <strong>
                  {videoSelected
                    ? "Browser derivative required"
                    : "Reference member could not be decoded"}
                </strong>
                <p>
                  {videoSelected
                    ? "This exact MOV remains retained as an edited reference; no playable claim is made."
                    : "The exact source remains retained. Check the local gateway and retry this member."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setRevision((current) => current + 1);
                  }}
                >
                  Retry selected media
                </button>
              </>
            ) : (
              <p>
                {status === "metadata"
                  ? "Metadata loaded · waiting for real browser decode"
                  : "Loading selected evidence member…"}
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="grand-hall-reference-media__provenance">
        <div>
          <strong>{selected.description}</strong>
          <span>
            {humanFileSize(selected.member.sizeBytes)} · {selected.member.mediaType}
          </span>
        </div>
        <p>
          Reference/presentation only · operational scene authority unregistered · no
          measurement, placement, collision, capacity, or export input
        </p>
      </footer>
    </section>
  );
}
