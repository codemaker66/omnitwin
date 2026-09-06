// -----------------------------------------------------------------------------
// NearBank — the foreground plane: the bank, the jetty and its piles, the
// mooring post, the traveller, and the three pokeables that live here: the
// port chain (a damped pendulum over the last poke), the toll box (lid,
// coin, coins, bolt, from its count) and the apple core (turns per poke,
// gone under from the fourth).
//
// Pure over SvgPlaneProps: every moving part is a transform or a discrete
// state computed from the props; the static drawing is hoisted so React
// reconciles only the three small groups per frame.
// Provenance: Pr, drawn by code, 2026-09-06.
// -----------------------------------------------------------------------------
import type { ReactElement } from "react";
import type { SvgPlaneProps } from "../../plane-registry.js";
import {
  APPLE_CORE_FLESH_PATH,
  APPLE_CORE_PATH,
  APPLE_CORE_STEM_PATH,
  BANK_EDGE_PATH,
  BANK_PATH,
  BANK_STONES,
  CHAIN_LINKS,
  CHAIN_PIVOT,
  DECK_EDGE_PATH,
  DECK_PATH,
  MOORING_POST_PATH,
  PILE_LENGTH,
  PILE_WIDTH,
  PILE_XS,
  TOLL_BOX_BODY_PATH,
  TOLL_BOX_BOLT_KNOB,
  TOLL_BOX_BOLT_PATH,
  TOLL_BOX_FIRST_COIN,
  TOLL_BOX_FRONT_EDGE_PATH,
  TOLL_BOX_INTERIOR_PATH,
  TOLL_BOX_LID_CLOSED_PATH,
  TOLL_BOX_LID_OPEN_PATH,
  TOLL_BOX_MORE_COINS,
  TRAVELLER,
  TRAVELLER_ARM_PATH,
  TRAVELLER_BAG_PATH,
  TRAVELLER_PATH,
  TRAVELLER_STICK_PATH,
  appleCorePose,
  deckTopAt,
  tollBoxState,
} from "./near-bank-geometry.js";
import { chainSwingAngleDeg } from "./pendulum.js";
import { PALETTE, PLANE_SVG_STYLE } from "./plane-style.js";
import { RIVER_GATE_PRESERVE_ASPECT, RIVER_GATE_VIEWBOX_ATTR } from "./viewbox.js";

const BANK_AND_JETTY = (
  <g data-bank="">
    <path d={BANK_PATH} fill={PALETTE.earth} />
    <path d={BANK_EDGE_PATH} fill="none" stroke={PALETTE.earthEdge} strokeWidth={1.2} strokeLinecap="round" />
    {BANK_STONES.map((stone) => (
      <ellipse key={`${String(stone.cx)}-${String(stone.cy)}`} cx={stone.cx} cy={stone.cy} rx={stone.rx} ry={stone.ry} fill={PALETTE.stone} />
    ))}
    <g data-piles="">
      {PILE_XS.map((x) => (
        <rect
          key={x}
          x={x - PILE_WIDTH / 2}
          y={deckTopAt(x) + 9}
          width={PILE_WIDTH}
          height={PILE_LENGTH}
          fill={PALETTE.ink}
          data-pile=""
        />
      ))}
    </g>
    <path d={DECK_PATH} fill={PALETTE.deck} data-deck="" />
    <path d={DECK_EDGE_PATH} fill="none" stroke={PALETTE.deckEdge} strokeWidth={1} strokeLinecap="round" />
    <path d={MOORING_POST_PATH} fill={PALETTE.ink} data-mooring-post="" />
  </g>
);

const TRAVELLER_FIGURE = (
  <g
    data-traveller=""
    transform={`translate(${String(TRAVELLER.x)} ${String(TRAVELLER.baseY - 45)})`}
    fill={PALETTE.ink}
    stroke="none"
  >
    <path d={TRAVELLER_STICK_PATH} fill="none" stroke={PALETTE.ink} strokeWidth={1.2} strokeLinecap="round" />
    <path d={TRAVELLER_BAG_PATH} />
    <path d={TRAVELLER_PATH} />
    <path d={TRAVELLER_ARM_PATH} />
  </g>
);

const CHAIN = (
  <g data-chain-links="">
    {CHAIN_LINKS.map((link) =>
      link.faceOn ? (
        <ellipse
          key={link.cy}
          cx={CHAIN_PIVOT.x}
          cy={link.cy}
          rx={link.rx}
          ry={link.ry}
          fill="none"
          stroke={PALETTE.ink}
          strokeWidth={1.4}
          opacity={link.submerged ? 0.45 : 1}
          data-chain-link=""
        />
      ) : (
        <ellipse
          key={link.cy}
          cx={CHAIN_PIVOT.x}
          cy={link.cy}
          rx={link.rx}
          ry={link.ry}
          fill={PALETTE.ink}
          opacity={link.submerged ? 0.45 : 1}
          data-chain-link=""
        />
      ),
    )}
  </g>
);

const APPLE_CORE_SHAPE = (
  <g data-apple-core-shape="">
    <path d={APPLE_CORE_STEM_PATH} fill="none" stroke={PALETTE.core} strokeWidth={0.8} strokeLinecap="round" />
    <path d={APPLE_CORE_PATH} fill={PALETTE.core} />
    <path d={APPLE_CORE_FLESH_PATH} fill={PALETTE.coreFlesh} opacity={0.8} />
  </g>
);

const MORE_COINS = TOLL_BOX_MORE_COINS.map((coin) => (
  <ellipse key={`${String(coin.cx)}-${String(coin.cy)}`} cx={coin.cx} cy={coin.cy} rx={coin.rx} ry={coin.ry} fill={PALETTE.coin} opacity={0.9} data-coin="" />
));

const FIRST_COIN = (
  <ellipse
    cx={TOLL_BOX_FIRST_COIN.cx}
    cy={TOLL_BOX_FIRST_COIN.cy}
    rx={TOLL_BOX_FIRST_COIN.rx}
    ry={TOLL_BOX_FIRST_COIN.ry}
    fill={PALETTE.coin}
    opacity={0.9}
    data-coin=""
  />
);

function TollBox({ count }: { readonly count: number }): ReactElement {
  const state = tollBoxState(count);
  const open = state === "open" || state === "coin" || state === "coins";
  return (
    <g data-prop="toll-box" data-state={state}>
      <path d={TOLL_BOX_BODY_PATH} fill={PALETTE.box} />
      {open ? <path d={TOLL_BOX_INTERIOR_PATH} fill={PALETTE.boxInterior} data-toll-interior="" /> : null}
      {state === "coin" ? FIRST_COIN : null}
      {state === "coins" ? FIRST_COIN : null}
      {state === "coins" ? MORE_COINS : null}
      <path d={TOLL_BOX_FRONT_EDGE_PATH} fill="none" stroke={PALETTE.boxEdge} strokeWidth={0.8} />
      {open ? (
        <path d={TOLL_BOX_LID_OPEN_PATH} fill={PALETTE.boxLid} data-toll-lid="open" />
      ) : (
        <path d={TOLL_BOX_LID_CLOSED_PATH} fill={PALETTE.boxLid} data-toll-lid="closed" />
      )}
      {state === "bolted" ? (
        <g data-toll-bolt="">
          <path d={TOLL_BOX_BOLT_PATH} fill={PALETTE.bolt} />
          <circle cx={TOLL_BOX_BOLT_KNOB.cx} cy={TOLL_BOX_BOLT_KNOB.cy} r={TOLL_BOX_BOLT_KNOB.r} fill={PALETTE.boltKnob} />
        </g>
      ) : null}
    </g>
  );
}

export function NearBank({ pokes, nowMs, reducedMotion, persisted }: SvgPlaneProps): ReactElement {
  const chain = pokes["port-chain"];
  const persistedSwing = persisted["chainSwing"];
  // The pokes store carries the poke; the persisted fact carries it across a return to the scene.
  const lastChainPokeMs = chain?.lastPokeMs ?? (typeof persistedSwing === "number" ? persistedSwing : null);
  const chainAngle = chainSwingAngleDeg(lastChainPokeMs, nowMs, reducedMotion);
  const core = appleCorePose(pokes["apple-core"]?.count ?? 0, nowMs, reducedMotion);

  return (
    <svg
      className="stage-plane-svg stage-plane-svg--near-bank"
      viewBox={RIVER_GATE_VIEWBOX_ATTR}
      preserveAspectRatio={RIVER_GATE_PRESERVE_ASPECT}
      aria-hidden="true"
      focusable="false"
      style={PLANE_SVG_STYLE}
      data-plane="near-bank"
    >
      {core.visible ? (
        <g
          data-prop="apple-core"
          transform={`translate(${core.x.toFixed(2)} ${core.y.toFixed(2)}) rotate(${core.rotateDeg.toFixed(2)})`}
        >
          {APPLE_CORE_SHAPE}
        </g>
      ) : null}
      {BANK_AND_JETTY}
      <TollBox count={pokes["toll-box"]?.count ?? 0} />
      {TRAVELLER_FIGURE}
      <g
        data-prop="port-chain"
        data-swinging={chainAngle !== 0 ? "true" : "false"}
        transform={`rotate(${chainAngle.toFixed(2)} ${String(CHAIN_PIVOT.x)} ${String(CHAIN_PIVOT.y)})`}
      >
        {CHAIN}
      </g>
    </svg>
  );
}
