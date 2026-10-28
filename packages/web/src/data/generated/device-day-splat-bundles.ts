// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Produced by packages/web/scripts/generate-device-day-splat-bundles.mjs from
// lane L2's device-day staging (README: timing-only cuts, not look
// candidates). Every tile was re-hashed from disk and matched its bundle.json.
// Tile bytes are not in the repository: they are served from
// <splat base>/trades-hall/device-day/<id>/<file>.
//
// plannerTransform is L2's planner_from_json (T-658): it places a cut in the
// drawn hall's frame (hall-spec.ts). The planner composes it into the shipped
// Grand Hall capture's frame in data/device-day-splat-bundles.ts.

export interface GeneratedDeviceDayTile {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly splats: number;
  /** The tile's splat-centre bounds after plannerTransform, metres. */
  readonly boundsPlanner: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
}

export interface GeneratedDeviceDayBundle {
  readonly id: string;
  readonly roomSlug: string;
  readonly label: string;
  readonly splatType: ".sog";
  /** Spherical-harmonic degree read from the tiles' own meta.json. */
  readonly shDegree: number;
  readonly totalSplats: number;
  readonly totalBytes: number;
  readonly tiles: readonly GeneratedDeviceDayTile[];
  /** three.js position + Euler XYZ radians: tile frame to the drawn hall's frame. */
  readonly plannerTransform: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number];
    readonly scale: 1;
  };
  /** The same transform as L2 wrote it, row-major [R | t]. */
  readonly plannerMatrix3x4: readonly (readonly [number, number, number, number])[];
  readonly extentM: readonly [number, number, number];
  readonly alignmentNote: string;
  readonly source: {
    readonly cutDaySha256: string;
    readonly keptWeightFrac: number;
    readonly encoder: string;
  };
  readonly written: string;
}

export const GENERATED_DEVICE_DAY_BUNDLES: readonly GeneratedDeviceDayBundle[] =
  [
    {
      "id": "l2-1m",
      "roomSlug": "grand-hall",
      "label": "timing-only cut, not a look candidate",
      "splatType": ".sog",
      "shDegree": 3,
      "totalSplats": 1000000,
      "totalBytes": 19372829,
      "tiles": [
        {
          "file": "l2-1m_0.sog",
          "bytes": 9755827,
          "sha256": "b5c275b02a7d0a0cef980979096b0691fb83ed808a366ad82f1f296929d67e11",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -11.734,
              -1.892,
              -9.324
            ],
            "max": [
              11.888,
              9.243,
              -0.248
            ]
          }
        },
        {
          "file": "l2-1m_1.sog",
          "bytes": 9617002,
          "sha256": "13af40a183720789b9dfbb7b6a2046824b786824290e1ffc4b3ee66ee608149c",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -12.005,
              -6.316,
              -0.618
            ],
            "max": [
              17.089,
              9.569,
              22.524
            ]
          }
        }
      ],
      "plannerTransform": {
        "position": [
          8.539502995813681,
          2.2591773724935433,
          4.598301677239281
        ],
        "rotation": [
          -1.570712744423652,
          -0.004209191595129369,
          -1.587598973761236
        ],
        "scale": 1
      },
      "plannerMatrix3x4": [
        [
          -0.016801707490408203,
          0.9998499814652979,
          -0.004209179165892961,
          8.539502995813681
        ],
        [
          -0.0001542925959369898,
          0.004207180639623499,
          0.9999911378731617,
          2.2591773724935433
        ],
        [
          0.9998588294450379,
          0.01680220803672534,
          0.0000835816307216504,
          4.598301677239281
        ]
      ],
      "extentM": [
        29.095,
        15.885,
        31.848
      ],
      "alignmentNote": "gsplat Grand Hall in the E57 dataset frame. The transform is T-658's planner_from_json (hallgeom.py: planner = M json + o; planner frame x along the hall, fireplace < 0; y up, floor 0; z across, window wall < 0), given as three.js Euler XYZ radians. The shipped GH_2 room-local frame is centred with x across and z along: L3 confirms the composition before measuring.",
      "source": {
        "cutDaySha256": "8a5ddea1f232fd1ade7c34e7180654876391dc86d48c9daa4ce7f9bfe52a7704",
        "keptWeightFrac": 0.7041777933619557,
        "encoder": "@playcanvas/splat-transform 2.1.0 (e1c8619), default options, SOG v2"
      },
      "written": "2026-10-25T11:02:56Z"
    },
    {
      "id": "l2-1.5m",
      "roomSlug": "grand-hall",
      "label": "timing-only cut, not a look candidate",
      "splatType": ".sog",
      "shDegree": 3,
      "totalSplats": 1500000,
      "totalBytes": 29240385,
      "tiles": [
        {
          "file": "l2-1.5m_0.sog",
          "bytes": 9803183,
          "sha256": "058445bfa3f501368eb7b68887ca71d1141b828f9aea4c35ad74cfc4e1f176ec",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -11.734,
              -1.892,
              -9.324
            ],
            "max": [
              11.449,
              7.29,
              -3.193
            ]
          }
        },
        {
          "file": "l2-1.5m_1.sog",
          "bytes": 9731269,
          "sha256": "1ca03974e3913ea3920ea2466d7b868a0d27dbe91ae07d6d50f626ba7c71d262",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -12.005,
              -1.708,
              -3.559
            ],
            "max": [
              0.956,
              9.623,
              14.713
            ]
          }
        },
        {
          "file": "l2-1.5m_2.sog",
          "bytes": 9705933,
          "sha256": "270e8bb06b04d2d1960b39c66f6af26797bac431c376644de1c23199f7ba0b8d",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              0.718,
              -6.316,
              -3.36
            ],
            "max": [
              17.089,
              9.101,
              22.524
            ]
          }
        }
      ],
      "plannerTransform": {
        "position": [
          8.539502995813681,
          2.2591773724935433,
          4.598301677239281
        ],
        "rotation": [
          -1.570712744423652,
          -0.004209191595129369,
          -1.587598973761236
        ],
        "scale": 1
      },
      "plannerMatrix3x4": [
        [
          -0.016801707490408203,
          0.9998499814652979,
          -0.004209179165892961,
          8.539502995813681
        ],
        [
          -0.0001542925959369898,
          0.004207180639623499,
          0.9999911378731617,
          2.2591773724935433
        ],
        [
          0.9998588294450379,
          0.01680220803672534,
          0.0000835816307216504,
          4.598301677239281
        ]
      ],
      "extentM": [
        29.095,
        15.939,
        31.848
      ],
      "alignmentNote": "gsplat Grand Hall in the E57 dataset frame. The transform is T-658's planner_from_json (hallgeom.py: planner = M json + o; planner frame x along the hall, fireplace < 0; y up, floor 0; z across, window wall < 0), given as three.js Euler XYZ radians. The shipped GH_2 room-local frame is centred with x across and z along: L3 confirms the composition before measuring.",
      "source": {
        "cutDaySha256": "2cadded8a55f33f5283d8f714b2bb484f0c4737bba4cafde25adcfb7bf494863",
        "keptWeightFrac": 0.7948630151271405,
        "encoder": "@playcanvas/splat-transform 2.1.0 (e1c8619), default options, SOG v2"
      },
      "written": "2026-10-25T11:06:39Z"
    },
    {
      "id": "l2-2m",
      "roomSlug": "grand-hall",
      "label": "timing-only cut, not a look candidate",
      "splatType": ".sog",
      "shDegree": 3,
      "totalSplats": 2000000,
      "totalBytes": 39104569,
      "tiles": [
        {
          "file": "l2-2m_0.sog",
          "bytes": 9785084,
          "sha256": "597334648932e2fd564a6d18b014fa1d424034369c2aba7d673bfedd1d26570d",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -25.542,
              -1.892,
              -25.448
            ],
            "max": [
              1.206,
              9.413,
              -0.321
            ]
          }
        },
        {
          "file": "l2-2m_1.sog",
          "bytes": 9847809,
          "sha256": "2ff5e07b31f3507396754bc86048bfc32f0aa6577d415860a2b763cf8852e63e",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              1.087,
              -0.84,
              -8.346
            ],
            "max": [
              12.129,
              8.933,
              -0.15
            ]
          }
        },
        {
          "file": "l2-2m_2.sog",
          "bytes": 9752466,
          "sha256": "1be019be271abe617b69a8fa52f85552fce6beb134b0d28f15dda9ac57e9f88c",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -12.005,
              -1.708,
              -0.517
            ],
            "max": [
              0.669,
              9.808,
              14.713
            ]
          }
        },
        {
          "file": "l2-2m_3.sog",
          "bytes": 9719210,
          "sha256": "2b310908d887ffbd66ff2f7f44ea550b52bd3589212d787c3c9c9be1db5c05b3",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              0.477,
              -6.316,
              -0.322
            ],
            "max": [
              17.089,
              9.123,
              22.524
            ]
          }
        }
      ],
      "plannerTransform": {
        "position": [
          8.539502995813681,
          2.2591773724935433,
          4.598301677239281
        ],
        "rotation": [
          -1.570712744423652,
          -0.004209191595129369,
          -1.587598973761236
        ],
        "scale": 1
      },
      "plannerMatrix3x4": [
        [
          -0.016801707490408203,
          0.9998499814652979,
          -0.004209179165892961,
          8.539502995813681
        ],
        [
          -0.0001542925959369898,
          0.004207180639623499,
          0.9999911378731617,
          2.2591773724935433
        ],
        [
          0.9998588294450379,
          0.01680220803672534,
          0.0000835816307216504,
          4.598301677239281
        ]
      ],
      "extentM": [
        42.631,
        16.124,
        47.973
      ],
      "alignmentNote": "gsplat Grand Hall in the E57 dataset frame. The transform is T-658's planner_from_json (hallgeom.py: planner = M json + o; planner frame x along the hall, fireplace < 0; y up, floor 0; z across, window wall < 0), given as three.js Euler XYZ radians. The shipped GH_2 room-local frame is centred with x across and z along: L3 confirms the composition before measuring.",
      "source": {
        "cutDaySha256": "55a53ce06b62e4c8a24839b1b2bd552650649dbbdc216371c4b43be0f5a6e99a",
        "keptWeightFrac": 0.856609650049775,
        "encoder": "@playcanvas/splat-transform 2.1.0 (e1c8619), default options, SOG v2"
      },
      "written": "2026-10-25T11:11:48Z"
    },
    {
      "id": "l2-3m",
      "roomSlug": "grand-hall",
      "label": "timing-only cut, not a look candidate",
      "splatType": ".sog",
      "shDegree": 3,
      "totalSplats": 3000000,
      "totalBytes": 58935022,
      "tiles": [
        {
          "file": "l2-3m_0.sog",
          "bytes": 9794114,
          "sha256": "0eee5e98de195a601e12a3e6fd9d41fe1376f9d2b5f90d6b61c9e5f4aeaac2a2",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -25.542,
              -1.892,
              -25.448
            ],
            "max": [
              -3.411,
              8.011,
              -0.36
            ]
          }
        },
        {
          "file": "l2-3m_1.sog",
          "bytes": 9860388,
          "sha256": "0472d4ce87be2712b8eb80d6a34176d514124cd155b63beb2d693777264ba333",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -3.519,
              -0.84,
              -9.324
            ],
            "max": [
              5.118,
              9.937,
              -0.216
            ]
          }
        },
        {
          "file": "l2-3m_2.sog",
          "bytes": 9868881,
          "sha256": "b88e513a66abb1e7e4130532d5e59bcf4e36e14e816115eb78412185d79bc8f0",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              4.995,
              -0.093,
              -7.747
            ],
            "max": [
              13.564,
              7.221,
              -0.114
            ]
          }
        },
        {
          "file": "l2-3m_3.sog",
          "bytes": 9808926,
          "sha256": "c52ebb548e6c38b0fd102bcc1ef239b492acf66ea2c521f6d6cd03b6b6050814",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -12.207,
              -0.649,
              -0.485
            ],
            "max": [
              -3.049,
              7.477,
              11.892
            ]
          }
        },
        {
          "file": "l2-3m_4.sog",
          "bytes": 9821743,
          "sha256": "3654e568832736a96dbd43892bfea4e079833b583c737d1ef902c31e1b2dd473",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -3.121,
              -0.561,
              -0.348
            ],
            "max": [
              17.089,
              10.185,
              4.56
            ]
          }
        },
        {
          "file": "l2-3m_5.sog",
          "bytes": 9780970,
          "sha256": "9affa217d5c6b821dcee66aedab3710bd0dcb46ccc76439083e0756784116067",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -3.217,
              -6.316,
              4.318
            ],
            "max": [
              14.997,
              8.004,
              22.524
            ]
          }
        }
      ],
      "plannerTransform": {
        "position": [
          8.539502995813681,
          2.2591773724935433,
          4.598301677239281
        ],
        "rotation": [
          -1.570712744423652,
          -0.004209191595129369,
          -1.587598973761236
        ],
        "scale": 1
      },
      "plannerMatrix3x4": [
        [
          -0.016801707490408203,
          0.9998499814652979,
          -0.004209179165892961,
          8.539502995813681
        ],
        [
          -0.0001542925959369898,
          0.004207180639623499,
          0.9999911378731617,
          2.2591773724935433
        ],
        [
          0.9998588294450379,
          0.01680220803672534,
          0.0000835816307216504,
          4.598301677239281
        ]
      ],
      "extentM": [
        42.631,
        16.501,
        47.973
      ],
      "alignmentNote": "gsplat Grand Hall in the E57 dataset frame. The transform is T-658's planner_from_json (hallgeom.py: planner = M json + o; planner frame x along the hall, fireplace < 0; y up, floor 0; z across, window wall < 0), given as three.js Euler XYZ radians. The shipped GH_2 room-local frame is centred with x across and z along: L3 confirms the composition before measuring.",
      "source": {
        "cutDaySha256": "6fb91b227269b42b2f0fe534745a4f51e96a8ccc29dc7440609263821e0e2f9f",
        "keptWeightFrac": 0.9320469535561386,
        "encoder": "@playcanvas/splat-transform 2.1.0 (e1c8619), default options, SOG v2"
      },
      "written": "2026-10-25T11:18:57Z"
    },
    {
      "id": "l2-2m-sh1",
      "roomSlug": "grand-hall",
      "label": "timing-only cut, not a look candidate",
      "splatType": ".sog",
      "shDegree": 1,
      "totalSplats": 2000000,
      "totalBytes": 31316580,
      "tiles": [
        {
          "file": "l2-2m-sh1_0.sog",
          "bytes": 7824964,
          "sha256": "3621ff908280e63c3cbe32b03b954fb2c103fd8ce63c93138eb4e10deb7905e0",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -25.542,
              -1.892,
              -25.448
            ],
            "max": [
              1.206,
              9.413,
              -0.321
            ]
          }
        },
        {
          "file": "l2-2m-sh1_1.sog",
          "bytes": 7901339,
          "sha256": "b2677511e4598dd25673d474a6b3f0ec5a83b22da76a4c4bfb77f1b756e778cc",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              1.087,
              -0.84,
              -8.346
            ],
            "max": [
              12.129,
              8.933,
              -0.15
            ]
          }
        },
        {
          "file": "l2-2m-sh1_2.sog",
          "bytes": 7822088,
          "sha256": "0c02af3c979cf30a7b8d70c4a4930ed4f38afa0668690b6045ee44561c8e797d",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              -12.005,
              -1.708,
              -0.517
            ],
            "max": [
              0.669,
              9.808,
              14.713
            ]
          }
        },
        {
          "file": "l2-2m-sh1_3.sog",
          "bytes": 7768189,
          "sha256": "6b44b5321177f1344830a61451710d3753010fb063445369bfcdf2a7501ba3f4",
          "splats": 500000,
          "boundsPlanner": {
            "min": [
              0.477,
              -6.316,
              -0.322
            ],
            "max": [
              17.089,
              9.123,
              22.524
            ]
          }
        }
      ],
      "plannerTransform": {
        "position": [
          8.539502995813681,
          2.2591773724935433,
          4.598301677239281
        ],
        "rotation": [
          -1.570712744423652,
          -0.004209191595129369,
          -1.587598973761236
        ],
        "scale": 1
      },
      "plannerMatrix3x4": [
        [
          -0.016801707490408203,
          0.9998499814652979,
          -0.004209179165892961,
          8.539502995813681
        ],
        [
          -0.0001542925959369898,
          0.004207180639623499,
          0.9999911378731617,
          2.2591773724935433
        ],
        [
          0.9998588294450379,
          0.01680220803672534,
          0.0000835816307216504,
          4.598301677239281
        ]
      ],
      "extentM": [
        42.631,
        16.124,
        47.973
      ],
      "alignmentNote": "gsplat Grand Hall in the E57 dataset frame. The transform is T-658's planner_from_json (hallgeom.py: planner = M json + o; planner frame x along the hall, fireplace < 0; y up, floor 0; z across, window wall < 0), given as three.js Euler XYZ radians. The shipped GH_2 room-local frame is centred with x across and z along: L3 confirms the composition before measuring.",
      "source": {
        "cutDaySha256": "55a53ce06b62e4c8a24839b1b2bd552650649dbbdc216371c4b43be0f5a6e99a",
        "keptWeightFrac": 0.856609650049775,
        "encoder": "@playcanvas/splat-transform 2.1.0 (e1c8619), default options, -H 1 (SH bands above 1 removed), SOG v2"
      },
      "written": "2026-10-25T11:21:15Z"
    }
  ];
