// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Produced by @omnitwin/xgrids-lcc2:
//   pnpm --filter @omnitwin/xgrids-lcc2 lcc2 -- stage
//     --scans "<capture root>" --grand-hall "<grand hall root>"
//     --out "<staging root>" --manifest "<this file>"
//
// Tile bytes are NOT in the repository: roughly a gigabyte across these
// rooms is staged outside it and served from R2 in production. What lives
// here is the descriptor - tile names, sizes, digests, and the room-local
// transform derived from each capture's own room mesh.

export interface GeneratedSplatTile {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Octree depth: 1 is coarsest and loads first. Null for the sky shell. */
  readonly lodLevel: number | null;
  /** The environment sphere, which is not room geometry. */
  readonly isEnvironment: boolean;
}

export interface GeneratedRoomSplatBundle {
  readonly roomSlug: string;
  readonly captureDir: string;
  readonly splatType: string;
  readonly totalSplats: number;
  readonly totalLevels: number;
  readonly tiles: readonly GeneratedSplatTile[];
  readonly totalBytes: number;
  readonly transform: {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number];
    readonly scale: 1;
  };
  /** Scene-space width, height, depth in metres. */
  readonly extentM: readonly [number, number, number];
  /**
   * Where the viewer starts, from the scanner's own walk.
   *
   * A pose the operator actually occupied, so it cannot be outside the room
   * and is guaranteed to have captured surface in every direction. Null when
   * the capture shipped no usable trajectory.
   */
  readonly spawn: {
    readonly position: readonly [number, number, number];
    readonly yaw: number;
  } | null;
  /**
   * The box the viewer may move within, in scene metres.
   *
   * The region the operator walked. Outside it a capture has no data at all —
   * only the backs of surfaces — so there is nothing there worth showing.
   */
  readonly bounds: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  } | null;
  /** How high the scanner was carried above the floor, in metres. */
  readonly eyeHeightM: number | null;
  /**
   * Whether the derived alignment can be trusted without human review.
   * `review` means the capture is probably a whole-floor scan in which this
   * room is only a part - see the tool's roomCropM.
   */
  readonly alignmentConfidence: "confident" | "review";
  readonly alignmentNote: string;
}

export const GENERATED_VENUE_SLUG = "trades-hall";

export const GENERATED_ROOM_SPLAT_BUNDLES: readonly GeneratedRoomSplatBundle[] =
  [
    {
      "roomSlug": "grand-hall",
      "captureDir": "scans_BIG_MODEL_TH_GH_2",
      "splatType": ".sog",
      "totalSplats": 11487038,
      "totalLevels": 5,
      "tiles": [
        {
          "file": "0_0.sog",
          "bytes": 7226379,
          "sha256": "ad9ee1a5edb4cdb07773bfca8bafc211bda2c470820fff310948ee1fa266f41d",
          "lodLevel": 1,
          "isEnvironment": false
        },
        {
          "file": "0_5_0.sog",
          "bytes": 9819031,
          "sha256": "64d22c432b8c275cbcdda0f1c5a979fd3f7c6d735af7be9f5aceb9d1ab5d0f1a",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_6_0.sog",
          "bytes": 4617467,
          "sha256": "97434a3bc82407f5690e94023982d48516586ab6d95b12a140c5a1b01269f6d4",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_1.sog",
          "bytes": 9607542,
          "sha256": "522b01ac0a8672688555a4824d41c9c382808e89444b3f3c93b80dfbf0d6ea6e",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1.sog",
          "bytes": 10047647,
          "sha256": "c1f2dbaeac2c49f4e5b08122c72feda5b8db73ea107b2c74f2fb2696c00be9f2",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0.sog",
          "bytes": 7434360,
          "sha256": "0553f77eeb242b620c4ee6ff9a34ac7dcb198ddd47c71e6856e6eed4cf8e052e",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_0.sog",
          "bytes": 9287335,
          "sha256": "e8df50b2e00f48c25c394e870eb22facf1eee78fd24daf1bb33d7b5ba3e24d97",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_1_0.sog",
          "bytes": 9812960,
          "sha256": "a2f5dc09cc3c8e0e6a64163d70d45dadbd0869cacc7f4c402b46bda59917e79b",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_4_0_0_0.sog",
          "bytes": 10051936,
          "sha256": "de10e3ae76615fc1f1bfd5d029b13816ab21f860a816856a656f06b9f522e773",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1_0.sog",
          "bytes": 10453154,
          "sha256": "c0856a3a2dcb4fc14ca4ed3a37da258755ce047b8a009072a66c8d4eb413c27f",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_0.sog",
          "bytes": 9927441,
          "sha256": "4c067908c5e62f1411e76ef470cc1f7f246200eac2ac98255ebd3d946745229d",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_1_0.sog",
          "bytes": 4615298,
          "sha256": "3aab5477d7404d2a25e4d207cc167b6deb9c54edf9ddec6da255019487ca1f1c",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_0_0_1_0_1.sog",
          "bytes": 9980174,
          "sha256": "97efa65f9aaddbd69780664c6668817125c3153469918d5f291b348ee0b6d7e1",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_1_0_0.sog",
          "bytes": 9500250,
          "sha256": "2b0c0cce30cb31a34b253d5985985b3d547debe8bca1a97401eb72ab3ad3bdbf",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_0_1_1.sog",
          "bytes": 10575631,
          "sha256": "b354ba55785e73a42aa4d108ac0c1fb93c333cbf5bd881e6c75149c2cecccd3e",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0_0_0.sog",
          "bytes": 10376269,
          "sha256": "e590fb5d7488071c63f10df33b31e451f3c0348c2209f1bf594015c28a1fff24",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_1_0_1.sog",
          "bytes": 10207866,
          "sha256": "84b2ff813e0746d8fc8dfcc9d044dba15fef5f62ca137794c30989c04ba82a9d",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_4_0_1_0_0.sog",
          "bytes": 9199768,
          "sha256": "5863e052c6f99316914df9168829543b82fb35db0118b5e02d30e4d326a79d03",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_0_0_1.sog",
          "bytes": 8975642,
          "sha256": "65fd21b69a1def23cb4bd5b756da7ac03e4451a476a80a61c47b853a0366a8f1",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1_0_1.sog",
          "bytes": 9708760,
          "sha256": "d3272fee659e486190af1d2ac9427c39e5536bc85b90b5570df4b6e9e9124631",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0_0_1.sog",
          "bytes": 10231737,
          "sha256": "18e23290236bb3f220df2b59f6f255a421151c0f1da7ed633bd00d06eddf0171",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_0_0.sog",
          "bytes": 9417293,
          "sha256": "7c4cca3644294c2955cfe9e41f387e70ce79e1aedcca132392c0493325ce4386",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_0_1.sog",
          "bytes": 8306348,
          "sha256": "5e4409b07084ce7089e77a17d1eec0d2c4691f7a9d9e52f55ef752529d356ea9",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "env.sog",
          "bytes": 414176,
          "sha256": "b74e7cd9899bbea8aad30b16c6512b43326c53a46c36ffd6cbd272eb48f914bd",
          "lodLevel": null,
          "isEnvironment": true
        }
      ],
      "totalBytes": 209794464,
      "transform": {
        "position": [
          4.911651,
          6.327585,
          -8.571432999999999
        ],
        "rotation": [
          -1.5707963267948966,
          0,
          0
        ],
        "scale": 1
      },
      "extentM": [
        10.087102,
        12.921247197916665,
        19.867694
      ],
      "spawn": {
        "position": [
          0.4139999999999997,
          3,
          -1.0642519999999989
        ],
        "yaw": 0
      },
      "bounds": {
        "min": [
          -5.043551,
          2.4,
          -9.933846999999998
        ],
        "max": [
          5.043551,
          3.6,
          9.933847
        ]
      },
      "eyeHeightM": 3,
      "alignmentConfidence": "review",
      "alignmentNote": "Derived from scans_BIG_MODEL_TH_GH_2: floor from the room mesh, room from the scanner's own walk. Derived 13.8x22.3x12.9 m disagrees with published 21.0x10.0x7.0 m (worst axis 85%). Check the capture-to-room mapping before wiring this room."
    },
    {
      "roomSlug": "reception-room",
      "captureDir": "scan_output_1_reception",
      "splatType": ".sog",
      "totalSplats": 3933570,
      "totalLevels": 4,
      "tiles": [
        {
          "file": "0_0.sog",
          "bytes": 5669709,
          "sha256": "49b190273830e9ec699a3b89293b5c4eb0646543165a8662e36b2528239e04d6",
          "lodLevel": 1,
          "isEnvironment": false
        },
        {
          "file": "0_7_0.sog",
          "bytes": 9413103,
          "sha256": "f8069d921588a99befdcaf55a19af62ccdb4a5d72c46f7a4d95520c9f16778b6",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0.sog",
          "bytes": 9628095,
          "sha256": "8971fe385567622db12738028f0832d5bb05d02e3dcfd6099c5144ab96758bd2",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0.sog",
          "bytes": 9309181,
          "sha256": "8f6e5de15b66553bed7d74927ace708c645ed98e71af196fad6c1ee4b94ccca1",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_0_0.sog",
          "bytes": 10685765,
          "sha256": "830c5905ed7651214d30c99836454656001f8027407130728b04f05a90c9a5b3",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_4_0_0_0.sog",
          "bytes": 10448767,
          "sha256": "eac35b74ada19273277314814e69203b5d86e08012f7012802b9e392fd7115eb",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0_0.sog",
          "bytes": 9178356,
          "sha256": "e7d48befba9701cd138e29a27f41a03924889ee3378481ac5cd91a34304435cd",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0_1.sog",
          "bytes": 7607425,
          "sha256": "8a4f33e5ce1abe91f19452abe685d53ed2bccbecd24da37cf8099c9988f335e9",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "env.sog",
          "bytes": 129572,
          "sha256": "6aeaea70ff916ddf993621be6bff01e1d688047db214fe323d2c1bc2306726a1",
          "lodLevel": null,
          "isEnvironment": true
        }
      ],
      "totalBytes": 72069973,
      "transform": {
        "position": [
          1.2141755000000003,
          1.9456600000000002,
          -5.645894
        ],
        "rotation": [
          -1.5707963267948966,
          0,
          0
        ],
        "scale": 1
      },
      "extentM": [
        9.661757,
        3.6612683333333336,
        12.410764
      ],
      "spawn": {
        "position": [
          -0.3882574999999997,
          1.873571,
          -0.42241700000000026
        ],
        "yaw": 0
      },
      "bounds": {
        "min": [
          -4.8308785,
          1.273571,
          -6.205382
        ],
        "max": [
          4.8308785,
          2.473571,
          6.205382
        ]
      },
      "eyeHeightM": 1.873571,
      "alignmentConfidence": "confident",
      "alignmentNote": "Derived from scan_output_1_reception: floor from the room mesh, room from the scanner's own walk. Derived 11.2x14.7x3.7 m agrees with published 13.4x11.2x3.2 m (worst axis 14%)."
    },
    {
      "roomSlug": "saloon",
      "captureDir": "scan_output_1_saloon",
      "splatType": ".sog",
      "totalSplats": 11978081,
      "totalLevels": 5,
      "tiles": [
        {
          "file": "0_0.sog",
          "bytes": 7607946,
          "sha256": "f5f09717a5b4e5d6d3f7a2663aa3e0957008aa320b98177dc05ad3a625af6750",
          "lodLevel": 1,
          "isEnvironment": false
        },
        {
          "file": "0_5_0.sog",
          "bytes": 10362314,
          "sha256": "91e8732d1336ae765789970593c5799923a57ec0daca52b4ec8a2715d3d5397f",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_6_0.sog",
          "bytes": 4876262,
          "sha256": "496a3183d8e49e35c620081ca24857973d78d3f62570e326ebbc71f66f4ebcf5",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_1.sog",
          "bytes": 10445697,
          "sha256": "71491a73aab86658ff467ee2195ce7d4d6eaaf832c89309a0628d54145bba019",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1.sog",
          "bytes": 10209071,
          "sha256": "a673cf7ba38b4bf5df3f35954b9cfc438bce52a1cf4a4203d476e891ad49936a",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0.sog",
          "bytes": 7872178,
          "sha256": "fd8cbf7964897d3912856b5083f7830c9d8d49ab3689624a37b6bb1150c9fb90",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_1_1_0_0.sog",
          "bytes": 10739642,
          "sha256": "51afc8a6de219a92f795be6445d6cb138a6f05ae158454425ef96f3c88f01f5c",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_1_1.sog",
          "bytes": 10062200,
          "sha256": "f00313df854ad2e98c5040dfee16aa3b51cc3f549b4e5753d9e650adaeb4b3c7",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_4_0_0_0.sog",
          "bytes": 9592076,
          "sha256": "ad81bdb4d686ddf709913cc96b5b160c20bf832049205f120616e8ac67394c20",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1_0.sog",
          "bytes": 9672176,
          "sha256": "ba16bc61a73c086fe1423e4456fc2e20ba70f2cc12661915a2a2e45bf5f64181",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_0.sog",
          "bytes": 11824266,
          "sha256": "4a4ae33b77f534fd5132d3cd17fc485bb48276f2eee2d3884fe46f67431f1661",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_1_0.sog",
          "bytes": 4946167,
          "sha256": "dc0df860cfcab6281b5ba8a5187eb658cff7cca60a2a0e67382c92ce453fbe3d",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_0_0.sog",
          "bytes": 11387554,
          "sha256": "4bdab0fb2679080eda8c95906adbc722be48e1ecb458fb5587125ea3586aca74",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_1_1_0_1_0.sog",
          "bytes": 10337570,
          "sha256": "655a43a7a5f42d502f4521fec436ad1e126fa5a0b5df2af504315ba81657b8ca",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_0_1_0.sog",
          "bytes": 9267834,
          "sha256": "7492919e0f78d509939b30202951154770aeff4ef2a1c3d3233ebee46d0b7d3f",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_1_1_1.sog",
          "bytes": 9883813,
          "sha256": "097d92478b9472121791aee2641672f00143f63b92372cbe065cab9e2c47cfd0",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_1_0_0.sog",
          "bytes": 9382663,
          "sha256": "994fcc7dc1e4c612105025e3f3e45ba1188b6681d09aa51bdd89d661f161dfab",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_4_0_0_0_1.sog",
          "bytes": 9873679,
          "sha256": "b7fbbdf42b5633b45ddea14adb82231184615f0ccbdd78da73bedf6c5d2d5d51",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_0_0_0.sog",
          "bytes": 11026272,
          "sha256": "b9584c73057b5ba1e885296614243f1cd34bc11e260de7a989d1b0037f124d52",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1_0_1.sog",
          "bytes": 9371971,
          "sha256": "29785ef8b51965475df5523fa24d866b3767f7bb599f5f055e9d68d57876d1ab",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0_0_1.sog",
          "bytes": 10720068,
          "sha256": "59c8ff57dc69b66fd3ea5b87319e32f00491cedec4dc6d2adc1e3306d17c98b8",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_0_0.sog",
          "bytes": 10167112,
          "sha256": "b8f00f64c24b9256ebd979a38e0d97b1e486cd833cb8281a5a6c8f0466f9c70a",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_1_1_0.sog",
          "bytes": 9977017,
          "sha256": "a0a394946372ca0fceee8209003e0de23f2406f70b4362b2f6b8af85185099b3",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "env.sog",
          "bytes": 201353,
          "sha256": "c8f2634eb022dddbb6ea4d7e2b6385354c3976dcf041804ee5c8287e6c176856",
          "lodLevel": null,
          "isEnvironment": true
        }
      ],
      "totalBytes": 219806901,
      "transform": {
        "position": [
          1.280121,
          1.5,
          -5.831064
        ],
        "rotation": [
          -1.5707963267948966,
          0,
          0
        ],
        "scale": 1
      },
      "extentM": [
        7.480898,
        5.883291614583333,
        11.15992
      ],
      "spawn": {
        "position": [
          0.795637,
          1.619101,
          0.2028150000000002
        ],
        "yaw": 0
      },
      "bounds": {
        "min": [
          -3.740449,
          1.019101,
          -5.57996
        ],
        "max": [
          3.740449,
          2.2191009999999998,
          5.57996
        ]
      },
      "eyeHeightM": 1.619101,
      "alignmentConfidence": "review",
      "alignmentNote": "Derived from scan_output_1_saloon: floor from the room mesh, room from the scanner's own walk. Derived 9.9x13.5x5.9 m disagrees with published 12.0x7.0x5.4 m (worst axis 41%). Check the capture-to-room mapping before wiring this room."
    },
    {
      "roomSlug": "robert-adam-room",
      "captureDir": "scan_output_1_robertadam",
      "splatType": ".sog",
      "totalSplats": 8825496,
      "totalLevels": 5,
      "tiles": [
        {
          "file": "0_0.sog",
          "bytes": 6282401,
          "sha256": "87d56e54834ebae5ce48ee2e8dd6418a886b7e5ad3ae1950938b34f2500650cd",
          "lodLevel": 1,
          "isEnvironment": false
        },
        {
          "file": "0_6_0.sog",
          "bytes": 9430407,
          "sha256": "b1a70cd6b959930b83b2a3b640a900e94a08916d7a8e75582de011822befa201",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_7_0.sog",
          "bytes": 2490959,
          "sha256": "018c20038935874725654825abce506fa8a748ba19ed12ed431295c0ead041dd",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0.sog",
          "bytes": 10409265,
          "sha256": "7a6eb9c95e57b368f97878464907049e344b6a32c84636a8ebc61df04741ae6a",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0.sog",
          "bytes": 10225227,
          "sha256": "e9303c17048ddf97cb5abac8f853646ecabd981fb71667ec58804ccd4365b337",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_1.sog",
          "bytes": 10194205,
          "sha256": "5d87eed4af8d28c88be829cb8049fc9e58fb122e498cdf7e06a186217667a52b",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0_1.sog",
          "bytes": 10156565,
          "sha256": "ac95402b72259662f2e1a1ac9ecbdb827cb778a9602b608ef5562ed7119a47d0",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_0_1.sog",
          "bytes": 10348701,
          "sha256": "90b881a88cea7b42745b7c029bd23977e76c1102f2ffcbc784c86293635489a8",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_1.sog",
          "bytes": 10985653,
          "sha256": "2f6446f317a35f5bb462065a3fe1168b2999352e23aa9815c55ecd11bf005ff4",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_0_0.sog",
          "bytes": 11770700,
          "sha256": "b524f027dfc94eeddc8a8b2e513cac993ee21459befd80d416fa88cade0e9ad4",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_0_0_0.sog",
          "bytes": 11680066,
          "sha256": "bff308862a681eeb9e78b8bd630841326e481a57de82c3e3f53f410258fbde1c",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0_1_0.sog",
          "bytes": 10863740,
          "sha256": "70c21acf0b83f341069303262c378fd47c489c9c25174f5714192805482eed4d",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_4_0_0_0_1.sog",
          "bytes": 9160530,
          "sha256": "2b4a677bda03f49b79d1c7f3531557531208a9a4496c10367ca71ba23788aa2d",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_0_0_0.sog",
          "bytes": 10888914,
          "sha256": "0b2aabfa856cec9c8e092dc086881bc33ced6854771efcba0fe7a8f36ff93c81",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0_0_1.sog",
          "bytes": 10641195,
          "sha256": "7755104db0ce7a884557f2ce8eede237d00d511fff5de9716593e394e415a2bc",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_0_1.sog",
          "bytes": 10593746,
          "sha256": "7db77ca010c356574369515eb5662ced8229e055b93caa3f24b01d89d70f4ef5",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_1_0.sog",
          "bytes": 6367616,
          "sha256": "4c64b91881e074398c88266acf1300d17595cea34a2fc7bd288be4af527e68eb",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "env.sog",
          "bytes": 330378,
          "sha256": "8711a9f483ad3f7f890d5e5eb4c741632bed7ec2a839d21f662618eade17a90b",
          "lodLevel": null,
          "isEnvironment": true
        }
      ],
      "totalBytes": 162820268,
      "transform": {
        "position": [
          6.3165155,
          1.475265,
          -2.2251945
        ],
        "rotation": [
          -1.5707963267948966,
          0,
          0
        ],
        "scale": 1
      },
      "extentM": [
        19.365833000000002,
        14.4535075625,
        17.978921
      ],
      "spawn": {
        "position": [
          1.9611145000000008,
          1.6083640000000001,
          1.5553494999999997
        ],
        "yaw": 1.5707963267948966
      },
      "bounds": {
        "min": [
          -9.682916500000001,
          1.0083640000000003,
          -8.9894605
        ],
        "max": [
          9.682916500000001,
          2.208364,
          8.9894605
        ]
      },
      "eyeHeightM": 1.6083640000000001,
      "alignmentConfidence": "review",
      "alignmentNote": "Derived from scan_output_1_robertadam: floor from the room mesh, room from the scanner's own walk. Derived 33.6x17.1x14.5 m disagrees with published 9.7x5.6x2.2 m (worst axis 563%). Check the capture-to-room mapping before wiring this room."
    },
    {
      "roomSlug": "lady-convenors-room",
      "captureDir": "scan_output_1_lady",
      "splatType": ".sog",
      "totalSplats": 4283652,
      "totalLevels": 4,
      "tiles": [
        {
          "file": "0_0.sog",
          "bytes": 6455231,
          "sha256": "094295703537beff346dd8eeefd79be59bff719be4e895b125ea0bb7be71aaa5",
          "lodLevel": 1,
          "isEnvironment": false
        },
        {
          "file": "0_7_0.sog",
          "bytes": 10603969,
          "sha256": "2bc2512d159e1a5889fff733181271d0405c6c3548a4077856c6baafa508c180",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0.sog",
          "bytes": 10527285,
          "sha256": "d89c10e5cff99ab37bab7030e92f03020689703db14d79660e8114b77c848c0b",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0.sog",
          "bytes": 10617420,
          "sha256": "429b952d522adb0847f868009f1677e7ad38c68a1b62034f8f60d54c4b1f5f54",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_1.sog",
          "bytes": 10357637,
          "sha256": "07b33968d05e63e2c9813eb374189a3c7cd7c9492cc2f8da81c8bb8551344186",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0_1.sog",
          "bytes": 9542928,
          "sha256": "d2e1d8b87a6a628bae1127277a95267c6fc14a6ffe8f48aa23a547ef061a5804",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_0_1.sog",
          "bytes": 10240293,
          "sha256": "2645bb78bcaf267710897f13d78c75c0a8ba86629e19f029009739b04ad416b8",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_2.sog",
          "bytes": 10256741,
          "sha256": "48284eda318683f4481524603cf719145924de5d06d42566cb72fe3fee96ad8a",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_3.sog",
          "bytes": 3633331,
          "sha256": "1a23afeac5b5d83e75d8f3f53f4d0aad3e3461059e5e06b9df2f3f03961d2d01",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "env.sog",
          "bytes": 115592,
          "sha256": "948c331c7f15c7698d87e8cfabce3e162e70e2e78de1cd5f622e6ad2c5325114",
          "lodLevel": null,
          "isEnvironment": true
        }
      ],
      "totalBytes": 82350427,
      "transform": {
        "position": [
          0.85182,
          1.384441,
          -1.9216425
        ],
        "rotation": [
          -1.5707963267948966,
          0,
          0
        ],
        "scale": 1
      },
      "extentM": [
        3.97504,
        4.781301,
        3.865063
      ],
      "spawn": {
        "position": [
          -0.18703000000000003,
          1.420404,
          -0.3152554999999999
        ],
        "yaw": 1.5707963267948966
      },
      "bounds": {
        "min": [
          -1.98752,
          0.820404,
          -1.9325314999999998
        ],
        "max": [
          1.98752,
          2.020404,
          1.9325315
        ]
      },
      "eyeHeightM": 1.420404,
      "alignmentConfidence": "review",
      "alignmentNote": "Derived from scan_output_1_lady: floor from the room mesh, room from the scanner's own walk. No published dimensions for this room; derived extent stands unchecked."
    },
    {
      "roomSlug": "north-gallery",
      "captureDir": "scan_output_1_north",
      "splatType": ".sog",
      "totalSplats": 5336692,
      "totalLevels": 4,
      "tiles": [
        {
          "file": "0_0.sog",
          "bytes": 7056493,
          "sha256": "fedabe84cee8a8483c5b6f1b7bf783270c399ead92524244b183f5dcae650076",
          "lodLevel": 1,
          "isEnvironment": false
        },
        {
          "file": "0_5_0.sog",
          "bytes": 9489661,
          "sha256": "017d5bfaeb453f6aa9bbd6ceec2be47deafc2900fe73396eca3e621dbb140d74",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_6_0.sog",
          "bytes": 4500500,
          "sha256": "3725a28a4b999a1381e8925b29eade3782dfa4cefb5419d4c3d01e99b3905062",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_1.sog",
          "bytes": 9626382,
          "sha256": "6993fcc04d2a3d647f4fe3d77a9ddfd4be062b3d11fb79b2804212a81bb03bd1",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1.sog",
          "bytes": 9372717,
          "sha256": "fefceff951cca76c0fd6e90399aed96f5e92fbb6f5a8bcb1ffe23538578290e5",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0.sog",
          "bytes": 7110322,
          "sha256": "4014c587fd5801ac4a6ab00dcef38cdab83f2156bbb220ebe3653a66222ee8b0",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_0.sog",
          "bytes": 9193728,
          "sha256": "2c3a719298b412018e2750ace91fb99f877d68895101aa10fa62332deaf6fddd",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_1_0.sog",
          "bytes": 9586076,
          "sha256": "ddfaca78a85f0ec0319e468a931124b0a6b169b2f6940fdcfe442369ba3ff602",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_4_0_0_0.sog",
          "bytes": 9855066,
          "sha256": "91c8a015213ce2c398e2e2981d23eea50c3868011c376f67bfb8132b45802c07",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1_0.sog",
          "bytes": 10161477,
          "sha256": "95cf57c52149b4a0ee4f946fa4619cc3fe2a312067c2d71f53ecffc8cd7a7370",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_1_0.sog",
          "bytes": 9438884,
          "sha256": "9942987e877c385e6e65a51331c385ac1780f40f52f8bec562463c9a09cf1c55",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_1_1.sog",
          "bytes": 3227543,
          "sha256": "bc56a8a5a1b41666b2558693791ec1cac89ddec4f84d38cd27a7f4897a8b7003",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "env.sog",
          "bytes": 110147,
          "sha256": "18bd1da150397ce7abdb63191930f04d294f4e1248c65db5b0c8236e32f2b74e",
          "lodLevel": null,
          "isEnvironment": true
        }
      ],
      "totalBytes": 98728996,
      "transform": {
        "position": [
          2.3850154999999997,
          2.0359374999999997,
          -4.801727
        ],
        "rotation": [
          -1.5707963267948966,
          0,
          0
        ],
        "scale": 1
      },
      "extentM": [
        8.997021,
        3.4765625,
        9.60558
      ],
      "spawn": {
        "position": [
          0.05008649999999992,
          1.9172004999999996,
          0.1720940000000004
        ],
        "yaw": 0
      },
      "bounds": {
        "min": [
          -4.4985105,
          1.3172004999999998,
          -4.80279
        ],
        "max": [
          4.4985105,
          2.5172004999999995,
          4.80279
        ]
      },
      "eyeHeightM": 1.9172004999999996,
      "alignmentConfidence": "review",
      "alignmentNote": "Derived from scan_output_1_north: floor from the room mesh, room from the scanner's own walk. No published dimensions for this room; derived extent stands unchecked."
    },
    {
      "roomSlug": "south-gallery",
      "captureDir": "scan_output_1_south",
      "splatType": ".sog",
      "totalSplats": 5199073,
      "totalLevels": 4,
      "tiles": [
        {
          "file": "0_0.sog",
          "bytes": 6959206,
          "sha256": "3dc337a1963c370a99378cc61c7d06e1ab4b1d57de28e8c6553c9111a0101d0e",
          "lodLevel": 1,
          "isEnvironment": false
        },
        {
          "file": "0_5_0.sog",
          "bytes": 9362169,
          "sha256": "9bb5c93c4a6307a3ebbef70a4e0f7070649a013088359e6e18ff8ecc8d9f880c",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_6_0.sog",
          "bytes": 4443538,
          "sha256": "2c2022a299be2002142a4b08ea7091be745318aed0d1143f87f9cc897afe4acd",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_1.sog",
          "bytes": 9243070,
          "sha256": "19274e0e83acdc004cb7c185d06ac0e6aadb703c5540b3f67d9abc3198170689",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_1.sog",
          "bytes": 9405920,
          "sha256": "3b22238263c1c82115611297d5ab8f1b1762a4ca26bd8293689bb737d13e39ee",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0.sog",
          "bytes": 7082585,
          "sha256": "bc2bf9e3035c456f4ca4b75b9932d927b8f61f62428663d64b4495aa2bbafb8c",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_1.sog",
          "bytes": 10602707,
          "sha256": "54e58fdab91b347f27654654c4ae189fd885713aa03ebed9c76e24f825f19609",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_1_0.sog",
          "bytes": 11550736,
          "sha256": "496489e102af5f4db7dc376a29d46c44131adca8a4513cbadc242f70b93d524b",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_0_0.sog",
          "bytes": 10061959,
          "sha256": "f9e3498f7cdc5367a1459c7d8a97f41adc34a8a01df311cb28b652677ab5ac64",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_1_0.sog",
          "bytes": 9426298,
          "sha256": "abcc1493668db3c9e01cd8ee6b7c164ef6ef8ed652ec745e3c3dfb2d1c004f4a",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_0.sog",
          "bytes": 7163770,
          "sha256": "23e73ec8779ac4c3a2f1f12b0f24f78b14f7e164a5dcbcb727e93f385f74d7e4",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "env.sog",
          "bytes": 115576,
          "sha256": "c820be095251b34fca4016ef6944b63d29cb8048079a7274663f6ffbc38cfa1d",
          "lodLevel": null,
          "isEnvironment": true
        }
      ],
      "totalBytes": 95417534,
      "transform": {
        "position": [
          1.2855400000000001,
          1.882192,
          -5.021098500000001
        ],
        "rotation": [
          -1.5707963267948966,
          0,
          0
        ],
        "scale": 1
      },
      "extentM": [
        5.059118,
        3.4910959999999998,
        10.427301
      ],
      "spawn": {
        "position": [
          0.6730700000000002,
          1.836213,
          -1.196351500000001
        ],
        "yaw": 0
      },
      "bounds": {
        "min": [
          -2.529559,
          1.2362130000000002,
          -5.213650500000001
        ],
        "max": [
          2.529559,
          2.436213,
          5.2136505
        ]
      },
      "eyeHeightM": 1.836213,
      "alignmentConfidence": "review",
      "alignmentNote": "Derived from scan_output_1_south: floor from the room mesh, room from the scanner's own walk. No published dimensions for this room; derived extent stands unchecked."
    },
    {
      "roomSlug": "deacon-conveners-room",
      "captureDir": "scan_output_1_DC",
      "splatType": ".sog",
      "totalSplats": 7948346,
      "totalLevels": 5,
      "tiles": [
        {
          "file": "0_0.sog",
          "bytes": 5776458,
          "sha256": "fae79b8ddf92f01b553c0e30e506f4ba7ba6e9ea59ed1758e61291c6c779bf93",
          "lodLevel": 1,
          "isEnvironment": false
        },
        {
          "file": "0_7_0.sog",
          "bytes": 9532759,
          "sha256": "7a7d5d162ded6b25c19502c53711e7393cf5fccc56f1a16a0eda675aa80e70ff",
          "lodLevel": 2,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0.sog",
          "bytes": 9472860,
          "sha256": "4f0003176cc379899895126338acfb7ee8821e2e6be2c118990aedd6fe5a345e",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0.sog",
          "bytes": 9495859,
          "sha256": "d7e34566c68c7dc39f1e248375dcc71346d5b858381a8203112b0562e339abca",
          "lodLevel": 3,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_1.sog",
          "bytes": 9423057,
          "sha256": "ddb9769bdbe835a141551e899b2ee5c2ceb0d0c1b80be785543497979c0e3c1c",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0_1.sog",
          "bytes": 9651951,
          "sha256": "39573efc11cf2a95c6f68304fbfd3aced189e1165bf6768524a4d15207593c72",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_0_1.sog",
          "bytes": 9679864,
          "sha256": "77ea967efc3add0c1ed10de94f41e9c2f73bca9829a2c5754ec2ea46c62b1740",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_1.sog",
          "bytes": 9444195,
          "sha256": "b4a8e8999c65c02c4dda96b15f2cdfde6c0c7b8b02f93b702599c7febafea3c6",
          "lodLevel": 4,
          "isEnvironment": false
        },
        {
          "file": "0_1_0_0_0_0.sog",
          "bytes": 12328074,
          "sha256": "b99b29ec240d50089e5e3e5c5a10e1dd87500492c68b21f79db585504a2979cd",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_2_0_0_0_1.sog",
          "bytes": 9237677,
          "sha256": "a77df3473b7a4e627d1446806d8ccade5819a34f7031197a13382866838c58cb",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_3_0_0_0_1.sog",
          "bytes": 10185247,
          "sha256": "faef9aa939ddbcf18a5b97c78ee7b2a3d380211f9632a21d7925892664743c87",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_4_0_0_0_1.sog",
          "bytes": 9922426,
          "sha256": "bd1a3daf04a0770bcb48d5ccd2376a8e20b05a4ddd6f19a4e177d315cc1c7661",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_5_0_0_0_0.sog",
          "bytes": 9144672,
          "sha256": "cf325908875bd4401f73dfb2c2c951b341a10e93002e5e7742a5de005623cb11",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_6_0_0_0_0.sog",
          "bytes": 10521268,
          "sha256": "00118884a59b2b4f112057e22afe3c9e299d4abddef40e8e3475825963a2af57",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_1_0.sog",
          "bytes": 10010896,
          "sha256": "099446e515d1e440233d082b5dc9973eda15e317e18b1641f942244d63f5918c",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "0_7_0_0_1_1.sog",
          "bytes": 3743383,
          "sha256": "b48b2eb1770c41bd77e48446ec1e447ad003f46571332a235f8cb484d7b66eb7",
          "lodLevel": 5,
          "isEnvironment": false
        },
        {
          "file": "env.sog",
          "bytes": 112555,
          "sha256": "617f1fcc3a6fe60eb4c11b38093e3bf40fc0a7fe9bffa20a3edc65418d7b52db",
          "lodLevel": null,
          "isEnvironment": true
        }
      ],
      "totalBytes": 147683201,
      "transform": {
        "position": [
          0.4372404999999999,
          1.4861708229166664,
          -2.973467
        ],
        "rotation": [
          -1.5707963267948966,
          0,
          0
        ],
        "scale": 1
      },
      "extentM": [
        5.3077950000000005,
        4.796947822916666,
        6.2467999999999995
      ],
      "spawn": {
        "position": [
          0.3492844999999999,
          1.4407078229166663,
          -0.06135399999999969
        ],
        "yaw": 0
      },
      "bounds": {
        "min": [
          -2.6538975000000002,
          0.8407078229166663,
          -3.1233999999999997
        ],
        "max": [
          2.6538975000000002,
          2.040707822916666,
          3.1233999999999997
        ]
      },
      "eyeHeightM": 1.4407078229166663,
      "alignmentConfidence": "confident",
      "alignmentNote": "Derived from scan_output_1_DC: floor from the room mesh, room from the scanner's own walk. No published dimensions for this room; derived extent stands unchecked."
    }
  ] as const;
