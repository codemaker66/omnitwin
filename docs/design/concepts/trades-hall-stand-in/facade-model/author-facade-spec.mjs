import { readFileSync, writeFileSync } from "node:fs";

const specPath = new URL("./object-sculpt-spec.json", import.meta.url);
const inventoryPath = new URL("./detail-inventory.json", import.meta.url);
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));

const clone = (value) => JSON.parse(JSON.stringify(value));
const componentSeed = clone(spec.componentTree[0]);
const materialSeed = clone(spec.materials[0]);

const materialRecipes = {
  "facade-stone": {
    dominantAlbedo: "rgba(184, 165, 126, 1.0)",
    secondaryAlbedo: "rgba(122, 108, 82, 1.0)",
    materialClass: "stone",
    materialClassConfidence: 0.92,
  },
  "rusticated-stone": {
    dominantAlbedo: "rgba(151, 137, 108, 1.0)",
    secondaryAlbedo: "rgba(93, 83, 68, 1.0)",
    materialClass: "stone",
    materialClassConfidence: 0.9,
  },
  "dark-glass": {
    dominantAlbedo: "rgba(23, 31, 35, 1.0)",
    secondaryAlbedo: "rgba(91, 111, 116, 1.0)",
    materialClass: "glass",
    materialClassConfidence: 0.88,
  },
  "timber-door": {
    dominantAlbedo: "rgba(52, 37, 27, 1.0)",
    secondaryAlbedo: "rgba(91, 65, 43, 1.0)",
    materialClass: "wood",
    materialClassConfidence: 0.88,
  },
  "dome-copper": {
    dominantAlbedo: "rgba(105, 151, 135, 1.0)",
    secondaryAlbedo: "rgba(55, 92, 82, 1.0)",
    materialClass: "metal",
    materialClassConfidence: 0.86,
  },
};

function feature(id, type, placement, geometryEffect, confidence = 0.9) {
  return {
    id,
    type,
    placement,
    size: "reference-relative; preserve legibility at the fixed facade review view",
    orientation: "follows the observed architectural axis or curve",
    materialEffect: "cavity AO and grazing-light response remain separate from albedo",
    geometryEffect,
    confidence,
    evidenceRef: "full-object",
  };
}

function attachment(parentId) {
  return {
    parentId,
    parentSocket: `${parentId}:facade-surface`,
    localStart: [0, -0.5, 0],
    localEnd: [0, 0.5, 0],
    contactType: "embedded architectural joint",
    embedDepth: 0.04,
    overlap: 0.04,
    gapTolerance: 0.01,
    notes: "Presentation-only assembly seam; no metric claim.",
  };
}

function component({
  id,
  name,
  level,
  role,
  primitive,
  material,
  position,
  scale,
  parent = "root",
  topologyClass = "assembled-solid",
  topologyRationale,
  localFeatures = [],
  profile2D,
  importance = 0.8,
}) {
  const node = clone(componentSeed);
  node.id = id;
  node.name = name;
  node.level = level;
  node.role = role;
  node.importance = importance;
  node.confidence = 0.84;
  node.primitive = primitive;
  node.topologyClass = topologyClass;
  node.topologyRationale = topologyRationale;
  node.parent = parent;
  node.attachment = primitive === "cylinder" || primitive === "cone" || primitive === "capsule" || primitive === "tube"
    ? attachment(parent)
    : null;
  node.dimensions = {
    width: scale[0],
    height: scale[1],
    depth: scale[2],
    units: "relative presentation units",
    confidence: 0.75,
  };
  node.transform = { position, rotation: [0, 0, 0], scale };
  node.geometryDescriptor.topologyIntent = topologyRationale;
  node.geometryDescriptor.edgeTreatment = {
    type: "chamfer",
    bevelRadius: level === "macro" ? 0.025 : 0.018,
    segments: 2,
  };
  node.geometryDescriptor.uvStrategy = "world-scale procedural coordinates; no photographic projection";
  node.geometryDescriptor.normalStrategy = "smooth only on curved profiles; weighted hard edges on masonry";
  node.geometryDescriptor.deformationStack = [];
  if (profile2D) {
    node.geometryDescriptor.profile2D = profile2D;
  } else {
    delete node.geometryDescriptor.profile2D;
  }
  node.actionProfile.animationRole = "static-part";
  node.actionProfile.pivot = {
    mode: "component-center",
    localPosition: [0, 0, 0],
    axis: [0, 1, 0],
    confidence: 0.9,
  };
  node.actionProfile.sockets = [];
  node.actionProfile.collider = {
    type: "box",
    offset: [0, 0, 0],
    scale: [1, 1, 1],
    isTrigger: true,
    notes: "Presentation-only pick proxy; excluded from venue planning collision.",
  };
  node.actionProfile.destruction = {
    breakable: false,
    fractureGroup: id,
    seamRefs: [],
    detachableFragments: [],
    breakImpulse: 0,
    debrisMaterial: material,
  };
  node.material = material;
  node.materialLayers = [material];
  node.localFeatures = localFeatures;
  node.surfaceDetail = {
    macroRoughness: material.includes("stone") ? 0.22 : 0.08,
    microRoughness: material.includes("stone") ? 0.16 : 0.06,
    bumpAmplitude: material.includes("stone") ? 0.035 : 0.012,
    normalPattern: material.includes("stone") ? "independent sandstone grain" : "material-specific independent field",
    displacementPattern: "none; silhouette relief is geometry",
    occlusionPattern: "contact and cavity AO only",
    edgeWearPattern: "subtle exposed high points",
    notes: "Reference-guided response, not measured or photo-projected.",
  };
  node.evidenceRefs = ["full-object"];
  node.details = localFeatures.map((item) => item.id);
  node.fidelityTier = level === "macro" ? "blockout" : level === "meso" ? "structural" : "surface";
  node.colorMaterialRecipe = materialRecipes[material] ?? materialRecipes["facade-stone"];
  return node;
}

function material({ id, name, color, secondary, roughness, metalness, qualityTier = "utility", localOverrides = [], referencePbr }) {
  const value = clone(materialSeed);
  delete value.opacity;
  delete value.transmission;
  delete value.referencePbr;
  value.id = id;
  value.name = name;
  value.type = id === "dark-glass" ? "physical" : "standard";
  value.shaderModel = id === "dark-glass" ? "MeshPhysicalMaterial" : "MeshStandardMaterial";
  value.baseColor = color;
  value.color = color;
  value.albedo = {
    dominant: color,
    secondary: [secondary],
    samplingNotes: "Palette is bounded by the locally decoded real facade photo; no synthesized image is treated as albedo.",
  };
  value.colorVariation = {
    palette: [color, secondary],
    pattern: id.includes("stone") ? "low-frequency sandstone mottle" : "bounded material variation",
    amplitude: id.includes("stone") ? 0.12 : 0.05,
    heightCorrelation: id.includes("stone") ? 0.28 : 0.08,
  };
  value.qualityTier = qualityTier;
  value.textureResolution = qualityTier === "reference" ? 1024 : 512;
  value.textureProjection = {
    mode: "object-space procedural",
    repeat: [2, 2],
    anisotropy: 8,
    texelDensityIntent: "Stable world-scale detail with exterior LOD gating; never stretch a facade photograph.",
  };
  value.surfaceFrequencyBands = [
    { id: "macro", frequency: 2, amplitude: 0.18, role: "broad regional value variation" },
    { id: "meso", frequency: 14, amplitude: 0.1, role: "stone blocks, grain, patina, or wood figure" },
    { id: "micro", frequency: 58, amplitude: 0.035, role: "grazing-light highlight breakup" },
  ];
  value.roughness = {
    base: roughness,
    variation: id.includes("stone") ? 0.14 : 0.08,
    map: `independent-${id}-roughness-field`,
    localResponse: "rougher cavities and weathered zones; slightly smoother exposed edges",
  };
  value.metalness = { base: metalness, variation: id === "dome-copper" ? 0.08 : 0 };
  value.normal = {
    pattern: `independent-${id}-height-derived-normal`,
    strength: id.includes("stone") ? 0.32 : 0.16,
    scale: id.includes("stone") ? 28 : 18,
    space: "tangent",
  };
  value.bump = { pattern: `independent-${id}-micro-height`, amplitude: id.includes("stone") ? 0.025 : 0.01, scale: 1 };
  value.displacement = { pattern: "none", amplitude: 0, scale: 1, silhouetteAffects: false };
  value.ambientOcclusion = {
    cavityStrength: id.includes("stone") ? 0.32 : 0.18,
    contactShadowBias: 0.35,
    map: `independent-${id}-ao-field`,
    notes: "Only creases, joints, and contacts darken; no uniform baked shadow.",
  };
  value.wear = { edgeWear: id.includes("stone") ? 0.06 : 0.03, scratches: [], chips: [] };
  value.dirt = { amount: id.includes("stone") ? 0.08 : 0.03, cavityBias: 0.7, color: "#342E25" };
  value.localOverrides = localOverrides;
  value.shaderNotes = [
    "Albedo, roughness, normal/height, and AO are independent signals.",
    "Reference-photo pixels are not loaded as runtime textures.",
    "The exterior asset is presentation context and may be omitted in lean/mobile mode.",
  ];
  value.notes = "Synthetic stand-in material; reference-guided and relightable, not an inverse-rendered claim.";
  if (id === "dark-glass") {
    value.transmission = { base: 0.18 };
    value.opacity = { base: 0.72 };
  }
  if (referencePbr) value.referencePbr = referencePbr;
  return value;
}

const pbrReport = JSON.parse(readFileSync(new URL("./material-evidence/facade-stone-report.json", import.meta.url), "utf8"));
const stoneReferencePbr = {
  version: "1",
  sourceImage: "material-evidence/facade-stone-crop.png",
  extractor: "img2threejs/extract_pbr_evidence.py",
  method: "reference-pixel evidence; not exact inverse rendering",
  verdict: pbrReport.verdict,
  hardLimit: pbrReport.limitation,
  usable: true,
  confidence: pbrReport.confidence,
  estimatedFidelity: pbrReport.estimatedFidelity,
  targetThreshold: pbrReport.targetThreshold,
  maps: Object.fromEntries(Object.entries(pbrReport.maps).map(([channel, entry]) => [channel, {
    url: `material-evidence/facade-stone/facade-stone_${channel}.png`,
    channel: entry.channel,
    source: entry.source,
  }])),
};

const facadeStoneOverrides = [
  {
    id: "rain-streaking",
    region: "below parapet and cornice joints",
    dirtAmount: 0.12,
    cavityBias: 0.65,
    streak: { enabled: true, direction: [0, -1] },
    evidenceRef: "full-object",
  },
  {
    id: "ground-contact-stain",
    region: "lowest three percent of the rusticated base",
    dirtAmount: 0.2,
    cavityBias: 0.8,
    streak: { enabled: false, direction: [0, -1] },
    evidenceRef: "full-object",
  },
];

const copperOverrides = [
  {
    id: "vertical-patina",
    region: "between dome ribs and around the cupola seam",
    dirtAmount: 0.05,
    cavityBias: 0.75,
    streak: { enabled: true, direction: [0, -1] },
    patinaColor: "#6B9D8B",
    evidenceRef: "full-object",
  },
];

spec.targetName = "Trades Hall facade stand-in";
spec.targetId = "trades-hall-facade-stand-in";
spec.sourceImage = "actual-facade-model-reference.png";
spec.suitability = "conditional";
spec.preSpecAssessment.sourceImage = "actual-facade-model-reference.png";
spec.preSpecAssessment.objectClass.notes = "Presentation-only shallow facade volume reconstructed from the repository's frontal photograph. It is not measured geometry or a complete building model.";
spec.preSpecAssessment.detailInventory = inventory.detailInventory;
spec.qualityContract.minimumSpecDepth = {
  macroComponents: 5,
  mesoComponents: 16,
  microFeatureGroups: 16,
  materialLayers: 5,
  repetitionSystems: 5,
  reviewViewpoints: 5,
};
spec.qualityTargets = {
  targetFidelity: 0.82,
  mustMatch: [
    "bilateral stepped silhouette",
    "three-tier masonry massing",
    "central four-column portico and pediment",
    "dominant arched-window rhythm",
    "copper dome and cupola",
  ],
  niceToHave: ["abstracted heraldic relief", "weathering variation"],
  reviewViewpoints: ["front", "three-quarter-left", "three-quarter-right", "low-grazing", "lean-lod"],
};
// The single-view limits are resolved by narrowing the deliverable to a shallow,
// non-metric presentation facade; the corresponding assumptions and risks below
// remain explicit rather than blocking implementation as open questions.
spec.preSpecAssessment.unknownsToResolveBeforeImplementation = [];
spec.featureReviewTargets = [
  {
    id: "trades-hall-stepped-massing",
    name: "Trades Hall stepped facade and roofline massing",
    tier: "critical",
    passIds: ["blockout"],
    minimumScore: 0.82,
    mustPass: true,
    componentRefs: ["facade-body", "rusticated-base", "sandstone-walls", "left-pavilion-mass", "right-pavilion-mass", "roof-crown"],
    evidenceRefs: ["full-object"],
  },
  {
    id: "four-column-portico",
    name: "Four-column portico, entablature, and pediment hierarchy",
    tier: "critical",
    passIds: ["structural-pass", "form-refinement"],
    minimumScore: 0.82,
    mustPass: true,
    componentRefs: ["central-portico", "portico-entablature", "central-pediment", "portico-columns", "column-left-outer", "column-left-inner", "column-right-inner", "column-right-outer"],
    evidenceRefs: ["full-object"],
  },
  {
    id: "arched-bay-rhythm",
    name: "Paired arched-window, central fanlight, and lower-opening rhythm",
    tier: "critical",
    passIds: ["structural-pass", "form-refinement"],
    minimumScore: 0.8,
    mustPass: true,
    componentRefs: ["arched-window-bays", "left-arched-window", "right-arched-window", "central-fanlight", "ground-floor-openings"],
    evidenceRefs: ["full-object"],
  },
  {
    id: "copper-dome-cupola",
    name: "Copper dome, radial ribs, cupola, oculus, and finial",
    tier: "critical",
    passIds: ["blockout", "form-refinement", "surface-pass"],
    minimumScore: 0.8,
    mustPass: true,
    componentRefs: ["dome-shell", "cupola", "dome-lantern"],
    evidenceRefs: ["full-object"],
  },
  {
    id: "weathered-stone-response",
    name: "Weathered sandstone, rustication, patina, and dark-glazing response",
    tier: "critical",
    passIds: ["material-pass", "surface-pass", "lighting-pass"],
    minimumScore: 0.76,
    mustPass: true,
    componentRefs: ["facade-body", "rusticated-base", "dome-shell", "arched-window-bays"],
    evidenceRefs: ["full-object"],
  },
];
spec.referenceCamera = {
  projection: "perspective",
  position: [18, 11, 22],
  target: [0, 5.5, 0],
  fov: 34,
  confidence: 0.7,
  notes: "Presentation camera inferred from the locally cropped frontal facade photograph; crop contains neighbouring-building context that is excluded from geometry.",
};
spec.silhouette = {
  boundingShape: "shallow, symmetric 16:13 facade volume with stepped pavilions and central dome",
  dominantCurves: ["arched first-floor bays", "low copper dome", "cupola oculus"],
  taper: "upper tiers step inward above the rusticated base",
  asymmetry: "weathering only; structural massing is treated as bilateral",
  negativeSpaces: ["window glazing", "entrance recess", "cupola oculus", "balustrade gaps"],
  confidence: 0.82,
};

const root = clone(componentSeed);
root.id = "root";
root.name = "Trades Hall facade presentation root";
root.level = "macro";
root.role = "container";
root.importance = 1;
root.confidence = 1;
root.primitive = "box";
root.topologyClass = "material-only";
root.topologyRationale = "The root is a non-rendering transform and selection container; visible architecture is separated below it.";
root.parent = null;
root.attachment = null;
root.dimensions = { width: 1, height: 1, depth: 1, units: "relative presentation units", confidence: 1 };
root.transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
root.actionProfile.animationRole = "root";
root.actionProfile.sockets = [{
  id: "facade-surface",
  localPosition: [0, 0, 0],
  localRotation: [0, 0, 0],
  accepts: ["static architectural presentation parts"],
}];
root.actionProfile.collider = { type: "box", offset: [0, 0, 0], scale: [1, 1, 1], isTrigger: true, notes: "Not used by planner collision." };
root.actionProfile.destruction.debrisMaterial = "invisible-root";
root.material = "invisible-root";
root.materialLayers = ["invisible-root"];
root.localFeatures = [];
root.evidenceRefs = ["full-object"];
delete root.colorMaterialRecipe;

const archProfile = {
  points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.12], [0.43, 0.31], [0.25, 0.45], [0, 0.5], [-0.25, 0.45], [-0.43, 0.31], [-0.5, 0.12]],
  depth: 0.18,
};
const pedimentProfile = { points: [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]], depth: 0.28 };

spec.componentTree = [
  root,
  component({ id: "facade-body", name: "Primary facade body", level: "macro", role: "mass", primitive: "box", material: "facade-stone", position: [0, 3.4, 0], scale: [16, 6.8, 1.2], topologyRationale: "The real frontal photograph shows a broad lower masonry body behind the narrower upper pavilions.", importance: 1 }),
  component({ id: "rusticated-base", name: "Rusticated ground-floor base", level: "macro", role: "mass", primitive: "box", material: "rusticated-stone", position: [0, 1.7, 0.38], scale: [16.2, 3.4, 1.48], topologyRationale: "Deep ashlar blocks and heavier ground-floor massing visibly project ahead of the upper wall.", localFeatures: [feature("rustication-joints", "recessed groove network", "full ground-floor band", "staggered horizontal and vertical grooves with cavity AO", 0.97), feature("plinth-chamfer", "bevel", "ground-contact edge", "real chamfer catches a low grazing highlight", 0.86)], importance: 1 }),
  component({ id: "sandstone-walls", name: "Central upper sandstone wall plane", level: "macro", role: "mass", primitive: "box", material: "facade-stone", position: [0, 5.35, 0.16], scale: [10.6, 4.3, 1.18], topologyRationale: "The central upper storey steps inward between two taller outer pavilions and overlaps the roof crown without a floating seam.", localFeatures: [feature("ashlar-joints", "panel line", "upper masonry plane", "shallow joint line and separate AO response", 0.93)], importance: 0.95 }),
  component({ id: "left-pavilion-mass", name: "Left upper pavilion mass", level: "macro", role: "mass", primitive: "box", material: "facade-stone", position: [-5.45, 6.55, 0.08], scale: [4.2, 3.65, 1.24], topologyRationale: "The left pavilion rises above the central wall and creates the first roofline step.", importance: 0.92 }),
  component({ id: "right-pavilion-mass", name: "Right upper pavilion mass", level: "macro", role: "mass", primitive: "box", material: "facade-stone", position: [5.45, 6.55, 0.08], scale: [4.2, 3.65, 1.24], topologyRationale: "The right pavilion mirrors the left and completes the stepped bilateral silhouette.", importance: 0.92 }),
  component({ id: "roof-crown", name: "Stepped central roof crown", level: "macro", role: "mass", primitive: "box", material: "facade-stone", position: [0, 7.95, 0.05], scale: [7.2, 1.15, 1.2], topologyRationale: "The photograph shows a narrow central roof crown directly below the dome.", importance: 0.9 }),
  component({ id: "dome-shell", name: "Copper dome shell", level: "macro", role: "roof", primitive: "ellipsoid", material: "dome-copper", position: [0, 8.55, -0.65], scale: [3.65, 2.5, 2.35], topologyClass: "continuous-sculpt", topologyRationale: "The copper crown is a shallow rotational dome whose lower hemisphere is embedded behind the central roof crown, leaving a half-dome silhouette.", localFeatures: [feature("dome-ribs", "raised radial ribs", "full dome", "instanced ribs stand proud of the copper shell", 0.96)], importance: 1 }),
  component({ id: "central-portico", name: "Central portico recess", level: "meso", role: "assembly", primitive: "box", material: "facade-stone", position: [0, 5.65, 0.82], scale: [5.2, 4.4, 0.72], topologyRationale: "The central portico projects from the wall and frames a deep shadowed entrance bay.", importance: 1 }),
  component({ id: "portico-entablature", name: "Portico entablature", level: "meso", role: "beam", primitive: "box", material: "facade-stone", position: [0, 7.65, 1.2], scale: [5.7, 0.56, 0.92], topologyRationale: "A heavy horizontal entablature spans all four portico columns and projects beyond their capitals.", importance: 0.9 }),
  component({ id: "central-pediment", name: "Central triangular pediment", level: "meso", role: "ornament", primitive: "extrude", material: "facade-stone", position: [0, 8.55, 1.15], scale: [5.5, 1.45, 0.58], topologyClass: "surface-relief", topologyRationale: "The triangular pediment is a shallow extruded stone profile with a stepped perimeter cornice.", profile2D: pedimentProfile, localFeatures: [feature("pediment-cornice", "bevel", "all three pediment edges", "two-step projecting cornice with real edge geometry", 0.96)], importance: 1 }),
  component({ id: "portico-columns", name: "Portico column backing assembly", level: "meso", role: "assembly", primitive: "box", material: "facade-stone", position: [0, 5.55, 1.32], scale: [4.3, 3.8, 0.22], topologyRationale: "A shallow backing assembly holds the four separable column shafts and their capital detail.", localFeatures: [feature("capital-rings", "raised profile rings", "top and base of each shaft", "stacked cylinder and torus-like rings catch highlights", 0.92)], importance: 0.86 }),
  component({ id: "column-left-outer", name: "Outer left portico column", level: "meso", role: "shaft", primitive: "cylinder", material: "facade-stone", position: [-1.8, 5.55, 1.55], scale: [0.45, 3.75, 0.45], topologyRationale: "The photographed portico uses a freestanding cylindrical shaft with a distinct base and capital.", importance: 0.85 }),
  component({ id: "column-left-inner", name: "Inner left portico column", level: "meso", role: "shaft", primitive: "cylinder", material: "facade-stone", position: [-1.15, 5.55, 1.55], scale: [0.45, 3.75, 0.45], topologyRationale: "The photographed portico uses a freestanding cylindrical shaft with a distinct base and capital.", importance: 0.85 }),
  component({ id: "column-right-inner", name: "Inner right portico column", level: "meso", role: "shaft", primitive: "cylinder", material: "facade-stone", position: [1.15, 5.55, 1.55], scale: [0.45, 3.75, 0.45], topologyRationale: "The photographed portico uses a freestanding cylindrical shaft with a distinct base and capital.", importance: 0.85 }),
  component({ id: "column-right-outer", name: "Outer right portico column", level: "meso", role: "shaft", primitive: "cylinder", material: "facade-stone", position: [1.8, 5.55, 1.55], scale: [0.45, 3.75, 0.45], topologyRationale: "The photographed portico uses a freestanding cylindrical shaft with a distinct base and capital.", importance: 0.85 }),
  component({ id: "arched-window-bays", name: "Paired arched window backing", level: "meso", role: "opening", primitive: "box", material: "dark-glass", position: [0, 5.15, 0.8], scale: [11.8, 3.25, 0.15], topologyClass: "surface-relief", topologyRationale: "Dark recessed glazing forms a consistent back plane behind the separately modelled arched surrounds.", localFeatures: [feature("radial-fanlight-muntins", "raised linework", "paired arched fanlights", "thin physical muntins remain legible under relighting", 0.96), feature("keyed-arch-surround", "raised surround", "outer edge of both arched bays", "projecting stone surround and sill separate glazing from wall", 0.9)], importance: 0.95 }),
  component({ id: "left-arched-window", name: "Left arched window", level: "meso", role: "opening", primitive: "extrude", material: "dark-glass", position: [-4.65, 5.15, 0.94], scale: [2.05, 3.25, 0.2], topologyClass: "surface-relief", topologyRationale: "The opening combines a rectangular sash with a semicircular fanlight and shallow depth.", profile2D: archProfile, importance: 0.95 }),
  component({ id: "right-arched-window", name: "Right arched window", level: "meso", role: "opening", primitive: "extrude", material: "dark-glass", position: [4.65, 5.15, 0.94], scale: [2.05, 3.25, 0.2], topologyClass: "surface-relief", topologyRationale: "The opening mirrors the left bay's rectangular sash and semicircular fanlight.", profile2D: archProfile, importance: 0.95 }),
  component({ id: "central-fanlight", name: "Central portico fanlight", level: "meso", role: "opening", primitive: "extrude", material: "dark-glass", position: [0, 5.4, 1.25], scale: [2.3, 2.65, 0.18], topologyClass: "surface-relief", topologyRationale: "A deeply recessed arched fanlight sits between the inner portico columns.", profile2D: archProfile, localFeatures: [feature("radial-sash", "raised linework", "arched fanlight", "physical radial sash bars cast small shadows", 0.93)], importance: 0.9 }),
  component({ id: "entrance-arch", name: "Central entrance arch surround", level: "meso", role: "opening", primitive: "extrude", material: "rusticated-stone", position: [0, 1.75, 1.2], scale: [2.3, 2.85, 0.3], topologyClass: "surface-relief", topologyRationale: "Wedge-shaped stonework forms a shallow projecting arch around the main door.", profile2D: archProfile, localFeatures: [feature("voussoir-seams", "radial grooves", "central entrance arch", "real recessed seams radiate around the arch", 0.95)], importance: 0.9 }),
  component({ id: "entrance-door", name: "Dark timber entrance door", level: "meso", role: "panel", primitive: "box", material: "timber-door", position: [0, 1.35, 1.43], scale: [1.2, 2.3, 0.18], topologyRationale: "The central door is a recessed timber slab with shallow raised panels.", localFeatures: [feature("raised-door-panels", "raised panel relief", "door face", "nested rectangular rails stand proud of the door slab", 0.91)], importance: 0.78 }),
  component({ id: "ground-floor-openings", name: "Ground-floor opening system", level: "meso", role: "opening", primitive: "box", material: "dark-glass", position: [0, 1.45, 1.13], scale: [13.8, 2.15, 0.12], topologyClass: "surface-relief", topologyRationale: "Six dark glazed openings punctuate the rusticated base at a consistent depth.", localFeatures: [feature("fanlight-bars", "raised linework", "arched ground-floor fanlights", "thin radial bars sit above the lower glazed doors", 0.94)], importance: 0.82 }),
  component({ id: "frieze-reliefs", name: "Flanking frieze relief panels", level: "meso", role: "ornament", primitive: "box", material: "rusticated-stone", position: [0, 6.35, 1.18], scale: [6.7, 0.7, 0.2], topologyClass: "surface-relief", topologyRationale: "Two shallow rectangular relief panels flank the central fanlight beneath the portico.", localFeatures: [feature("relief-blocks", "shallow relief", "paired frieze panels", "abstracted relief silhouettes project slightly from their grounds", 0.86)], importance: 0.72 }),
  component({ id: "parapet-balustrades", name: "Stepped parapet balustrades", level: "meso", role: "ornament", primitive: "box", material: "facade-stone", position: [0, 8.95, 0.25], scale: [15, 0.58, 0.45], topologyClass: "surface-relief", topologyRationale: "Repeated turned balusters create a perforated roofline silhouette across stepped pavilions.", localFeatures: [feature("baluster-repeat", "repeated raised forms", "stepped roof parapets", "instanced turned balusters replace a solid slab at detailed LOD", 0.94)], importance: 0.86 }),
  component({ id: "central-parapet", name: "Central medallion parapet", level: "meso", role: "ornament", primitive: "box", material: "facade-stone", position: [0, 9.15, 0.35], scale: [6.2, 0.8, 0.48], topologyClass: "surface-relief", topologyRationale: "A central raised parapet carries a repeated circular medallion band below the dome.", localFeatures: [feature("medallion-band", "repeated circular relief", "central parapet face", "instanced shallow discs produce the observed rhythm", 0.92)], importance: 0.85 }),
  component({ id: "pavilion-cornices", name: "Pavilion cornice system", level: "meso", role: "ornament", primitive: "box", material: "facade-stone", position: [0, 7.3, 0.65], scale: [16.4, 0.42, 0.72], topologyClass: "surface-relief", topologyRationale: "Continuous projecting cornices separate the facade tiers and catch a crisp grazing highlight.", localFeatures: [feature("cornice-chamfer", "bevel", "upper and lower cornice edges", "real chamfered steps create the bright edge and dark undercut", 0.91)], importance: 0.88 }),
  component({ id: "cupola", name: "Copper cupola and oculus", level: "meso", role: "roof ornament", primitive: "cylinder", material: "dome-copper", position: [0, 12.45, 0], scale: [0.95, 1.2, 0.95], topologyRationale: "A short cylindrical cupola rises above the dome and contains a dark circular frontal oculus.", localFeatures: [feature("cupola-oculus", "true recess", "front face of cupola", "dark cavity is inset rather than painted onto the copper", 0.94)], importance: 0.92 }),
  component({ id: "dome-lantern", name: "Dome lantern finial", level: "meso", role: "ornament", primitive: "cone", material: "dome-copper", position: [0, 13.35, 0], scale: [0.42, 0.9, 0.42], topologyRationale: "A narrow tapered finial completes the vertical silhouette above the cupola.", importance: 0.72 }),
];

spec.materials = [
  material({ id: "invisible-root", name: "Invisible presentation root", color: "#000000", secondary: "#000000", roughness: 1, metalness: 0, qualityTier: "utility" }),
  material({ id: "facade-stone", name: "Weathered blond sandstone", color: "#B8A57E", secondary: "#7A6C52", roughness: 0.79, metalness: 0, qualityTier: "reference", localOverrides: facadeStoneOverrides, referencePbr: stoneReferencePbr }),
  material({ id: "rusticated-stone", name: "Darker rusticated sandstone", color: "#97896C", secondary: "#5D5344", roughness: 0.84, metalness: 0, qualityTier: "utility" }),
  material({ id: "dark-glass", name: "Recessed dark glazing", color: "#171F23", secondary: "#5B6F74", roughness: 0.2, metalness: 0, qualityTier: "utility" }),
  material({ id: "timber-door", name: "Dark panelled timber", color: "#34251B", secondary: "#5B412B", roughness: 0.52, metalness: 0, qualityTier: "utility" }),
  material({ id: "dome-copper", name: "Weathered copper patina", color: "#699787", secondary: "#375C52", roughness: 0.58, metalness: 0.55, qualityTier: "utility", localOverrides: copperOverrides }),
];
spec.materials[0].opacity = { base: 0 };

spec.repetitionSystems = [
  { id: "dome-rib-system", level: "meso", parent: "dome-shell", primitive: "box", material: "dome-copper", count: 16, placement: { mode: "radial", axis: [0, 1, 0], radius: 0.94, startAngleDeg: 0 }, instanceScale: [0.035, 1.1, 0.04], buildsGeometry: true, geometry: "instanced raised ribs" },
  { id: "fanlight-radial-bars", level: "micro", parent: "central-fanlight", primitive: "box", material: "facade-stone", count: 9, placement: { mode: "radial", axis: [0, 0, 1], radius: 0.62, startAngleDeg: 0 }, instanceScale: [0.62, 0.025, 0.025], buildsGeometry: true, geometry: "instanced radial sash bars" },
  { id: "arched-window-radial-bars", level: "micro", parent: "arched-window-bays", primitive: "box", material: "facade-stone", count: 11, placement: { mode: "radial", axis: [0, 0, 1], radius: 0.68, startAngleDeg: 0 }, instanceScale: [0.68, 0.02, 0.02], buildsGeometry: true, geometry: "instanced fanlight muntins" },
  { id: "parapet-baluster-system", level: "meso", parent: "parapet-balustrades", primitive: "cylinder", material: "facade-stone", count: 48, placement: { mode: "linear", axis: [1, 0, 0], spacing: 0.3, start: [-7.2, 0, 0] }, instanceScale: [0.07, 0.36, 0.07], buildsGeometry: true, geometry: "instanced linear turned-baluster approximation" },
  { id: "central-medallion-system", level: "micro", parent: "central-parapet", primitive: "cylinder", material: "rusticated-stone", count: 13, placement: { mode: "linear", axis: [1, 0, 0], spacing: 0.38, start: [-2.3, 0, 0.26] }, instanceScale: [0.11, 0.035, 0.11], buildsGeometry: true, geometry: "instanced shallow circular medallions" },
];

spec.buildPasses[0].componentRefs = ["root", "facade-body", "rusticated-base", "sandstone-walls", "left-pavilion-mass", "right-pavilion-mass", "roof-crown", "dome-shell"];
spec.buildPasses[1].componentRefs = spec.componentTree.filter((item) => item.level !== "micro").map((item) => item.id);
spec.buildPasses[2].componentRefs = ["central-pediment", "portico-columns", "arched-window-bays", "central-fanlight", "entrance-arch", "parapet-balustrades", "central-parapet", "cupola"];
for (const pass of spec.buildPasses.slice(3)) pass.componentRefs = spec.componentTree.map((item) => item.id);
spec.sculptPipeline.currentPass = "blockout";
spec.sculptPipeline.completedPasses = [];
spec.sculptPipeline.nextRequiredEvidence = ["fixed front render", "three-quarter render", "map-stripped silhouette review"];
spec.visualEvidence = [];
spec.reviewHistory = [];
spec.lookDevTargets = {
  qualityPriority: "reference-fidelity",
  materialPass: {
    minimumTextureResolution: 1024,
    independentMapChannels: ["albedo", "roughness", "height", "normal", "ambient-occlusion"],
    referencePbrExtraction: { requiredWhenSourceImagePresent: true, targetThreshold: 0.7 },
  },
  surfacePass: {
    locality: ["rain streaks below cornices", "ground-contact grime", "copper patina between ribs"],
    proofViews: ["neutral", "grazing", "reference-match"],
  },
  lightingPass: {
    toneMapping: "ACES Filmic",
    exposure: 1.05,
    contactShadow: "soft ground contact beneath the shallow facade slab",
  },
};
spec.lightingFromPhoto = [
  "Key: warm 4300K directional light from upper-left, intensity 2.6, soft shadow radius 7.",
  "Fill: cool-neutral hemisphere/environment at intensity 0.7, preserving dark glazing.",
  "Rim: restrained upper-right environment cue on the dome and cornices, intensity 0.45.",
  "ACES Filmic tone mapping with exposure 1.05; neutral review background #111416.",
  "Soft contact shadow beneath the presentation plinth; no exterior shadow influences planner geometry.",
];
spec.proceduralStrategy = [
  "Shallow modular facade slabs for macro masonry massing.",
  "Instanced geometry for dome ribs, fanlight bars, balusters, and medallions.",
  "Independent procedural PBR channels; no photographic projection.",
  "Desktop detailed LOD only; omit exterior facade in lean/mobile and during interaction.",
  "Keep architecture separate from event furniture, capacity calculations, collision, and historical snapshot data.",
];
spec.performanceBudget = {
  targetDrawCalls: 48,
  targetTriangles: 80000,
  targetTextureMemoryMB: 18,
  notes: "The production runtime should be cheaper than the generic pipeline render: merge static stone slabs, instance repeats, and gate the entire exterior context by quality tier.",
};
spec.lodPlan = [
  { id: "detailed", condition: "desktop and idle", content: "full shallow facade, columns, dome, and repeated details" },
  { id: "lean", condition: "mobile, reduced motion, or camera interaction", content: "facade omitted; interior hall shell remains" },
];
spec.assumptions = [
  "Facade proportions are reference-guided, not measured.",
  "Side and rear elevations are intentionally absent.",
  "The locally decoded frontal photograph controls visible bay rhythm and proportions.",
  "Fine heraldry is abstracted rather than invented as exact sculpture.",
];
spec.risks = [
  "The cropped reference includes neighbouring buildings and a flagpole; exclude them from the synthetic facade geometry and deterministic silhouette interpretation.",
  "A full facade in the planner would compete with event-scene performance; enforce LOD gating.",
  "Reference-derived PBR maps include baked lighting and background contamination; use them as evidence, not direct runtime textures.",
];

writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
