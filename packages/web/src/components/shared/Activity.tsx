import { memo, useId, type CSSProperties, type ReactElement, type ReactNode } from "react";
import "./Activity.css";

type ParticleStyle = CSSProperties & Record<`--vv-${string}`, string | number>;
const PARTICLE_COUNT = 56;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Fixed geometry, evaluated once. CSS owns motion: no timers, canvas, frame
// callbacks, network requests or dependency on the venue's render loop.
const PARTICLES: readonly ParticleStyle[] = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
  const y = 1 - 2 * (index + 0.5) / PARTICLE_COUNT;
  const radius = Math.sqrt(1 - y * y);
  const angle = index * GOLDEN_ANGLE;
  const ringAngle = index / PARTICLE_COUNT * Math.PI * 2;
  const sphere = (rotation: number): string => {
    const depth = Math.sin(angle + rotation) * radius;
    return `translate(${(Math.cos(angle + rotation) * radius * 24).toFixed(2)}px, ${(y * 24).toFixed(2)}px) scale(${(0.65 + (depth + 1) * 0.35).toFixed(2)})`;
  };
  return {
    "--vv-sphere-a": sphere(0),
    "--vv-sphere-b": sphere(Math.PI * 0.7),
    "--vv-sphere-c": sphere(Math.PI * 1.4),
    "--vv-ring": `translate(${(Math.cos(ringAngle) * 25).toFixed(2)}px, ${(Math.sin(ringAngle) * 10).toFixed(2)}px) scale(${(0.75 + (Math.sin(ringAngle) + 1) * 0.25).toFixed(2)})`,
    "--vv-helix": `translate(${(Math.sin(y * Math.PI * 2) * 12).toFixed(2)}px, ${(y * 25).toFixed(2)}px) scale(${(0.65 + (Math.cos(y * Math.PI * 2) + 1) * 0.35).toFixed(2)})`,
    "--vv-depth": (0.3 + (Math.sin(angle) * radius + 1) * 0.3).toFixed(2),
  };
});

interface ActivityIndicatorProps {
  readonly size?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Decorative only. Pair with visible work text or the owning control's name. */
export const ActivityIndicator = memo(function ActivityIndicator({
  size = 24, className = "", style,
}: ActivityIndicatorProps): ReactElement {
  const dimension = Number.isFinite(size) && size > 0 ? size : 24;
  const compact = dimension <= 20;
  return (
    <svg
      className={`vv-activity-indicator ${className}`.trim()}
      data-activity-indicator="particles"
      viewBox="0 0 64 64" width={dimension} height={dimension}
      style={{ width: dimension, height: dimension, ...style }} aria-hidden="true" focusable="false"
    >
      <g transform="translate(32 32)">
        {PARTICLES.map((particle, index) => !compact || index % 2 === 0 ? (
          <circle key={index} cx="0" cy="0" r={compact ? 1.8 : index % 9 === 0 ? 1.15 : 0.85}
            className={index % 9 === 0 ? "vv-activity-particle vv-activity-particle--accent" : "vv-activity-particle"}
            style={particle} />
        ) : null)}
      </g>
    </svg>
  );
});

interface ActivityStatusProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly variant?: "inline" | "panel";
  /** Measured completion, 0–100. Omit when the operation has no reliable total. */
  readonly progress?: number;
}

/** The default for user-visible asynchronous work. Mount only while active. */
export function ActivityStatus({
  children, className = "", style, variant = "inline", progress,
}: ActivityStatusProps): ReactElement {
  const labelId = useId();
  const percent = progress !== undefined && Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress)) : undefined;
  return (
    <span className={`vv-activity-status vv-activity-status--${variant} ${className}`.trim()}
      style={style} role="status" aria-live="polite" aria-atomic="true">
      <ActivityIndicator size={variant === "panel" ? 56 : 28} />
      <span className="vv-activity-status__content">
        <span id={labelId} className="vv-activity-status__label">{children}</span>
        {percent !== undefined && (
          <span className="vv-activity-progress" role="progressbar"
            aria-label={typeof children === "string" ? children : undefined}
            aria-labelledby={typeof children === "string" ? undefined : labelId}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ transform: `scaleX(${String(percent / 100)})` }} />
          </span>
        )}
      </span>
    </span>
  );
}
