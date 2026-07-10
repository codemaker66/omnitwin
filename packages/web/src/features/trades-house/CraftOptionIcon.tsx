import { useId, type ReactElement } from "react";

const ICON_PATHS = {
  hammer: ["M6.5 4.5h11v4.4h-11z", "M12 8.9v11.6", "M9.5 20.5h5"],
  shears: ["M6.5 17.5a2.4 2.4 0 1 0 0 .01", "M17.5 17.5a2.4 2.4 0 1 0 0 .01", "M8.4 15.7 19 4.5", "M15.6 15.7 5 4.5"],
  barley: ["M12 21V7", "M12 11c-2.4-.3-4-2-4-4.4 2.4.3 4 2 4 4.4z", "M12 11c2.4-.3 4-2 4-4.4-2.4.3-4 2-4 4.4z", "M12 16c-2.4-.3-4-2-4-4.4 2.4.3 4 2 4 4.4z", "M12 16c2.4-.3 4-2 4-4.4-2.4.3-4 2-4 4.4z"],
  leaf: ["M12 21V9", "M12 13c-4 0-7-3-7-6.5 4 0 7 3 7 6.5z", "M12 11.5c4 0 7-3 7-6.5-4 0-7 3-7 6.5z"],
  portico: ["M4 9l8-4.5L20 9", "M6.5 9v11", "M12 9v11", "M17.5 9v11", "M4.5 20h15"],
  goblet: ["M7 4h10l-.8 4.6a4.3 4.3 0 0 1-8.4 0z", "M12 13v5.5", "M8.5 20.5h7"],
  shuttle: ["M2.5 12C6 8 18 8 21.5 12 18 16 6 16 2.5 12Z", "M8 12h8"],
  boot: ["M3 17h2l1.3-7h3l1 3c3.2 1 6 1.2 9.4 2.2 1.8.6 1.6 3-.4 3H4c-1 0-1.2-.7-1-1.2z"],
  banner: ["M6 21.5V4", "M6 1.7l1.5 2.4h-3z", "M6 5.8h12.3l-3.1 3.6 3.1 3.6H6z", "M4.3 21.5h3.4"],
  oven: ["M4 18.5v-5a8 8 0 0 1 16 0v5", "M2.8 18.5h18.4", "M9.2 18.5v-2.6a2.8 2.8 0 0 1 5.6 0v2.6", "M12 5.6V3", "M5.5 21.2h13"],
  anvil: ["M3 6.5h9.6c3.3 0 5.9-1.1 7.4-3.2 0 3.8-2.7 6.4-6.7 6.4H10", "M10 9.7 8.4 13.2h7.2L14.1 9.7", "M8.4 13.2 6.6 17.6h10.8l-1.8-4.4", "M5.2 20h13.6"],
  comb: ["M5 6.8h14v3.4H5z", "M7 10.2v6", "M9.5 10.2v7.2", "M12 10.2v7.8", "M14.5 10.2v7.2", "M17 10.2v6"],
  stairs: ["M3 20.5h4.2v-4.2h4.2v-4.2h4.2V7.9h4.4", "M4.8 16.5 16.5 4.8", "M7.3 16.2v-2.6", "M11.5 12v-2.6", "M15.7 7.8v-2.6"],
  rook: ["M6.3 21v-9.8L4.8 9.4V5.2h2.5v1.9h2.2V5.2h5v1.9h2.2V5.2h2.5v4.2l-1.5 2V21", "M10 21v-3.8a2 2 0 0 1 4 0V21", "M4.6 21h14.8"],
  table: ["M3 9h18", "M6.3 9 4.7 17.6", "M17.7 9l1.6 8.6", "M6 13.4h12"],
  cloche: ["M5 15.5a7 7 0 0 1 14 0", "M3.5 15.5h17", "M12 8.4V7", "M10.6 7h2.8", "M7.5 18.5h9"],
  candelabra: ["M12 21v-6.5", "M9.2 21h5.6", "M12 14.5c-3.6 0-6.5-2.3-6.5-5.2", "M12 14.5c3.6 0 6.5-2.3 6.5-5.2", "M5.5 9.3V6.6", "M18.5 9.3V6.6", "M12 8.6V5.9", "M5.5 5.2c.7-.8-.3-1.5.2-2.4", "M18.5 5.2c.7-.8-.3-1.5.2-2.4", "M12 4.5c.7-.8-.3-1.5.2-2.4"],
  dome: ["M4.5 19.5h15", "M6.8 19.5v-1.4c0-4.2 2.3-7.2 5.2-7.2s5.2 3 5.2 7.2v1.4", "M9.4 19.5v-5", "M14.6 19.5v-5", "M12 10.9V6.6", "M10.7 8.2h2.6"],
  ladder: ["M8 3.5v17", "M16 3.5v17", "M8 7.5h8", "M8 12h8", "M8 16.5h8"],
  pot: ["M4.5 10.5h15", "M6 10.5c-.3 5 1.8 9 6 9s6.3-4 6-9", "M3 8.2 4.5 10.5", "M21 8.2 19.5 10.5", "M9.5 7.3c.6-1-.6-1.7 0-2.8", "M14.5 7.3c.6-1-.6-1.7 0-2.8"],
  compass: ["M12 5.2 7.2 19.5", "M12 5.2l4.8 14.3", "M12 2.3a1.5 1.5 0 1 0 .01 3 1.5 1.5 0 0 0-.01-3z", "M8.8 14.2c2 1 4.4 1 6.4 0"],
  hourglass: ["M6.5 3.5h11", "M6.5 20.5h11", "M8 3.5v2.8c0 2.7 4 4 4 5.7s-4 3-4 5.7v2.8", "M16 3.5v2.8c0 2.7-4 4-4 5.7s4 3 4 5.7v2.8"],
  loaf: ["M4.5 12.5c-1.4-2.7.6-5.6 3.4-5.4C9 5.6 10.4 5 12 5s3 .6 4.1 2.1c2.8-.2 4.8 2.7 3.4 5.4V19a1.4 1.4 0 0 1-1.4 1.4H5.9A1.4 1.4 0 0 1 4.5 19z", "M9.4 9.8 8.2 12.6", "M13.2 9.8 12 12.6", "M17 9.8l-1.2 2.8"],
  candle: ["M9.8 12h4.4v8H9.8z", "M7.5 20h9", "M12 12v-1.6", "M12 9.6c1.1-1 .55-2.4 0-3.2-.55.8-1.1 2.2 0 3.2z"],
  spool: ["M7 4.5h10", "M7 19.5h10", "M8.7 4.5v15", "M15.3 4.5v15", "M8.7 8.3h6.6", "M8.7 11.5h6.6", "M8.7 14.7h6.6", "M15.3 16.5l4.2 2"],
  drape: ["M4.5 5h15", "M7 5v12.6l2.5-1.9 2.5 1.9 2.5-1.9 2.5 1.9V5", "M12 2.6V5"],
  key: ["M8 6.8a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z", "M11.6 10.4h9", "M17.2 10.4v3.1", "M20.2 10.4v2.3"],
  vice: ["M5.5 8h13v2.6h-13z", "M7 13.6h10v2.6H7z", "M12 10.6v3", "M12 16.2v2.6", "M9.3 18.8h5.4"],
  scales: ["M12 3.8V19", "M9 19.5h6", "M4.8 6.2h14.4", "M4.8 6.2 3 10.6h3.6z", "M2.9 10.6a2 2 0 0 0 3.8 0", "M19.2 6.2 21 10.6h-3.6z", "M17.3 10.6a2 2 0 0 0 3.8 0"],
  hat: ["M8 13.8V6.8h8v7", "M8 6.8c1.2-.9 6.8-.9 8 0", "M8 10.8h8", "M4.5 13.8c2.5 1.3 12.5 1.3 15 0"],
  spade: ["M12 3.2c2.9 2 4.6 4.2 4.6 6.3 0 2.3-2 4-4.6 4s-4.6-1.7-4.6-4c0-2.1 1.7-4.3 4.6-6.3z", "M12 13.5v7.3", "M9.4 20.8h5.2"],
  needle: ["M4.5 19.5 16.9 7.1", "M19 5a2 2 0 1 0-2.1 2.1", "M19.4 4.6c2 2.4 1 5.4-1.7 6.1-2.4.6-3.3 2.7-2 4.9"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

type IconKey = keyof typeof ICON_PATHS;

function pathsForIcon(icon: string): readonly string[] {
  return Object.hasOwn(ICON_PATHS, icon) ? ICON_PATHS[icon as IconKey] : ICON_PATHS.hammer;
}

interface CraftOptionIconProps {
  readonly icon: string;
}

export function CraftOptionIcon({ icon }: CraftOptionIconProps): ReactElement {
  const gradientId = `craft-gold-${useId().replaceAll(":", "")}`;
  const paths = pathsForIcon(icon);

  return (
    <svg className="craft-option-icon" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6e3b1" />
          <stop offset="55%" stopColor="#d3a85c" />
          <stop offset="100%" stopColor="#a5762e" />
        </linearGradient>
      </defs>
      {paths.map((path, index) => (
        <path key={`shadow-${String(index)}`} d={path} stroke="rgba(15,9,2,.6)" strokeWidth="2.4" transform="translate(.5 .7)" />
      ))}
      {paths.map((path, index) => (
        <path key={`main-${String(index)}`} d={path} stroke={`url(#${gradientId})`} strokeWidth="1.6" />
      ))}
      {paths.map((path, index) => (
        <path key={`highlight-${String(index)}`} d={path} stroke="rgba(255,247,226,.45)" strokeWidth=".45" transform="translate(-.25 -.35)" />
      ))}
    </svg>
  );
}
