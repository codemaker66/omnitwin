// -----------------------------------------------------------------------------
// far-bank-geometry — the burgh on the far bank, authored point by point.
//
// A Lowland burgh seen from the water at Lammas dusk: crow-stepped gables, a
// tolbooth steeple, a squat kirk tower, a doocot, thatched cottages at the
// edges, chimney stacks, a stand of trees where the town thins to shore. No
// structure repeats: every gable has its own step count and pitch, every
// ridge its own stacks. The skyline is one polyline from the west shore to
// the east, which is also the ink layer's path. Heights are small against
// the frame on purpose: the town is wide and low and the sky is the size of
// the thing you came four hundred miles to stand under.
//
// Provenance: Pr. Reference only, no pixels: Slezer's Theatrum Scotiae
// prospects of Stirling, Culross and Dundee (NLS) for the massing of a gated
// river burgh. Drawn by code, 2026-09-06.
// -----------------------------------------------------------------------------
import {
  RIVER_GATE_HORIZON_Y,
  byteLength,
  handDrawn,
  polylinePath,
  silhouettePath,
  type ViewBoxPoint,
} from "./viewbox.js";

const p = (x: number, y: number): ViewBoxPoint => ({ x, y });

/** The quay top, where the town stands. */
export const FAR_BANK_QUAY_Y = 513;
/** The silhouette is filled past the waterline so the Lantern's water meets it without a seam. */
export const FAR_BANK_FLOOR_Y = RIVER_GATE_HORIZON_Y + 10;

/** The skyline, west to east. Comments name what each run is. */
export const FAR_BANK_SKYLINE: readonly ViewBoxPoint[] = [
  // The west shore: low land and a stand of trees
  p(0, 512), p(30, 511), p(58, 510), p(92, 510), p(118, 507),
  p(132, 501), p(144, 494), p(158, 490), p(171, 493), p(183, 499), p(193, 506), p(206, 509),
  // A thatched cottage, low, its ridge rounded
  p(209, 509), p(210, 498), p(216, 491), p(228, 486), p(242, 485), p(253, 488), p(259, 495), p(261, 509),
  p(271, 510), p(283, 509),
  // A second cottage with a stack at its east end
  p(285, 509), p(286, 494), p(293, 486), p(307, 482), p(322, 484), p(332, 490), p(335, 497),
  p(336, 480), p(341, 480), p(342, 499), p(345, 509),
  p(353, 510),
  // The granary: a crow-stepped gable to the water, seven steps up, five down, a lower range beside it
  p(361, 510), p(362, 478), p(362, 470), p(369, 470), p(369, 462), p(376, 462), p(376, 454), p(383, 454),
  p(383, 446), p(390, 446), p(392, 442), p(394, 446), p(401, 446), p(401, 454), p(408, 454), p(408, 462),
  p(415, 462), p(415, 470), p(422, 470), p(422, 478),
  p(424, 486), p(431, 484), p(452, 485), p(465, 487), p(466, 478), p(471, 478), p(471, 490), p(474, 510),
  p(482, 511),
  // A tenement with a long roof and one stack on the ridge
  p(491, 511), p(492, 470), p(505, 458), p(510, 456), p(522, 455), p(522, 447), p(529, 447), p(529, 455),
  p(548, 455), p(556, 468), p(558, 470), p(560, 510),
  // A taller tenement, crow-stepped, four narrow steps west and three broad ones east
  p(562, 510), p(562, 470), p(562, 462), p(569, 462), p(569, 454), p(576, 454), p(576, 446), p(583, 446),
  p(583, 438), p(590, 438), p(592, 436), p(594, 438), p(603, 438), p(603, 449), p(612, 449), p(612, 460),
  p(621, 460), p(621, 470), p(622, 510),
  p(630, 511),
  // The kirk: a squat tower under a low cap, the nave east of it
  p(641, 511), p(642, 448), p(647, 446), p(654, 441), p(664, 434), p(674, 441), p(681, 446), p(685, 448),
  p(686, 462), p(692, 460), p(716, 459), p(736, 460), p(744, 470), p(747, 476), p(749, 511),
  p(756, 512),
  // A narrow house hard by the port
  p(761, 512), p(762, 488), p(767, 482), p(776, 480), p(781, 484), p(783, 490),
  // The Water Port's wall: low, plain, the arch cut in it at the waterline (drawn apart)
  p(786, 492), p(800, 491), p(814, 491), p(820, 492), p(822, 494), p(822, 512),
  // The quay between the port and the tolbooth; the lantern's standard stands here
  p(830, 513), p(837, 512),
  // The tolbooth: its steeple at the west end, the body running east
  p(838, 512), p(839, 464), p(842, 461), p(846, 461), p(846, 398), p(843, 396), p(843, 392), p(847, 390),
  p(853, 366), p(858, 344), p(860, 332), p(860, 324), p(862, 324), p(862, 332), p(864, 344), p(869, 366),
  p(875, 390), p(879, 392), p(879, 396), p(876, 398), p(876, 461), p(880, 458), p(918, 459), p(920, 464),
  p(921, 512),
  p(929, 512),
  // A tenement crow-stepped on the west, a plain slope east, the stack on the apex
  p(937, 512), p(938, 470), p(938, 464), p(944, 464), p(944, 458), p(950, 458), p(950, 452), p(956, 452),
  p(956, 446), p(962, 446), p(962, 440), p(968, 440), p(968, 429), p(974, 429), p(974, 439), p(976, 441),
  p(984, 452), p(996, 466), p(998, 470), p(999, 512),
  // A house with two stacks on a long ridge
  p(1001, 512), p(1002, 478), p(1008, 472), p(1014, 470), p(1020, 470), p(1020, 462), p(1026, 462),
  p(1026, 470), p(1044, 469), p(1046, 469), p(1046, 461), p(1052, 461), p(1052, 469), p(1056, 470),
  p(1060, 476), p(1062, 480), p(1063, 512),
  p(1070, 513),
  // The merchant's house: hipped, a dormer and a stack
  p(1077, 512), p(1078, 476), p(1090, 466), p(1098, 462), p(1102, 460), p(1108, 460), p(1110, 455),
  p(1116, 455), p(1118, 460), p(1122, 459), p(1122, 452), p(1128, 452), p(1128, 459), p(1130, 459),
  p(1140, 464), p(1150, 476), p(1151, 512),
  // The doocot, beehive-shaped, a small cap on top
  p(1156, 512), p(1157, 496), p(1160, 486), p(1165, 478), p(1169, 474), p(1169, 470), p(1171, 470),
  p(1171, 474), p(1175, 478), p(1180, 486), p(1183, 496), p(1184, 512),
  p(1192, 512),
  // A cottage at the town's east end
  p(1202, 512), p(1203, 498), p(1210, 490), p(1224, 486), p(1240, 488), p(1248, 494), p(1250, 500), p(1251, 512),
  // Trees between the last houses
  p(1256, 510), p(1262, 502), p(1270, 497), p(1280, 495), p(1290, 498), p(1298, 505), p(1304, 510),
  // The last cottage, a stack at its east end
  p(1306, 512), p(1307, 500), p(1314, 493), p(1326, 490), p(1338, 492), p(1344, 499), p(1344, 490),
  p(1348, 490), p(1348, 502), p(1350, 512),
  // The east shore falling away
  p(1360, 512), p(1380, 510), p(1400, 509), p(1414, 504), p(1424, 498), p(1436, 494), p(1450, 495),
  p(1462, 500), p(1472, 506), p(1486, 509), p(1520, 510), p(1560, 511), p(1600, 512),
];

const drawnSkyline = handDrawn(FAR_BANK_SKYLINE, 22, 0.55, 1);

/** The burgh as one filled silhouette down past the waterline. */
export const FAR_BANK_SILHOUETTE_PATH = silhouettePath(drawnSkyline, FAR_BANK_FLOOR_Y);
/** The same skyline as an open stroke: the ink layer draws this. */
export const FAR_BANK_OUTLINE_PATH = polylinePath(drawnSkyline);
export const FAR_BANK_OUTLINE_POINTS = drawnSkyline.length;

/** The quay face, a hair lighter than the town so the shore reads against the water. */
export const FAR_BANK_QUAY_PATH = silhouettePath(
  handDrawn([p(0, FAR_BANK_QUAY_Y), p(1600, FAR_BANK_QUAY_Y)], 40, 0.7, 7),
  FAR_BANK_FLOOR_Y,
);

export interface BurghWindow {
  readonly x: number;
  readonly y: number;
  /** 0..1, how much of the amber the window lets out; the water reflects in proportion. */
  readonly glow: number;
}

export const WINDOW_WIDTH = 2.6;
export const WINDOW_HEIGHT = 3.4;

/** Fifteen windows lit for the evening, most on the low floors near the water. Each is a StageLight. */
export const FAR_BANK_WINDOWS: readonly BurghWindow[] = [
  { x: 233, y: 499, glow: 0.7 },
  { x: 309, y: 497, glow: 0.8 },
  { x: 446, y: 499, glow: 0.6 },
  { x: 513, y: 481, glow: 0.75 },
  { x: 541, y: 496, glow: 0.85 },
  { x: 588, y: 490, glow: 0.7 },
  { x: 724, y: 486, glow: 0.55 },
  { x: 771, y: 498, glow: 0.8 },
  { x: 858, y: 438, glow: 0.6 },
  { x: 890, y: 479, glow: 0.75 },
  { x: 906, y: 496, glow: 0.85 },
  { x: 966, y: 492, glow: 0.7 },
  { x: 1031, y: 494, glow: 0.8 },
  { x: 1113, y: 486, glow: 0.65 },
  { x: 1325, y: 501, glow: 0.75 },
];

/** The Water Port: a small dark mouth in the wall at the waterline, dead centre. */
export const WATER_PORT = { x: 800, top: 496, halfWidth: 11 } as const;
export const WATER_PORT_PATH =
  "M 789.4 532 L 788.8 507 Q 789.6 495.8 800.3 496 Q 810.8 496.4 811.2 506.6 L 811.6 532 Z";

/** Where the port wall catches the lantern: two patches of lit stone, flat, no glow of their own. */
export const LIT_STONE_PATHS: readonly string[] = [
  "M 812.4 493.2 L 821.6 493.6 L 821.8 512.8 L 812.8 512.6 Z",
  "M 784.6 494 L 788.6 493.8 L 788.4 512.6 L 784.8 512.8 Z",
];

/**
 * The lantern. A standard rises from the wall top east of the arch, an arm
 * reaches out over the low quay, and the housing hangs from it against the
 * ember sky. The flame is the Lantern's (WebGL, beneath this plane), so the
 * housing is drawn with an evenodd hole where the flame sits, and the
 * hole's centre is the light the water reflects.
 */
export const LANTERN_FLAME: ViewBoxPoint = { x: 831, y: 479 };
export const LANTERN_STANDARD_PATH = "M 817.2 492.4 L 816.8 466.4";
export const LANTERN_ARM_PATH = "M 816.8 467 L 831.2 466.6";
export const LANTERN_BRACE_PATH = "M 817 475.6 L 826.4 467.2";
export const LANTERN_HANGER_PATH = "M 831.2 466.6 L 831 470.2";
export const LANTERN_HOUSING_PATH =
  "M 825 472.4 L 831 468.2 L 837 472.4 L 837.3 486.2 L 824.7 486.4 Z M 827.6 474.2 L 834.4 474.2 L 834.6 484.2 L 827.4 484.2 Z";

export const FAR_BANK_BYTES = byteLength(
  FAR_BANK_SILHOUETTE_PATH,
  FAR_BANK_OUTLINE_PATH,
  FAR_BANK_QUAY_PATH,
  WATER_PORT_PATH,
  ...LIT_STONE_PATHS,
  LANTERN_STANDARD_PATH,
  LANTERN_ARM_PATH,
  LANTERN_BRACE_PATH,
  LANTERN_HANGER_PATH,
  LANTERN_HOUSING_PATH,
);
