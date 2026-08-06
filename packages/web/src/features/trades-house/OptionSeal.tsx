import { useId, type ReactElement } from "react";

// ---------------------------------------------------------------------------
// OptionSeal — a wax seal bearing the option's numeral.
//
// Replaces literal pictogram icons, which failed twice: ambiguous at small
// sizes (a needle reading as a crook), and semantically loose (a key for a
// mechanism). Seals are the Hall's own language — every Incorporation was
// founded by a Seal of Cause — and an abstract marker can never telegraph
// which craft an option secretly serves, which the sorting design requires.
// The wax crimson deliberately echoes the curtain in the Convener's portrait.
// ---------------------------------------------------------------------------

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI"] as const;

function numeralFor(index: number): string {
  return ROMAN_NUMERALS[index] ?? String(index + 1);
}

interface OptionSealProps {
  /** Zero-based option position; rendered as a Roman numeral. */
  readonly index: number;
}

export function OptionSeal({ index }: OptionSealProps): ReactElement {
  const uid = useId().replaceAll(":", "");
  const waxId = `seal-wax-${uid}`;
  const numeral = numeralFor(index);

  return (
    <svg className="craft-option-seal" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id={waxId} cx="0.42" cy="0.36" r="0.75">
          <stop offset="0%" stopColor="#8f2d21" />
          <stop offset="55%" stopColor="#6b1a13" />
          <stop offset="100%" stopColor="#43100b" />
        </radialGradient>
      </defs>
      {/* the wax: poured, not stamped from a die — edges gently uneven */}
      <path
        d="M24 3.4 C29.8 2.9 34.6 6 37.9 9.8 C41.4 13.8 44.8 18.4 44.2 24.3 C43.7 29.7 40.5 33.9 36.9 37.4 C33.3 40.9 28.9 44.6 23.6 44.4 C18.5 44.2 14.6 40.5 11 37.1 C7.4 33.7 3.7 29.9 3.6 24.6 C3.5 19.2 6.7 14.7 10.3 11 C13.8 7.4 18.3 3.9 24 3.4 Z"
        fill={`url(#${waxId})`}
        stroke="#310906"
        strokeWidth="1"
      />
      {/* embossed inner ring: shadow below-right, light above-left */}
      <circle cx="24" cy="24" r="15.5" fill="none" stroke="#2f0a07" strokeWidth="1.6" opacity="0.55" />
      <circle cx="23.4" cy="23.4" r="15.5" fill="none" stroke="#b3543f" strokeWidth="0.8" opacity="0.5" />
      {/* the numeral, pressed into the wax */}
      <text
        x="24"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Georgia, serif"
        fontSize={numeral.length > 2 ? 13 : 15}
        letterSpacing="0.5"
        fill="#2f0a07"
        opacity="0.85"
      >
        {numeral}
      </text>
      <text
        x="23.5"
        y="24.4"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Georgia, serif"
        fontSize={numeral.length > 2 ? 13 : 15}
        letterSpacing="0.5"
        fill="#e9c27d"
      >
        {numeral}
      </text>
      {/* candlelight catching the wax */}
      <ellipse cx="17.5" cy="13.5" rx="7.5" ry="4.4" fill="#ffffff" opacity="0.13" transform="rotate(-24 17.5 13.5)" />
    </svg>
  );
}
