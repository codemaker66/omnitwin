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

/** A staged file, named relative to the room's directory. */
export interface GeneratedSplatFile {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * A prebuilt Spark level-of-detail tree for one tile: the header (`file`)
 * and the chunks the viewer pages in, all under `lod/`. Loaded with
 * `paged: true` and WITHOUT the `lod` flag, which would rebuild the tree
 * the file already carries. `splats` counts leaves and interior nodes.
 */
export interface GeneratedSplatLod extends GeneratedSplatFile {
  readonly splats: number;
  readonly chunks: readonly GeneratedSplatFile[];
}

export interface GeneratedSplatTile {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Octree depth: 1 is coarsest and loads first. Null for the sky shell. */
  readonly lodLevel: number | null;
  /** The environment sphere, which is not room geometry. */
  readonly isEnvironment: boolean;
  /** The tile's prebuilt tree, once `lcc2 lod` has built it. */
  readonly lod?: GeneratedSplatLod;
}

export interface GeneratedRoomSplatBundle {
  readonly roomSlug: string;
  readonly captureDir: string;
  readonly splatType: string;
  /** Sum over EVERY level. Not what one level draws - see splatsByLevel. */
  readonly totalSplats: number;
  readonly totalLevels: number;
  /**
   * Splats per level: `splatsByLevel[level - 1]` is tile level `level`,
   * with level 1 the coarsest. Every level is the whole room at a different
   * density, so drawing two levels draws the room twice; the finest level
   * alone is the complete reconstruction.
   */
  readonly splatsByLevel: readonly number[];
  /** The deepest octree level: the full-resolution reconstruction. */
  readonly finestLevel: number;
  /** How many splats the finest level alone draws. */
  readonly finestLevelSplats: number;
  /** Every staged tile, all levels. The runtime picks one level to serve. */
  readonly tiles: readonly GeneratedSplatTile[];
  /** Bytes across every staged tile, all levels. */
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
      "splatsByLevel": [
        355593,
        715516,
        1451051,
        2945194,
        6019684
      ],
      "finestLevel": 5,
      "finestLevelSplats": 6019684,
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
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_0_0_1_0_1-lod.rad",
            "bytes": 2520,
            "sha256": "f6de145b6690079f9c4d01216948418a4235a4f09d1815c03114c8aeb6fd75af",
            "splats": 762279,
            "chunks": [
              {
                "file": "lod/0_0_0_1_0_1-lod-0.radc",
                "bytes": 2986248,
                "sha256": "7830a9871b1293b4e92a343f9bf960d8232d06807861f0780bef776b4ff4aac4"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-1.radc",
                "bytes": 2721848,
                "sha256": "be54c73b6269fa948c8c5b698d20cb91b675d4db350913157186b30c307ecbe6"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-2.radc",
                "bytes": 3035272,
                "sha256": "8fcd43665dd1fe09b4691894609e3102bc9e6643c7d0ac1e69d17ddd2ac991fe"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-3.radc",
                "bytes": 2977720,
                "sha256": "b79a84c8485a0c29ed34eaa0702e2b96632cc8e572626c68744f29d0348990eb"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-4.radc",
                "bytes": 3029168,
                "sha256": "932de8d663b7a0b649a1c8623a936154a2e81c0587206b6a7524a04c204755bb"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-5.radc",
                "bytes": 2947176,
                "sha256": "5833537b4c5a52b82e8a7815e7185557c0d015426bca9a46664d237bd2a8d2f9"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-6.radc",
                "bytes": 2993368,
                "sha256": "84b2c593b191b415090f61edb7064584197f7479087d9469e4726aba94ce9856"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-7.radc",
                "bytes": 3037264,
                "sha256": "e429d78a2e97df228be2430d5b1273af04de7d23c39c9ca0760868fc692aec8a"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-8.radc",
                "bytes": 3072720,
                "sha256": "410dc68790ee00611c94f35f0444dbc8a456e6944f7c8245b68a667b4f312245"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-9.radc",
                "bytes": 3165440,
                "sha256": "2e9534843ccbfcb29b3ce5549668e86966867919e0430233d776af4c7dc957ea"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-10.radc",
                "bytes": 3088480,
                "sha256": "f5c1be51024e9a9615f218ae09cb0edd98afb8c85b9ebe487ca813f9c8a38bbf"
              },
              {
                "file": "lod/0_0_0_1_0_1-lod-11.radc",
                "bytes": 1993056,
                "sha256": "3bf32f79daf788e5ea4f177a8023ce481143ad6ace87ac39d3d1c93e569c1dcf"
              }
            ]
          }
        },
        {
          "file": "0_1_0_1_0_0.sog",
          "bytes": 9500250,
          "sha256": "2b0c0cce30cb31a34b253d5985985b3d547debe8bca1a97401eb72ab3ad3bdbf",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_1_0_1_0_0-lod.rad",
            "bytes": 2416,
            "sha256": "fbdb05c504e77fb01c4ab0601db4d52a054a6a4f4b85dd1c8db42bb4a79c8937",
            "splats": 720086,
            "chunks": [
              {
                "file": "lod/0_1_0_1_0_0-lod-0.radc",
                "bytes": 3043720,
                "sha256": "a83af43c40ea460204025b72ffbb4d51154923d7f7d313f55b48ef148fd073d3"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-1.radc",
                "bytes": 2679968,
                "sha256": "81ce1600a6c92ca102884c36aad1cfd09c0bab290f2af9004755d87f420b1ddd"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-2.radc",
                "bytes": 3270792,
                "sha256": "155bf20e6fd373f3b281b85f44ff4cbbbeacfdfab13e48fa4a261048fb534601"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-3.radc",
                "bytes": 3285512,
                "sha256": "213c960397519219d6f43e2ba8d4358e2aaf23e555d7fd983a4d505808b62b3d"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-4.radc",
                "bytes": 3118352,
                "sha256": "88ad50cc956251cd80fd3a6894fee4b8f2eede9f7591a58eeec10a27447f7ebf"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-5.radc",
                "bytes": 3018840,
                "sha256": "42c50d56a9788ad8c1a29b480007186d85b32fe943845c88baa762675fb34338"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-6.radc",
                "bytes": 3023280,
                "sha256": "9764c0a21619d45b0dca28f91d7287cbc50a5f3917c33da5936321801c1243b4"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-7.radc",
                "bytes": 3207480,
                "sha256": "9a1d1f60e2519f17da75da6883f95dadd2c5aae4859dbaa40211c4180e1b4b3d"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-8.radc",
                "bytes": 3215184,
                "sha256": "86d06f8f7c9271040ffdb09655d2cafdd4c9a48233751be7f867fb51047112fe"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-9.radc",
                "bytes": 3387288,
                "sha256": "f1d0213f7db2353a3c62e7b996c2079b7462466d2f65214cb673b52e249b8e1f"
              },
              {
                "file": "lod/0_1_0_1_0_0-lod-10.radc",
                "bytes": 3200032,
                "sha256": "33165b750fcdc23a056fc5b6c1fc2d171b1434dd0fcdb33829ec2b504c8c3ac9"
              }
            ]
          }
        },
        {
          "file": "0_2_0_0_1_1.sog",
          "bytes": 10575631,
          "sha256": "b354ba55785e73a42aa4d108ac0c1fb93c333cbf5bd881e6c75149c2cecccd3e",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_2_0_0_1_1-lod.rad",
            "bytes": 2616,
            "sha256": "76d73a51874b4cf55964dd7706321f9077cf6f47040e01fad1c5a7025ca719ce",
            "splats": 839215,
            "chunks": [
              {
                "file": "lod/0_2_0_0_1_1-lod-0.radc",
                "bytes": 3192104,
                "sha256": "e3bafab458688c63b67ebd2449ebb6d2c037bbf7f3893cac04a49aad2e20b8ab"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-1.radc",
                "bytes": 3399976,
                "sha256": "5bd9c84a91fd987a79bee827027019b136b280bce24a9cb330314a446014612f"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-2.radc",
                "bytes": 3103952,
                "sha256": "e58219593f80c5362c7b197f6e2c11e57c38b9cd3684cd10798a5e0b63516491"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-3.radc",
                "bytes": 2999472,
                "sha256": "64f3cfaf3cc45d959c2f0d560f4abc85f66c7a6a50db182ec0c8d34df88b976c"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-4.radc",
                "bytes": 3309328,
                "sha256": "d64416bdce433489fe2ebc3d8f43851f6f1a8a0b80c8aa5d01e14a3d4a1d89cd"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-5.radc",
                "bytes": 3174776,
                "sha256": "55ab7d6ca15741c4f99bcc01316c863e772ae5217608ae94fc050b17577ce189"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-6.radc",
                "bytes": 3242904,
                "sha256": "379f8fd15e57da4737bb1fc34c3bea3ddbd7de25834b48755faa3a9b59372b54"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-7.radc",
                "bytes": 3329624,
                "sha256": "d9a6a39e9f9432215d647ae4319ef509b588acec4c379a847def1a0a2c12f211"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-8.radc",
                "bytes": 3332480,
                "sha256": "ef60a6ca7499b1989d78bf9d1b56a6757cf1e9da2f1506b13b0bc6bfb6f6d9d9"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-9.radc",
                "bytes": 3314008,
                "sha256": "2f5c643687242a82c7d0ff138931da90cef3da8d2bf6659560a18d0469b1e85c"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-10.radc",
                "bytes": 3403240,
                "sha256": "5a6af071c55c756afe7fa9da17d8733f8fe55db9fa1b9eaa9a2d6b0984607833"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-11.radc",
                "bytes": 3381208,
                "sha256": "a3288a6c4c374110376b591c90b8ae2b0595dac3c70c77b96863e8568f889dfd"
              },
              {
                "file": "lod/0_2_0_0_1_1-lod-12.radc",
                "bytes": 2686528,
                "sha256": "f896f8aa9dab834acc7047dd4035d02f1fc1de8b753a5a74cfac75443a1acc92"
              }
            ]
          }
        },
        {
          "file": "0_3_0_0_0_0.sog",
          "bytes": 10376269,
          "sha256": "e590fb5d7488071c63f10df33b31e451f3c0348c2209f1bf594015c28a1fff24",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_3_0_0_0_0-lod.rad",
            "bytes": 2616,
            "sha256": "8ff5e147912470e1d019fdcf3de69761ab20eea7de130dac668dad651465bb6f",
            "splats": 836073,
            "chunks": [
              {
                "file": "lod/0_3_0_0_0_0-lod-0.radc",
                "bytes": 3147152,
                "sha256": "6ec84fae17428f9e326b1b499d8f404d2b618034ba9e48d6c2137fa2ce79a339"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-1.radc",
                "bytes": 3284504,
                "sha256": "453070a1edad0a23780331398fad10a40ff22e5ab4dd2bfbcb90e196bb72ee7e"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-2.radc",
                "bytes": 3260960,
                "sha256": "58ea306b03ea8b178fab9b829715b70f331aade056d2a856d4d0b26fef5dd933"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-3.radc",
                "bytes": 3366136,
                "sha256": "c298b57656b276f7ab2bad361fe1b0f61953c8c8a689fae3a5bc3d994545b1dd"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-4.radc",
                "bytes": 3010928,
                "sha256": "ca91210538cdebcbd6a7a0a84f45493a89e8b5c0b11a0e6cbc0f382484ab7343"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-5.radc",
                "bytes": 2958136,
                "sha256": "7bf79bd3069cfc3758d0403b85dee52d63decaed5f7e1f4bd47a98104204c37a"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-6.radc",
                "bytes": 3442128,
                "sha256": "b8127f299c22a109123b4aab1b41429fa43d1dc8f2d75c08c66373a0dae1962f"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-7.radc",
                "bytes": 3364272,
                "sha256": "547fd4f53cd499c1519a9700cc7def60fec318cd9518ab66a236559cb5686131"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-8.radc",
                "bytes": 3187744,
                "sha256": "ba2fdc277056b50f4a672e7beffabe9273149a7e2210f07bbff8a1fd604d94df"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-9.radc",
                "bytes": 3118336,
                "sha256": "be2157f7994bf72c4ffc13d1a5cc2acf516bd87e1bb5812eca386ecd697e8f51"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-10.radc",
                "bytes": 3072808,
                "sha256": "5a9dc8817714d0dbf5dff6925515344fb38bcf3761ff62fe0b13d9a441cd17ce"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-11.radc",
                "bytes": 3412816,
                "sha256": "d6a1c584023e282478350e48e4b9c439cef7e3024839725718cc29d18ce3d1aa"
              },
              {
                "file": "lod/0_3_0_0_0_0-lod-12.radc",
                "bytes": 2454536,
                "sha256": "9128cd6c791a2f7addd24a1810d3d601e867b98c6eb57180d8fcebfd9d7a3f67"
              }
            ]
          }
        },
        {
          "file": "0_3_0_1_0_1.sog",
          "bytes": 10207866,
          "sha256": "84b2ff813e0746d8fc8dfcc9d044dba15fef5f62ca137794c30989c04ba82a9d",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_3_0_1_0_1-lod.rad",
            "bytes": 2616,
            "sha256": "970549da6cbd7ac886e0134863543bd3d4b4ca6d6471be04e392484be18091cb",
            "splats": 802904,
            "chunks": [
              {
                "file": "lod/0_3_0_1_0_1-lod-0.radc",
                "bytes": 3015488,
                "sha256": "b89187d09a9bccc06c088ff5dfd067d585b001d3050b482244a969e0fd895a80"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-1.radc",
                "bytes": 2973888,
                "sha256": "9c77dbc5a6b9dd013325caf7cd3531f2421c4ff7fe9f7cfd5cacab877b3c8e53"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-2.radc",
                "bytes": 2687616,
                "sha256": "df98be480fcdcb022b01c9837e0c4c590f0f473703abe53da2d46db77d0c0d29"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-3.radc",
                "bytes": 3139576,
                "sha256": "c09f0248a9bc4aa45026a2e99fa8f20e301949e9f8fc8e99b917109c65d55635"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-4.radc",
                "bytes": 3098344,
                "sha256": "937ea72b98d285e36ee2a3d2302fee5f0127e478338d647673d189ff48e65487"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-5.radc",
                "bytes": 2964824,
                "sha256": "e02ffa65a162c22dd5167389ff275d9e6c3dc5388e43296d2e7a54c89fc183c7"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-6.radc",
                "bytes": 2976176,
                "sha256": "f868be327c854af61c4b469a0911323ce471f8d6cc60989c76311af66ea73b1b"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-7.radc",
                "bytes": 3056656,
                "sha256": "2221c2b4e9df8ebb3323f577a4ce7e3a51197bb06102d6f793050ff59c0de912"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-8.radc",
                "bytes": 3094112,
                "sha256": "6e08a585f3d0c911b4f34b72336f46dada1fadb4130757dac551ae83a9755351"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-9.radc",
                "bytes": 3142048,
                "sha256": "dcd0d0924d1312ec6dcec161d81a7dcca8d6ddbadab420e2ddd69561ad6d53a7"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-10.radc",
                "bytes": 3262000,
                "sha256": "bd113f9d2648bb0e5c11d9d092fa334f624af41f78049d110c35567657395ab2"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-11.radc",
                "bytes": 3191984,
                "sha256": "8898b4d7b3318415532fc835e46c2625536230c045f17676d371560bf4a11805"
              },
              {
                "file": "lod/0_3_0_1_0_1-lod-12.radc",
                "bytes": 803632,
                "sha256": "ab0c97030397b7b12bf427d6f9564eb7fcc1366c28023c46e7f3602405010711"
              }
            ]
          }
        },
        {
          "file": "0_4_0_1_0_0.sog",
          "bytes": 9199768,
          "sha256": "5863e052c6f99316914df9168829543b82fb35db0118b5e02d30e4d326a79d03",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_4_0_1_0_0-lod.rad",
            "bytes": 2416,
            "sha256": "bb9c42670eb2d99c36e70bf721145071449ef87e77f2777ec1f43b2eb74e0688",
            "splats": 704252,
            "chunks": [
              {
                "file": "lod/0_4_0_1_0_0-lod-0.radc",
                "bytes": 3086336,
                "sha256": "a3957667840cf2549b617776b5fe81d8beee5798b8abde4c6bfb443cb125132e"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-1.radc",
                "bytes": 3168504,
                "sha256": "7450bd4407afadc3e37cb7904273b87413591b496cfae0959281cdcda4ec7c4f"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-2.radc",
                "bytes": 2683464,
                "sha256": "ab83d3fc598a6cfd7f89eeaf235205ee4853b359bef02dce53d53e3d762d45a5"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-3.radc",
                "bytes": 3154528,
                "sha256": "8a843ada0475150a1b00868736ac9b988ab34aa558e564a7458a5d0a44eeb90f"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-4.radc",
                "bytes": 3023648,
                "sha256": "3d5b76c355439b23e6540ee8f0bb5897a0660011d381c27b9fb730d2478d0544"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-5.radc",
                "bytes": 3054208,
                "sha256": "349dfb4fd73471feeec12d4d552accd470df639ca75fa505f459245c5301db24"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-6.radc",
                "bytes": 3186016,
                "sha256": "ac7f2f6e509b15d8d09e57a738c946ed45be72acc673c5f74f384ae8a7eb84e2"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-7.radc",
                "bytes": 3156656,
                "sha256": "f9ff2c06ec8d22b6fcfa9ad1f30f2ceff077da5325c69fe55a6b402a987a2404"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-8.radc",
                "bytes": 3352608,
                "sha256": "18f117cfd9961798623bcae7c52bd682770e0f07feb0edef764dfdccf61eccff"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-9.radc",
                "bytes": 3155624,
                "sha256": "948b3eea87d8685da2a9246dd75e06054216a2a71ba83907ee802b0491fd0045"
              },
              {
                "file": "lod/0_4_0_1_0_0-lod-10.radc",
                "bytes": 2416376,
                "sha256": "f6b435abff3c80585ee66d527a4b43110d5771e3c8cb81d8eba26f09e5c0cda2"
              }
            ]
          }
        },
        {
          "file": "0_5_0_0_0_1.sog",
          "bytes": 8975642,
          "sha256": "65fd21b69a1def23cb4bd5b756da7ac03e4451a476a80a61c47b853a0366a8f1",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_0_0_1-lod.rad",
            "bytes": 2416,
            "sha256": "afca28577ca81f5d4359ac872fac9c08ee1465025a09c097c0465c5ac07b58b1",
            "splats": 697799,
            "chunks": [
              {
                "file": "lod/0_5_0_0_0_1-lod-0.radc",
                "bytes": 3216704,
                "sha256": "d3838359083cba7a9ffc7889426e145d0952a466305f0e9d7714207bde7ed44e"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-1.radc",
                "bytes": 3301840,
                "sha256": "cc0bc24a8b1df69e728efcb7c7a3e247ed053187cefaf332f290a34c51cfdc2d"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-2.radc",
                "bytes": 3118216,
                "sha256": "abb4eae505f2eeff43f30158dfd1c4f59e85de592fbb40812e05c46f745d81cb"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-3.radc",
                "bytes": 3413712,
                "sha256": "07c4198b88288e4d84dd784c346153bee099f0a19e331dd416458d44f3c8631b"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-4.radc",
                "bytes": 3481120,
                "sha256": "c61e4005f43e5c263d37ed7e661b9bdc73d59d994633ecd5b73e6023864201b6"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-5.radc",
                "bytes": 3393408,
                "sha256": "81d3edc589fcd5adf39b3240af71cb15c8ce208a7cd1449b2fae05989481d4ed"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-6.radc",
                "bytes": 3389320,
                "sha256": "14eea54a06c1dc0b1c85bd2e970e8a70cc036a2ea4a17e034b93c679a85a641d"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-7.radc",
                "bytes": 2981568,
                "sha256": "4d12b2718a0edf64ab2de5702d68454a1dded5b114e2a04b91b33642b9db3efe"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-8.radc",
                "bytes": 3471296,
                "sha256": "7878915272a3fef10db3fff9e6a5e3af755f22c3256fe8a60cee5f6797fa2b05"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-9.radc",
                "bytes": 3462376,
                "sha256": "025ff89e729d4fd30dcf91e0b05a3278a45f7fbbe4646dbdbaf3e4ea62a530dc"
              },
              {
                "file": "lod/0_5_0_0_0_1-lod-10.radc",
                "bytes": 2292416,
                "sha256": "8eeb4c92cef74891ba83c355f0f288381a3cef8ab3f25ab1d93d25ec4207e141"
              }
            ]
          }
        },
        {
          "file": "0_5_0_1_0_1.sog",
          "bytes": 9708760,
          "sha256": "d3272fee659e486190af1d2ac9427c39e5536bc85b90b5570df4b6e9e9124631",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_1_0_1-lod.rad",
            "bytes": 2520,
            "sha256": "70141ce4c6604ffdee8163c7bc585d957e9f6b0a1234ce194913d89e160d9350",
            "splats": 758882,
            "chunks": [
              {
                "file": "lod/0_5_0_1_0_1-lod-0.radc",
                "bytes": 3105448,
                "sha256": "a02ab961cadfaba33cc314267870b897d0843b13917eb589d329a1185c620f10"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-1.radc",
                "bytes": 3050224,
                "sha256": "5561fcba20f324e34294be68462323d66bed10b915acf846445332bb2b034f21"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-2.radc",
                "bytes": 3302936,
                "sha256": "07052ee77c4b2d3eca96e17da024bde7e3bf06d3ebfd9233850673d326506a43"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-3.radc",
                "bytes": 3120520,
                "sha256": "6f4f62f2cfac6af571b97c2019492fdb4966c38145e115bb5e33e39d5f6247cc"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-4.radc",
                "bytes": 3114816,
                "sha256": "85c1272c90e80e2d066c29fc00ff2473a41690a36bfa7f8c2a992820505f1da3"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-5.radc",
                "bytes": 3083832,
                "sha256": "dcecda53da82a1041b950fa6b6a7e8d7eab4203a564c562a591033a280ed2bd9"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-6.radc",
                "bytes": 3277128,
                "sha256": "a0db228128da82afd20e21fc252085d18cce0b6ad2dbb5749587908d7bdb0f6f"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-7.radc",
                "bytes": 3315800,
                "sha256": "5550f0351b57bbc1b3ba53c40661e54476b2ed979ac12f65c7f586c7572cc475"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-8.radc",
                "bytes": 3469528,
                "sha256": "077a066f6015c6f6f96d7dac753c13ff0452273e89ed953cb12a8c3efd37bc76"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-9.radc",
                "bytes": 3388384,
                "sha256": "99c37ed0e5ba0cbf6d8ec3714b726625586778702f9fbdbc8c7faa5a07bd831e"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-10.radc",
                "bytes": 3460592,
                "sha256": "ec02b641865f0b153e263cf6dd6c0cd36540ff89828c753b5118268c431c136a"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-11.radc",
                "bytes": 1994856,
                "sha256": "325cddfc8ccb27628b78701a416427bcf557e3c93e0c6bee653cb5b0a8780b84"
              }
            ]
          }
        },
        {
          "file": "0_6_0_0_0_1.sog",
          "bytes": 10231737,
          "sha256": "18e23290236bb3f220df2b59f6f255a421151c0f1da7ed633bd00d06eddf0171",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_6_0_0_0_1-lod.rad",
            "bytes": 2616,
            "sha256": "9a9801e07617966bb2e5252e4a19504bac10ac5173a1c87339aa77e21b976446",
            "splats": 826882,
            "chunks": [
              {
                "file": "lod/0_6_0_0_0_1-lod-0.radc",
                "bytes": 2996752,
                "sha256": "97a47127b2957030bfa186cc33f0d8d7c6dbb55a1752db7876b1e3007fe96ae7"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-1.radc",
                "bytes": 2875696,
                "sha256": "8cb63d0f6ac128795762019dca1f78ea18d6d9093cca194fba2fb559e0b81771"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-2.radc",
                "bytes": 3351672,
                "sha256": "6334bc2a732f41d471548ecfb165e6b0759cb98c4f307ecc81e5f691cb32f3ff"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-3.radc",
                "bytes": 3160968,
                "sha256": "c2bf6db0e1e96bc860700931fae2bdc5411bf9d3f9339c359858d3b313f42e48"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-4.radc",
                "bytes": 2874640,
                "sha256": "70156611e066ed5d229a544c270a1e096beed584fb7b7e893088df7e1005efa7"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-5.radc",
                "bytes": 3065272,
                "sha256": "a000f976365699ad97d2ab105311b4c91e928945460b8856c07f5c462a4de518"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-6.radc",
                "bytes": 3106512,
                "sha256": "89b4c9be4ec641c26376f8cd3fd1bebac359d07b8dfd3ee561c8cba87c4834c2"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-7.radc",
                "bytes": 3253648,
                "sha256": "9f0f8624cfdfa614f7064ebd7e7cb1afd4b2605008a523746b9946c14339bd2b"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-8.radc",
                "bytes": 3250144,
                "sha256": "359a9f96b3b3a29a4fb89858fc1396a1a644f8af61de5d949f0c8aa86d4555eb"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-9.radc",
                "bytes": 3152336,
                "sha256": "1b4fc471ac8a74877e9ab00df98bf36f98cebeb2cb7dd3c7f44edf2e353f3ea3"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-10.radc",
                "bytes": 3228584,
                "sha256": "244b8c6fafb40c0d831a7f842f2a2be9a6db782600f59f343f24e996e037b9aa"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-11.radc",
                "bytes": 3106272,
                "sha256": "ac8f04c91c69e74fdca20640475fc759081b48a23d49faaad65f0424fe4baacd"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-12.radc",
                "bytes": 1989320,
                "sha256": "622b13c8be1abe5a8243b87b173df8cc4c8b9bd38c4346aba7bd3c94361574bc"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_0_0.sog",
          "bytes": 9417293,
          "sha256": "7c4cca3644294c2955cfe9e41f387e70ce79e1aedcca132392c0493325ce4386",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_0_0-lod.rad",
            "bytes": 2416,
            "sha256": "b8aeabe7d99c0efd3f7f5607316426bbbf82eac238bfa5371a83eff05e4b6c96",
            "splats": 720690,
            "chunks": [
              {
                "file": "lod/0_7_0_0_0_0-lod-0.radc",
                "bytes": 2931368,
                "sha256": "ac6ac6edce32bebc3303a5ab2bff8293053521db2e23b786ad2d32b077a6b1f3"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-1.radc",
                "bytes": 3008056,
                "sha256": "5d3121d2dde0c7778113186fd442a8a2341631695e8c86dc9705a72df777f1b1"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-2.radc",
                "bytes": 2954744,
                "sha256": "718f8d60efe4def4de33051faaf8223ddc0befd37e3ed9b496805af30afd3b8c"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-3.radc",
                "bytes": 2495160,
                "sha256": "743ff903b101819f30c0a1eebe1b40f643e54766cb186b8f9b79c1c47d33f977"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-4.radc",
                "bytes": 3060256,
                "sha256": "d7dc3393b45cd8c7789db47c9bcede48ed0fcc1ab22e333809715df4fd108be5"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-5.radc",
                "bytes": 3181456,
                "sha256": "753a4ba02988663b68c4c3525d2c6b1f57f7e6045d9f2ad4eb38d6eefbd33dc8"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-6.radc",
                "bytes": 3343408,
                "sha256": "434a4729b9a32645cb7d8e77ddaefdf885aebd28883b2c687712a781ce49c2f3"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-7.radc",
                "bytes": 3242496,
                "sha256": "f6623c09eead3e2aaea7083f94800483b4b420db65ec4460f3213794a3e32b78"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-8.radc",
                "bytes": 3116952,
                "sha256": "df4bd100dd6ea186b43e684dbeb73f369577d5a30953a9d7e0dce0ba91c482df"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-9.radc",
                "bytes": 3136952,
                "sha256": "4fc0fb1e5a7da849f11b9aaea14e65c2c46e63d8bfdefba1000bc1dbae60ee9e"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-10.radc",
                "bytes": 3330304,
                "sha256": "292f0ac732d75bdc1091bead3770eac8be71b4e1a5c565e1759f90233bbdbae4"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_0_1.sog",
          "bytes": 8306348,
          "sha256": "5e4409b07084ce7089e77a17d1eec0d2c4691f7a9d9e52f55ef752529d356ea9",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_0_1-lod.rad",
            "bytes": 2320,
            "sha256": "611cc5b47b6c429b012c76580b75c896bec1c8a6fac96646dfe8fdc825f0852e",
            "splats": 605238,
            "chunks": [
              {
                "file": "lod/0_7_0_0_0_1-lod-0.radc",
                "bytes": 3010976,
                "sha256": "fd11c3e2d41f744444ae9a8197c25386562d0efc28766961d436007053320a61"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-1.radc",
                "bytes": 2993376,
                "sha256": "0f726c03b8231b3662c28adbed2d7a909804b57dbf2d433ae3e847f68b9f8388"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-2.radc",
                "bytes": 2997600,
                "sha256": "938893bd5bb29bb872bb8b27901f122c5f8af93d3aa0548657f2e0fefcfa4165"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-3.radc",
                "bytes": 3055712,
                "sha256": "a14dd55fc2cc2a80d8b30edb0ffb4dbcacb613ec70feab10559f3f31501c299c"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-4.radc",
                "bytes": 2964416,
                "sha256": "9cb79bbf623719d42c1608faafd8412698f6d3a84edfde275a99fd0b7d6d363e"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-5.radc",
                "bytes": 2998696,
                "sha256": "3b77a801155eb7f510015f5d4d3e0dd5ea098a3eca24c97f9caf66596c661a3c"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-6.radc",
                "bytes": 3200568,
                "sha256": "79b42c541daaa4b2e6874f419ba7086688c2725fb9f6d5e4b581f1833a47890f"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-7.radc",
                "bytes": 3176216,
                "sha256": "116da348b63dfcc0b04f42db2dd5d19131b3a57915c834da2a03db56481c2bbb"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-8.radc",
                "bytes": 3056648,
                "sha256": "8e8a2b85e7e93b3e028b0d80d295801e83db3fc20b7fc6a92285038b05ce365d"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-9.radc",
                "bytes": 727904,
                "sha256": "5e04dba05a0794aa8585e2617559784af69557486bf7de230df6a5288f8a0668"
              }
            ]
          }
        },
        {
          "file": "env.sog",
          "bytes": 414176,
          "sha256": "b74e7cd9899bbea8aad30b16c6512b43326c53a46c36ffd6cbd272eb48f914bd",
          "lodLevel": null,
          "isEnvironment": true,
          "lod": {
            "file": "lod/env-lod.rad",
            "bytes": 1416,
            "sha256": "af388c4f0da8e65af484f0a1984c8ebcb9c655060c5e2eec476b26061203a975",
            "splats": 16706,
            "chunks": [
              {
                "file": "lod/env-lod-0.radc",
                "bytes": 858256,
                "sha256": "6418df70028c486b87086c2772622f0e7ab8091716983b59fa933c6c734604be"
              }
            ]
          }
        }
      ],
      "totalBytes": 209794464,
      "transform": {
        "position": [
          4.911651,
          2.7753407083333332,
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
        7.43706525,
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
      "alignmentConfidence": "confident",
      "alignmentNote": "Derived from scans_BIG_MODEL_TH_GH_2: floor from the room mesh, room from the scanner's own walk. Derived 11.3x21.1x7.4 m agrees with published 21.0x10.0x7.0 m (worst axis 13%)."
    },
    {
      "roomSlug": "reception-room",
      "captureDir": "scan_output_1_reception",
      "splatType": ".sog",
      "totalSplats": 3933570,
      "totalLevels": 4,
      "splatsByLevel": [
        260867,
        522118,
        1045287,
        2105298
      ],
      "finestLevel": 4,
      "finestLevelSplats": 2105298,
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
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_2_0_0_0-lod.rad",
            "bytes": 2600,
            "sha256": "e12406a96d600b92c30778c34066b99d0bbce56a952b7eea1d6850f8577cf4e0",
            "splats": 845032,
            "chunks": [
              {
                "file": "lod/0_2_0_0_0-lod-0.radc",
                "bytes": 2943624,
                "sha256": "b42d638f6fc43d2f992093ba9d22bf756a64264e88245714d88f144249890039"
              },
              {
                "file": "lod/0_2_0_0_0-lod-1.radc",
                "bytes": 2835296,
                "sha256": "4370f2a572c3ca49c09003593d8659fa80f3294d7846051f4131cfe1576d8432"
              },
              {
                "file": "lod/0_2_0_0_0-lod-2.radc",
                "bytes": 2880072,
                "sha256": "224766692afa6c4092a128d7fa06fb29bd163a81212a2aa85cd7d87ea2276bbc"
              },
              {
                "file": "lod/0_2_0_0_0-lod-3.radc",
                "bytes": 2874840,
                "sha256": "0445b586a5dfa64f7a0be4170fa9145f021469e55422451e0c9ad7c145af07fc"
              },
              {
                "file": "lod/0_2_0_0_0-lod-4.radc",
                "bytes": 2816352,
                "sha256": "6cbf3af2ac348d06474fdaf38b893eaec446c5bc8b8cf0d3c7938564cf3d8d2e"
              },
              {
                "file": "lod/0_2_0_0_0-lod-5.radc",
                "bytes": 2867040,
                "sha256": "2431cdaa8948b74828ec71118f1910d50cbf2886eb7f9995a1b5fe049935e3b1"
              },
              {
                "file": "lod/0_2_0_0_0-lod-6.radc",
                "bytes": 2738528,
                "sha256": "f8899ed7429934a1d0ead1a763aeced3e5c3dfad36123bb099425bd208a98ca9"
              },
              {
                "file": "lod/0_2_0_0_0-lod-7.radc",
                "bytes": 2829600,
                "sha256": "e6bf6efd72bdbefea807e9776e2650db1b0507dd8e205fe051e662c7a2633c60"
              },
              {
                "file": "lod/0_2_0_0_0-lod-8.radc",
                "bytes": 2955696,
                "sha256": "a91bc3f080078e7b7c66ab703594671b19cb8399f11ebebaf3a51f2399778e61"
              },
              {
                "file": "lod/0_2_0_0_0-lod-9.radc",
                "bytes": 2843728,
                "sha256": "1f03df0502ddda92157754c8e40d1121156bb5ffa57c4bdd0fd13cf3388fdbe2"
              },
              {
                "file": "lod/0_2_0_0_0-lod-10.radc",
                "bytes": 2815832,
                "sha256": "68f9092f0521977da7dd191bcee23d9d8eb4c0b0729809ec10e3d8073f851825"
              },
              {
                "file": "lod/0_2_0_0_0-lod-11.radc",
                "bytes": 2861752,
                "sha256": "37a286ad5e2f88bf01fdd668610bcd608724f56079ed8274dbd467d80567fb3b"
              },
              {
                "file": "lod/0_2_0_0_0-lod-12.radc",
                "bytes": 2816168,
                "sha256": "4bfbb7a8eec87e6f0289a1677d90f2d44b63dac22aae0923bd4bd5fd6d312182"
              }
            ]
          }
        },
        {
          "file": "0_4_0_0_0.sog",
          "bytes": 10448767,
          "sha256": "eac35b74ada19273277314814e69203b5d86e08012f7012802b9e392fd7115eb",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_4_0_0_0-lod.rad",
            "bytes": 2592,
            "sha256": "f3acc4885bae008de40cde356789561baf929b6637255d13e95a5b8caf7daea2",
            "splats": 825475,
            "chunks": [
              {
                "file": "lod/0_4_0_0_0-lod-0.radc",
                "bytes": 3099032,
                "sha256": "1ced626c9e214f407f1bed2dcebef62d34ac998e4d0944d905577b71c5c3edf4"
              },
              {
                "file": "lod/0_4_0_0_0-lod-1.radc",
                "bytes": 3053944,
                "sha256": "0205f689811ad257223762040b57f084e9a534386795864b6a9ccb3edde05695"
              },
              {
                "file": "lod/0_4_0_0_0-lod-2.radc",
                "bytes": 3353872,
                "sha256": "31aeafbfefce658e93a1d902135b66771264b1aa9f607984f4c1ebb2ee9343e5"
              },
              {
                "file": "lod/0_4_0_0_0-lod-3.radc",
                "bytes": 2989032,
                "sha256": "8573f2e70debeb13e19c6f7f865fb08bad5ac1c26e438adede7839b688b44ef9"
              },
              {
                "file": "lod/0_4_0_0_0-lod-4.radc",
                "bytes": 2975560,
                "sha256": "120b992a6a51d92b8ddf2a281d6caf7d51e6cfb60fdaa4f902788ced5d5f1cc8"
              },
              {
                "file": "lod/0_4_0_0_0-lod-5.radc",
                "bytes": 3038320,
                "sha256": "873f3304a9fd70e04bbe66defa70d4b8943bb680e28124b76ec5594e7eb25baf"
              },
              {
                "file": "lod/0_4_0_0_0-lod-6.radc",
                "bytes": 3202512,
                "sha256": "81037a9edbea72dea505ef70042b1d1484bdc1069b06342209b74b79fcad13de"
              },
              {
                "file": "lod/0_4_0_0_0-lod-7.radc",
                "bytes": 3128304,
                "sha256": "ca98d29a0ee33fea3b41537979e129c154d43cc05397e9f6496e0c37eefc15da"
              },
              {
                "file": "lod/0_4_0_0_0-lod-8.radc",
                "bytes": 3104832,
                "sha256": "2279f20e68b37ed91e6c07ed3b51e0a64e58c405012a8fab395710324e2150e2"
              },
              {
                "file": "lod/0_4_0_0_0-lod-9.radc",
                "bytes": 3127448,
                "sha256": "d7e084fa053fe75bf79d645c70b96d5067b81840d702e0cce12dfbc582abd27b"
              },
              {
                "file": "lod/0_4_0_0_0-lod-10.radc",
                "bytes": 3348448,
                "sha256": "49bf1fc2acb8502fbced0e57c7305060384c52459033eacd7f55a07a2c83bcea"
              },
              {
                "file": "lod/0_4_0_0_0-lod-11.radc",
                "bytes": 3076664,
                "sha256": "7b1481eaa48baf54bac5c81ac599fa3a7e2c4b490192cdc34b07dbcc18c10e17"
              },
              {
                "file": "lod/0_4_0_0_0-lod-12.radc",
                "bytes": 1978112,
                "sha256": "f41c6241873325b4ae6584753440058f1724af5dd9fe61c2a8541b255012d763"
              }
            ]
          }
        },
        {
          "file": "0_6_0_0_0.sog",
          "bytes": 9178356,
          "sha256": "e7d48befba9701cd138e29a27f41a03924889ee3378481ac5cd91a34304435cd",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_6_0_0_0-lod.rad",
            "bytes": 2392,
            "sha256": "2865e4d437a14d64a5a0883dcbcb730a52365d13f168bdd88cff064886ddf831",
            "splats": 696373,
            "chunks": [
              {
                "file": "lod/0_6_0_0_0-lod-0.radc",
                "bytes": 3165384,
                "sha256": "f8ed441e7b5403f9bbf2eae964e38711fdc3dc22068c710859ad12e3ec5ba5de"
              },
              {
                "file": "lod/0_6_0_0_0-lod-1.radc",
                "bytes": 3050672,
                "sha256": "62eeabcebc29eab1b4e2563150ea44ac93c9443dd3b448a966e99a7ad88aeaf9"
              },
              {
                "file": "lod/0_6_0_0_0-lod-2.radc",
                "bytes": 2983336,
                "sha256": "edd51db7dbff789317377ed1880fc7bb25076e583608fd248927c71830ac8e46"
              },
              {
                "file": "lod/0_6_0_0_0-lod-3.radc",
                "bytes": 2997096,
                "sha256": "121135deae19824ae60cf8e332dee3b8f6ebab0c81db489267613788fd7b99f0"
              },
              {
                "file": "lod/0_6_0_0_0-lod-4.radc",
                "bytes": 3044336,
                "sha256": "446d0892b80016cd93824b25c8d05d551eb4767e419f6ee71fe0cd28ba1293c9"
              },
              {
                "file": "lod/0_6_0_0_0-lod-5.radc",
                "bytes": 3070976,
                "sha256": "c6acc8cf898bfce0e1b3bb276f836883632868ee6faaca9738e64d5acb8db252"
              },
              {
                "file": "lod/0_6_0_0_0-lod-6.radc",
                "bytes": 2975328,
                "sha256": "18469ffc6edfa792806a7d9fd007e8b8e8a6fe082f70e5f0dff38e4dc368f35d"
              },
              {
                "file": "lod/0_6_0_0_0-lod-7.radc",
                "bytes": 3102672,
                "sha256": "71b11033564d178a7abffeb75a4cd716f94964be4e0a505f22c9efcdfa1fc2cf"
              },
              {
                "file": "lod/0_6_0_0_0-lod-8.radc",
                "bytes": 3082272,
                "sha256": "8c7fdf1ca8e2dd393020a8465cb67ec4d612bef2f6ea3c13e39c1ad825ef437b"
              },
              {
                "file": "lod/0_6_0_0_0-lod-9.radc",
                "bytes": 3130304,
                "sha256": "540d1deaeaf155d43de6c45d99e43bede552000db64c20a997f9459bac18c707"
              },
              {
                "file": "lod/0_6_0_0_0-lod-10.radc",
                "bytes": 1971216,
                "sha256": "1c0d3221fdb0584bd8ce033fadb79a4fb91501c0c2e5285e5099cd56a627f7ec"
              }
            ]
          }
        },
        {
          "file": "0_6_0_0_1.sog",
          "bytes": 7607425,
          "sha256": "8a4f33e5ce1abe91f19452abe685d53ed2bccbecd24da37cf8099c9988f335e9",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_6_0_0_1-lod.rad",
            "bytes": 2200,
            "sha256": "28e7779ff7b24944d84da2e7d0220c63435f841d85b5b8a833aed9069f6ef489",
            "splats": 548047,
            "chunks": [
              {
                "file": "lod/0_6_0_0_1-lod-0.radc",
                "bytes": 3223384,
                "sha256": "9f8a03e4565c6f46e1651bf33f9573a7e58ede984d45eb7dd87f06812250b7a7"
              },
              {
                "file": "lod/0_6_0_0_1-lod-1.radc",
                "bytes": 3095128,
                "sha256": "75aa69082addaf9580366490d8a342cea35afc9683427350a494725fb6a86855"
              },
              {
                "file": "lod/0_6_0_0_1-lod-2.radc",
                "bytes": 3174160,
                "sha256": "bc069f554e11d451d217765aec74fcc8337b8515b991887fbefe788e87571ee3"
              },
              {
                "file": "lod/0_6_0_0_1-lod-3.radc",
                "bytes": 2960680,
                "sha256": "5030c3a9d3dafa3334d8980a3fb711e688e05d5cc47e0de2a7e297a099da158c"
              },
              {
                "file": "lod/0_6_0_0_1-lod-4.radc",
                "bytes": 3009160,
                "sha256": "10b0a7ec68cb2856a41453ac369cdaa8923ab4e359ac417225cc5b050e59f2ed"
              },
              {
                "file": "lod/0_6_0_0_1-lod-5.radc",
                "bytes": 3029312,
                "sha256": "ec3c4413293182bbd2b4a82badf6baaad3cadcf43ae90617bf3a971d4612fcb3"
              },
              {
                "file": "lod/0_6_0_0_1-lod-6.radc",
                "bytes": 3109192,
                "sha256": "206d841ef96f1669bf79d370665f2d457c087ed390bfce6c59fe87d73688958b"
              },
              {
                "file": "lod/0_6_0_0_1-lod-7.radc",
                "bytes": 3065376,
                "sha256": "0336dfe21b5a298c0fdc88059d37b951379c1340f09e8145eb46e4746b051357"
              },
              {
                "file": "lod/0_6_0_0_1-lod-8.radc",
                "bytes": 970752,
                "sha256": "409b697f316f9a080ee3a6ba2e697b7345f2c0036bf64f3003a21aed923629a6"
              }
            ]
          }
        },
        {
          "file": "env.sog",
          "bytes": 129572,
          "sha256": "6aeaea70ff916ddf993621be6bff01e1d688047db214fe323d2c1bc2306726a1",
          "lodLevel": null,
          "isEnvironment": true,
          "lod": {
            "file": "lod/env-lod.rad",
            "bytes": 1408,
            "sha256": "14243c0e81b676ea860e432d8f60d12f0afc8ff5d67f537339387d6a4949d921",
            "splats": 5348,
            "chunks": [
              {
                "file": "lod/env-lod-0.radc",
                "bytes": 270016,
                "sha256": "51da331f1fcc570f8cec8d8fc4e6763a5b254a054b072f3fdba5e679e1041d9d"
              }
            ]
          }
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
      "splatsByLevel": [
        382151,
        766734,
        1540768,
        3089404,
        6199024
      ],
      "finestLevel": 5,
      "finestLevelSplats": 6199024,
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
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_1_0_0_0_0-lod.rad",
            "bytes": 2720,
            "sha256": "0c2842a8f2bf4e43471440e0d897a1ce5f33faed59880c4610a345848ced5f3d",
            "splats": 901151,
            "chunks": [
              {
                "file": "lod/0_1_0_0_0_0-lod-0.radc",
                "bytes": 3174272,
                "sha256": "d169fdfa9474304e42dd5b158118cd30a2f88ea0145e5bf5efd99829667d88d2"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-1.radc",
                "bytes": 3209144,
                "sha256": "df5e194746db7edf873793836f59d93becc0ebd691475bf7265ed9b063c09c6c"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-2.radc",
                "bytes": 3075584,
                "sha256": "b986fdebaa311d850bf17af5056b265c3afca046a0168de157b75be6695e0b7a"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-3.radc",
                "bytes": 3248328,
                "sha256": "f068ec1df557217211f4e3f62b0e6c0eee00e3d056e96129bde47a80e068a1b7"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-4.radc",
                "bytes": 3212488,
                "sha256": "4b2464232c6b6c378f52c6fd33bd3d6448b14405189b6f90c79a75ee6c1f2775"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-5.radc",
                "bytes": 3348736,
                "sha256": "c1e3ebfc68882ee2946cdcf8bf336cd5b4c52e927852a919239cf60b69fc7491"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-6.radc",
                "bytes": 3243440,
                "sha256": "2708638ef73500fe36cb19b4764445364f69aec4098bdd8eb42394d3cb24c8bf"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-7.radc",
                "bytes": 3348248,
                "sha256": "39a68b1b800c476e8d214317e61d5bd5ea8c12992f05c6173294ce001515f6cf"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-8.radc",
                "bytes": 3373872,
                "sha256": "90a726c7471ea05bb4cb556d88640867531f89a696e2c0049266daa9d540a751"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-9.radc",
                "bytes": 3245016,
                "sha256": "b8037d1bfc2dae15c5cd67348cfbc77b434b12cc5fd53ca4fa04d7b0e6fd7d17"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-10.radc",
                "bytes": 3401032,
                "sha256": "71f303131a9753e8521522b596f4b8946058e211e1b0908bb9d9cf1ea37cd09d"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-11.radc",
                "bytes": 3448160,
                "sha256": "48fae8e522b88cb2891e7b9ff452d4cbfadb572c3e8720a41d75340b8a60a7e0"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-12.radc",
                "bytes": 3468944,
                "sha256": "20738354ef15126863dae9c6e60e4ef7eb1e2362d7659144c805d58b70f99212"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-13.radc",
                "bytes": 2588312,
                "sha256": "5c446199ae2ada57204fd0feb2708c77e6e8f8b2e13ceb7b0fe3a6809168b4f4"
              }
            ]
          }
        },
        {
          "file": "0_1_1_0_1_0.sog",
          "bytes": 10337570,
          "sha256": "655a43a7a5f42d502f4521fec436ad1e126fa5a0b5df2af504315ba81657b8ca",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_1_1_0_1_0-lod.rad",
            "bytes": 2616,
            "sha256": "e3049cf8bca6a10ae5845d77ecd96390da52093f1d6fe41df6693b2195c8f068",
            "splats": 807473,
            "chunks": [
              {
                "file": "lod/0_1_1_0_1_0-lod-0.radc",
                "bytes": 3132024,
                "sha256": "6ff856101f7175866006628887672d11d043f4557999bff072e90d31ed698347"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-1.radc",
                "bytes": 3345960,
                "sha256": "bde234ed6632adce18d94b629e8a86bf1a8015b46a35af5b0c5ecdff56e90111"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-2.radc",
                "bytes": 3375976,
                "sha256": "69e0b4b3e7022326754d9de7f90359bd4f787ae821fab7c99d4e8713699a2743"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-3.radc",
                "bytes": 3115624,
                "sha256": "ba91260dcb437a98dfeae40a48fe6341a65cd7385e351f03acbe3630023b5207"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-4.radc",
                "bytes": 3264448,
                "sha256": "e6a7163548f28ffbbe4e07268d00aff170c43ab7d7c9cf278c6f89c2ed9ff77f"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-5.radc",
                "bytes": 3080384,
                "sha256": "31ad9e91c6dfd1980780aa48ca27cf80ec75f194fe3d7dfc262605f58b85a0b2"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-6.radc",
                "bytes": 3420928,
                "sha256": "7caf465b0ff3ffc5f17968eda290018cec6af5fbbb549f414be3918a4c18d934"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-7.radc",
                "bytes": 3466000,
                "sha256": "ed144436287395d890f59b73f6caec6d7aee7fda819997b76edd2368ab5ef98d"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-8.radc",
                "bytes": 3457008,
                "sha256": "5f1a5c130d23e1893476f5625f17c109d23cb021b68255799823d3776926dbab"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-9.radc",
                "bytes": 3390960,
                "sha256": "f1eee03293923a5d32cc4143b925de21a27e9427797fe8ef2442372cdbebf4b2"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-10.radc",
                "bytes": 3328664,
                "sha256": "c404374e9830e1f3b734dffe66c16f05d3da6ec137c596fe20501a89d3c328ea"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-11.radc",
                "bytes": 3365912,
                "sha256": "29b225af5564cac9bf29a5ec59d0bffcd60c147ce541eb48cb6cd45a8d6efd47"
              },
              {
                "file": "lod/0_1_1_0_1_0-lod-12.radc",
                "bytes": 1009096,
                "sha256": "b4132c9a2244ff24d1b68c173619c0a32ceeeac0ad9bd9da634e3ecbd468cf59"
              }
            ]
          }
        },
        {
          "file": "0_2_0_0_1_0.sog",
          "bytes": 9267834,
          "sha256": "7492919e0f78d509939b30202951154770aeff4ef2a1c3d3233ebee46d0b7d3f",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_2_0_0_1_0-lod.rad",
            "bytes": 2416,
            "sha256": "9c66ec8506d8d903ccecb05c8b8a26a4659731f4250a7002aeff685090f8d82d",
            "splats": 708693,
            "chunks": [
              {
                "file": "lod/0_2_0_0_1_0-lod-0.radc",
                "bytes": 3233864,
                "sha256": "50bab477e2b1f190b373fda57d3061da8e40a1ed49a4d84f1765609b2f311fbf"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-1.radc",
                "bytes": 3187104,
                "sha256": "59b14eeadca6a4efe36f46232758a47b3563197614264e79f5fd2606c588cad7"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-2.radc",
                "bytes": 3460672,
                "sha256": "74d97b51ff66cab6c7a33bcd70d7692440e9f79217f8842ab09c7f840a6483d5"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-3.radc",
                "bytes": 3414632,
                "sha256": "a6284cfc951ae427f8f3d16d17152c3b3f1361fe3d04bb105eca296853f7c05c"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-4.radc",
                "bytes": 3184936,
                "sha256": "22fe14b4c00de463a17e777c8ea35e035e14ea5d876e1f0ffd872b68c043c546"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-5.radc",
                "bytes": 3226864,
                "sha256": "913191dc0739fe52e3c2761011ce1485ede797090adbd00592e38da32ced2676"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-6.radc",
                "bytes": 3166928,
                "sha256": "9c0c431b2f0b32b14ecb35704ffd9efa8015bbaa8bd1ba8e5f050891f43079a7"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-7.radc",
                "bytes": 3444624,
                "sha256": "fae07108b4e77e7f5b205594fb233e42d578a1fda19d707e454e300515e19ab5"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-8.radc",
                "bytes": 3178256,
                "sha256": "2e34dd55aac86e17be2be5f6b55633a773bb4916258939533a75507ea9676a73"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-9.radc",
                "bytes": 3268376,
                "sha256": "5ba9c0b2d7f4d8117727c51a0a36c438eaf7193737398230ac88131355125395"
              },
              {
                "file": "lod/0_2_0_0_1_0-lod-10.radc",
                "bytes": 2498584,
                "sha256": "8a97bd5da2ac7583f6c2330530e8dfb71f4f08ee6fc0d2f40752f78089e6b97d"
              }
            ]
          }
        },
        {
          "file": "0_2_0_1_1_1.sog",
          "bytes": 9883813,
          "sha256": "097d92478b9472121791aee2641672f00143f63b92372cbe065cab9e2c47cfd0",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_2_0_1_1_1-lod.rad",
            "bytes": 2528,
            "sha256": "7ef036b8b59170d6ecd3b17e7a4b2eac1046b0f9241eb79101b034216acc87b8",
            "splats": 764809,
            "chunks": [
              {
                "file": "lod/0_2_0_1_1_1-lod-0.radc",
                "bytes": 3208464,
                "sha256": "b3815840a8f4eac2f0462811c6445dcd5b860e1421ffe81f4205a30dfeb03ae6"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-1.radc",
                "bytes": 3403496,
                "sha256": "daccfc62278ebefb05a4d49d88dcfe6d9d85d7380a2f475a60552774fb7524ea"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-2.radc",
                "bytes": 3322392,
                "sha256": "24bdb760991940008fdbeda919f89547cb98672814689484d0ca8f88ec84c0ea"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-3.radc",
                "bytes": 3208864,
                "sha256": "cb8b063fa2ec90eae4b6195b75f5667a2857882dbcec38f5d912eac9c0aa8471"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-4.radc",
                "bytes": 3298128,
                "sha256": "d4fbf224c0c3b55a811c4a9191d40e122e1a1a915ec16eb9cf253df42e8a4426"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-5.radc",
                "bytes": 3476816,
                "sha256": "3931bed1a6af567a1028622d18c2d6e3cc9e6b85730977f6959febd17c790067"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-6.radc",
                "bytes": 3329976,
                "sha256": "da5271d7229c56647199e6d9facb3275d2cea305cc188c3b16ce26567c59e30a"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-7.radc",
                "bytes": 3297512,
                "sha256": "85a65bc204050e7b2b58d5fc915da80887d3133a44b76e7751958a639297a6a3"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-8.radc",
                "bytes": 3354832,
                "sha256": "70de57c1f32c554d805280afbce89de181393d2e57c5647429312ddcf77d0ef4"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-9.radc",
                "bytes": 3422944,
                "sha256": "074a27c136d3e7fcbfb57da849d3e26badeb381955ad702b23873061b3cfb608"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-10.radc",
                "bytes": 3212680,
                "sha256": "8411a4d4bfdba369245ad3fff3d97099f21f4f11cb166d96dcc9a450e24796e9"
              },
              {
                "file": "lod/0_2_0_1_1_1-lod-11.radc",
                "bytes": 2217456,
                "sha256": "3fb8ee088dff8d808d52168292ca96280677ee382959af059510292c609e15cc"
              }
            ]
          }
        },
        {
          "file": "0_3_0_1_0_0.sog",
          "bytes": 9382663,
          "sha256": "994fcc7dc1e4c612105025e3f3e45ba1188b6681d09aa51bdd89d661f161dfab",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_3_0_1_0_0-lod.rad",
            "bytes": 2416,
            "sha256": "36a8ae2a42b0f411ccd516555a94bf43df827d9447bcf386cdc0b3606e62018d",
            "splats": 716723,
            "chunks": [
              {
                "file": "lod/0_3_0_1_0_0-lod-0.radc",
                "bytes": 3233960,
                "sha256": "e201b3fe682cc153ed87c3562e012a35bfb8331d71328bf14ee8264435afbed8"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-1.radc",
                "bytes": 3212448,
                "sha256": "7cb19e124ce16bcdb61e917e85922e5ed36be7a0ae34c273d0ddd85b6acff040"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-2.radc",
                "bytes": 3338200,
                "sha256": "5d778a634fbfdd99f760724234c300e0cbc48436c0bf2b370f8385756cb1283e"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-3.radc",
                "bytes": 3471416,
                "sha256": "c432a3ed8cdd60e3fa675f0ec9467b6c419e33068db2867e6c7f20985d2f2c0e"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-4.radc",
                "bytes": 3491616,
                "sha256": "9dc7bf54835a43293a32230d0addaead51a5a992c3d67fa3595b4315b70c4cdc"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-5.radc",
                "bytes": 3342448,
                "sha256": "40b42a389f5244e017e723dfef2ab7f3aebde3054a9ad63bc917035c0ca075ae"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-6.radc",
                "bytes": 3441488,
                "sha256": "220ebc87e07c8c42968803638505acbd0fff02a5ff6e2af839db2ce321a33cad"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-7.radc",
                "bytes": 3369232,
                "sha256": "7b49c9614ea3ff855f84457de2d6bf82fd8c4b401cc4f35aa4cd5b75f76f15cc"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-8.radc",
                "bytes": 3379488,
                "sha256": "3f6220e4a443a3d5e7676e9bdd6d154205a87bc6d20ea85fa650dd71526402a1"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-9.radc",
                "bytes": 3294864,
                "sha256": "d64e926ffbfdb84801a52f83ec7eaba2265e94eefefff588de82689bb216c003"
              },
              {
                "file": "lod/0_3_0_1_0_0-lod-10.radc",
                "bytes": 3064792,
                "sha256": "67112c13d401015a01f4c8d3f546be6739cd7da26ce5d0c6354155476f35b0e8"
              }
            ]
          }
        },
        {
          "file": "0_4_0_0_0_1.sog",
          "bytes": 9873679,
          "sha256": "b7fbbdf42b5633b45ddea14adb82231184615f0ccbdd78da73bedf6c5d2d5d51",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_4_0_0_0_1-lod.rad",
            "bytes": 2520,
            "sha256": "29dd1cae3104815e33b3e046596816ab8d71370a3aaeff29d60ec6792c2f57fb",
            "splats": 760399,
            "chunks": [
              {
                "file": "lod/0_4_0_0_0_1-lod-0.radc",
                "bytes": 3198112,
                "sha256": "2dd6d9277cdfcfc277667441a90ce561af533252ffe4ab6eb7b5bbc36aeb386c"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-1.radc",
                "bytes": 3153928,
                "sha256": "ce1dbc6fdbf3cde6fdb785ba6de84bb1a9579aeb2ef8a6f90f6ef9f1e0188a87"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-2.radc",
                "bytes": 3204144,
                "sha256": "f76335618fce657fad59df794cf28497b72a4b25aecbef8699910d53ed28e5af"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-3.radc",
                "bytes": 3412920,
                "sha256": "f7db49082237c79810b9070127d5a1d0c9fc68cc88eeec05457642ca26e98701"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-4.radc",
                "bytes": 3357144,
                "sha256": "9fac4a207637b73e88ea0dcb0b4736cd57aef7b23dcacfeed523ee57a670327c"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-5.radc",
                "bytes": 3323544,
                "sha256": "06cdc582954a425e9e991658e921176a8ce487b85b18f9cd802520f086c2af9e"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-6.radc",
                "bytes": 3220624,
                "sha256": "31327ada2811400098a0559ea3abfc8b8cbe3779aed45890056bfa9209adc822"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-7.radc",
                "bytes": 3390112,
                "sha256": "256c980b0ad1c15b826a7a8738d685a378bf92530e0e4724a47adad759118ee2"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-8.radc",
                "bytes": 3288592,
                "sha256": "5b205d266be5d6d3d011d0cfcd37c7f54e35e3cfb7446df10ece5acb254732e8"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-9.radc",
                "bytes": 3275656,
                "sha256": "609d5e3dd9f28fccb0b070e00454fb4eb5ae8de450f68e02c52bc5a03a51d9ef"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-10.radc",
                "bytes": 3352664,
                "sha256": "d9b061a6d96a6409f8a8485fc1294379a7b41829ad324ef095dd4e4bb86111a8"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-11.radc",
                "bytes": 2053912,
                "sha256": "67540d87ea0c5d9803d99d1a8911aac6087dd3ae32e6c274d7b9ba48237db760"
              }
            ]
          }
        },
        {
          "file": "0_5_0_0_0_0.sog",
          "bytes": 11026272,
          "sha256": "b9584c73057b5ba1e885296614243f1cd34bc11e260de7a989d1b0037f124d52",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_0_0_0-lod.rad",
            "bytes": 2720,
            "sha256": "60f8439305195ab6794ad96a7ca3d90c1ce2a6d5ca80e6c0f02094577d0596df",
            "splats": 866130,
            "chunks": [
              {
                "file": "lod/0_5_0_0_0_0-lod-0.radc",
                "bytes": 3140912,
                "sha256": "34227defb91da4d00c032dab491ddc1cbb2a82b1efa5e2cac505e6bc20d258ec"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-1.radc",
                "bytes": 3355280,
                "sha256": "890db3fecefa8b4968dc6423a9ef4c0a5801f63457df4d4d1fe4c5e3ac36847e"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-2.radc",
                "bytes": 3375752,
                "sha256": "e703a361453002de75e881377e34147c5ff1ff487477774fde813a17a3e14cb0"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-3.radc",
                "bytes": 3127584,
                "sha256": "3a45f9d6300f98cb0898e5b23a242c022309f1c4de141aa768192670924b64b2"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-4.radc",
                "bytes": 3040640,
                "sha256": "e97a005facca34c6441c3a6a137ac752400ca91819da14cc299c4d83901ad1f2"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-5.radc",
                "bytes": 3171512,
                "sha256": "ad5922b90058212447fecb74b5b1e7d46d7293cdb54851c07ef8e677bbfcf646"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-6.radc",
                "bytes": 3208984,
                "sha256": "d9014fc745fb835520ddd3be3c66e36fed6eab42d8eecf18f4b59663a572dd00"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-7.radc",
                "bytes": 3347368,
                "sha256": "f36f0175e55f275781737458be0efa6bcdc843abce3250e6e212245cbc16d164"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-8.radc",
                "bytes": 3304216,
                "sha256": "051547d5ea034e87379432b0614eea0e25c59bc48d1a6c6a00004d4ad06fb735"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-9.radc",
                "bytes": 3284208,
                "sha256": "b144d8648ec21e312756aa0ae23300714f14b00b3c291472450823760b52107c"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-10.radc",
                "bytes": 3335272,
                "sha256": "457264227e25519a55384eaa7d1a31ada2fc7f1ffbef6b9418cef0719be098bd"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-11.radc",
                "bytes": 3221672,
                "sha256": "8b5f59b57941311695a939a893200522a7598b4b93cecc22b833ea0d2f5ec8ee"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-12.radc",
                "bytes": 3415224,
                "sha256": "d793a2c96ee07ccd8c6fe9de28480c74bc2bfe1ad3fafaa81dd58cad57d5e954"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-13.radc",
                "bytes": 650936,
                "sha256": "762b18c1bda245be33c9bd2d0663baf3fc5fe1370fd12154b34dbf05ec8fafdb"
              }
            ]
          }
        },
        {
          "file": "0_5_0_1_0_1.sog",
          "bytes": 9371971,
          "sha256": "29785ef8b51965475df5523fa24d866b3767f7bb599f5f055e9d68d57876d1ab",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_1_0_1-lod.rad",
            "bytes": 2416,
            "sha256": "e1eeab16997d5d324f7f547871b45bb71d88552f8f93443acb1d99d6a563fa71",
            "splats": 696887,
            "chunks": [
              {
                "file": "lod/0_5_0_1_0_1-lod-0.radc",
                "bytes": 3239384,
                "sha256": "625b74d431b06ee4dc2aeccdea9de6932ec56e456941d8fe63c8a68f4d700c1b"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-1.radc",
                "bytes": 3264616,
                "sha256": "87f3626aa2dc9c1fb7721b432199a9cd8b8f80ea39fcebc2d58e3a0b59a9a957"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-2.radc",
                "bytes": 3328752,
                "sha256": "7b2b36ab415693c2ceb16ce278aaaa32a95edcc190c6caf9ee934ed41826e2e4"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-3.radc",
                "bytes": 3375880,
                "sha256": "e1491fb5297df3eeed5782f14e49aaad394fd29edae3e3fc327f5a6ed1972de0"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-4.radc",
                "bytes": 3280640,
                "sha256": "c7870d377080c0c51cd25fdaafa7217d6b61e23970cb93c47b55ef466ef1d971"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-5.radc",
                "bytes": 3287936,
                "sha256": "785a44c2ba9035901d7f733cd5b5648a2390f4070ec62188e7d5cd49162f9a4f"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-6.radc",
                "bytes": 3290872,
                "sha256": "3706a8a1ced774249e874c566115b3b9f03d6d23a1fc0e84bd3ac00bc9c973a7"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-7.radc",
                "bytes": 3329256,
                "sha256": "b9538c6ee3585529b364d41f4eabd4cb17dc253ff9ea93d6d4e57b2120e9a474"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-8.radc",
                "bytes": 3301856,
                "sha256": "abf78b49e64a13888452ab37771a03a434d38e1473ceed0077e82bfab7acc088"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-9.radc",
                "bytes": 3220328,
                "sha256": "eb0519072f512cf98b1b66da17a61e0de73ce2e092797a0c67cd9e8a44b18353"
              },
              {
                "file": "lod/0_5_0_1_0_1-lod-10.radc",
                "bytes": 2093056,
                "sha256": "b84029e92ae58765bda130812faa87ba77fd2a75ab6e1413386d6fee1589909b"
              }
            ]
          }
        },
        {
          "file": "0_6_0_0_0_1.sog",
          "bytes": 10720068,
          "sha256": "59c8ff57dc69b66fd3ea5b87319e32f00491cedec4dc6d2adc1e3306d17c98b8",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_6_0_0_0_1-lod.rad",
            "bytes": 2616,
            "sha256": "4febfe581183abae37a349bf67f4e9ee20726b32075dfa26dffb7f14fee8f7dd",
            "splats": 849685,
            "chunks": [
              {
                "file": "lod/0_6_0_0_0_1-lod-0.radc",
                "bytes": 3121864,
                "sha256": "c331f8bf260d31dc0c914bb54ce94cdd266c65a1de9e482760bf95ebe7942a45"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-1.radc",
                "bytes": 3122376,
                "sha256": "c5887b00d8716a09873c7fe6278fe582726b2f8aa657b7da180155ed7d7f48e0"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-2.radc",
                "bytes": 3272456,
                "sha256": "5d283af8f3791845f42a7aad289948b7432df1e01598e26fa80ad85bd660bb4b"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-3.radc",
                "bytes": 3433672,
                "sha256": "b3b379af9b8903afa678f802fc0579ca0f30f047a91080f0b2cdcb894263533e"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-4.radc",
                "bytes": 3170904,
                "sha256": "d6914495967898a21f77dee7423192af42647199d00383bc3ed21d57e4b60fc7"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-5.radc",
                "bytes": 3073256,
                "sha256": "4acbc9251b5ed32c19cafda88e6af097d10ad58ae3440bc252b5105b14352790"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-6.radc",
                "bytes": 3371368,
                "sha256": "72454e79b63a6e504418f51cea7f7be6be0b67af959d94eeaa9bff55f45a424a"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-7.radc",
                "bytes": 3506264,
                "sha256": "63db914973670b5681060384e3ae64a582eb36321217bb23b61fe0a2eeedc79f"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-8.radc",
                "bytes": 3482080,
                "sha256": "3831f791230265271c9040fe9fad509b49bc2a66296dd9682ca47951fdd916df"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-9.radc",
                "bytes": 3335848,
                "sha256": "779a0bf126e12b2cc8e9553a219a97a06c5609e9bd953770f9aa6b58dd7c5b78"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-10.radc",
                "bytes": 3199360,
                "sha256": "a938b226756144621690c2845eee7ed72aa5994d465adbcc28dcac4839e4d363"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-11.radc",
                "bytes": 3350048,
                "sha256": "b5573fe8755dee062b6b3f0a995d5c991319fe36f57f15bb76769733f0648318"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-12.radc",
                "bytes": 3298800,
                "sha256": "8432f6ce9e44e0fc349dab17cb6700ea7c575cc0da4f7ad252227653d11d67ee"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_0_0.sog",
          "bytes": 10167112,
          "sha256": "b8f00f64c24b9256ebd979a38e0d97b1e486cd833cb8281a5a6c8f0466f9c70a",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_0_0-lod.rad",
            "bytes": 2616,
            "sha256": "a03a2914e896aeb5ff167e00f7a66d58ca1723d42fdad73c4a1b528588df3281",
            "splats": 792565,
            "chunks": [
              {
                "file": "lod/0_7_0_0_0_0-lod-0.radc",
                "bytes": 3090288,
                "sha256": "6f3800c942d0f7bc01e2abebe528c74b27dc5d649f9e667add7d6ae9cc4d8067"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-1.radc",
                "bytes": 3401696,
                "sha256": "baf0f278bbcbb44864ff0a88bf47b89612d36eb978b2ab73f8623723ad41109a"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-2.radc",
                "bytes": 3305720,
                "sha256": "73cc75e2af44f0cd95052320ef2a3a8c8438b833e72da1337b102149bda2c67b"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-3.radc",
                "bytes": 3198184,
                "sha256": "010b941f2edaa03275a015622f41601b2cd8e4dfea6e9d3e57722fa339ddd3bf"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-4.radc",
                "bytes": 3135608,
                "sha256": "9bf1bdf3971589c2a6cb82b68026bbff4a095a2eb1c6c253a3d97d8d7da7a594"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-5.radc",
                "bytes": 3151816,
                "sha256": "6ccaf40c6598bc0b818fabe2f95b09f5d0f0a8ccc293be5053efab3973bd504f"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-6.radc",
                "bytes": 3429816,
                "sha256": "85b2a1f8572816a0e073cd9ff474c22ce219ce02646af70da43e3f15df6dc714"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-7.radc",
                "bytes": 3266496,
                "sha256": "95dc384141c3d77936991c1eaa15012845e39fa8d499c1722c96c41c9ccc0bc8"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-8.radc",
                "bytes": 3476424,
                "sha256": "081ed9ddd499334d3d1f2882ca29963bd78b688f2371764b794b58392167f12e"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-9.radc",
                "bytes": 3438152,
                "sha256": "9287e0ee573c3a6fc7cdac5936e81c459b23061464e6a2007410477aaff9a1f1"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-10.radc",
                "bytes": 3276344,
                "sha256": "3b6593a2afaa1e254f46113b673faec8d283458457c786183d23a32077dd8459"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-11.radc",
                "bytes": 3248960,
                "sha256": "905b94f08ad7c714ab769977f67aef5f0f3e0558d6c29fd44317eed85613c50d"
              },
              {
                "file": "lod/0_7_0_0_0_0-lod-12.radc",
                "bytes": 307760,
                "sha256": "3a34cd59f2f4375470ee7d48b9883946bbdf26eceac427783358d7fe83613ff5"
              }
            ]
          }
        },
        {
          "file": "0_7_0_1_1_0.sog",
          "bytes": 9977017,
          "sha256": "a0a394946372ca0fceee8209003e0de23f2406f70b4362b2f6b8af85185099b3",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_1_1_0-lod.rad",
            "bytes": 2520,
            "sha256": "b8520b6055b62e36487550c6c62abc3b489336de194d67598c4263f66222ef52",
            "splats": 760433,
            "chunks": [
              {
                "file": "lod/0_7_0_1_1_0-lod-0.radc",
                "bytes": 3114984,
                "sha256": "99a128227b107360d768d1fb186c3d2b0f53952436b4043e15cb60941aad087a"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-1.radc",
                "bytes": 3255728,
                "sha256": "1d55bd09ef269bde24253197c8aabc0fa6cb3a1cb03cec2f04104ca266167ee1"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-2.radc",
                "bytes": 3055368,
                "sha256": "14acaa6f3ef02de7263736b28534eaef46b7aff05bff0e4cd2c151a04e275f61"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-3.radc",
                "bytes": 3283992,
                "sha256": "14755fe4ef4e183b55131036f51c09575fb908890b3932e3172a46c010d59bf8"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-4.radc",
                "bytes": 3170984,
                "sha256": "eb90959c1ed74ff8a9fe949c928f43c0a4bebe44a4ab009c5e56c9d323ced4be"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-5.radc",
                "bytes": 3140104,
                "sha256": "b7f74c6b82ad47946be608fcbdcdd6c61af5b70d6baecdc23a2f4cca6b567b12"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-6.radc",
                "bytes": 3317488,
                "sha256": "ae76e7d2aa21127b4b858dc61fde8e830b27306f0237d115c25558f7cdb72cfc"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-7.radc",
                "bytes": 3175832,
                "sha256": "1593898fd788982ee448b460075658b1ff33393302ce632afec4d1bb29687351"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-8.radc",
                "bytes": 3388072,
                "sha256": "d2b1cb632a7a8d6860b98ebc3d197ea013b5fbfe36faaa0022a2c8da88dd9037"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-9.radc",
                "bytes": 3384352,
                "sha256": "bd58b4a548588917e31f8c7d88cb29f3b69ef9fbaab44cdacaa5158b9c994324"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-10.radc",
                "bytes": 3393432,
                "sha256": "ee5d1b3ede1aa6f85e244552fa9a93f76af6830bb8f670a6a2430ee9f8fc8f96"
              },
              {
                "file": "lod/0_7_0_1_1_0-lod-11.radc",
                "bytes": 2082104,
                "sha256": "ee36942f29614ec9c32da481d5e1afb12600e30196e4d1809737cc04e33cc49c"
              }
            ]
          }
        },
        {
          "file": "env.sog",
          "bytes": 201353,
          "sha256": "c8f2634eb022dddbb6ea4d7e2b6385354c3976dcf041804ee5c8287e6c176856",
          "lodLevel": null,
          "isEnvironment": true,
          "lod": {
            "file": "lod/env-lod.rad",
            "bytes": 1408,
            "sha256": "c2524248b1c4e04bf87a0ae20f3ccefc376844e4c177dcdb1ddc5096a07625a2",
            "splats": 6703,
            "chunks": [
              {
                "file": "lod/env-lod-0.radc",
                "bytes": 344072,
                "sha256": "ff298817818d8fb0e8bede85f334f08782a3970111c868489404b3c04e33c853"
              }
            ]
          }
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
      "splatsByLevel": [
        282830,
        566646,
        1135220,
        2273259,
        4567541
      ],
      "finestLevel": 5,
      "finestLevelSplats": 4567541,
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
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_1_0_0_0_0-lod.rad",
            "bytes": 2816,
            "sha256": "f019a5ca683aa8464c2f6a5a02d74e91238040c360e5e22a8ff755c43b49c391",
            "splats": 927142,
            "chunks": [
              {
                "file": "lod/0_1_0_0_0_0-lod-0.radc",
                "bytes": 3066528,
                "sha256": "56d5804eddc2575a3ad9791319419227d1e65bf4c2840cfb0088f66e51e99e0b"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-1.radc",
                "bytes": 3019264,
                "sha256": "b1606fc946f2fb223cedb1ed160c2693f721c76998164a1b6b097977e2bcf84d"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-2.radc",
                "bytes": 2956024,
                "sha256": "63f42f92edd5a7e5a374d64da5fdb9c234179cdabe42defeed60fc71245be9ee"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-3.radc",
                "bytes": 2959848,
                "sha256": "1a77e6159ab5c5373fb27a9ac21eb4b3953bfd3a55086f940a28da0e69594f4a"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-4.radc",
                "bytes": 2846344,
                "sha256": "9c3ebcb0a80c9761b1487b112d1b5c609a84ab59fbbd31d577aaea9e16698948"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-5.radc",
                "bytes": 3199496,
                "sha256": "2ba327d70643e5eca955336c163ab56d8b7eb8c9948efa2458d78cbe7ea8f78a"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-6.radc",
                "bytes": 2985120,
                "sha256": "a65c813ac11a09c711f7cc797e28f9c3c161c8626b23a4835f941e5713b672fd"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-7.radc",
                "bytes": 2962160,
                "sha256": "83918099f4a27470dd2d64c0c1da9d8a08e566b8467905b4d598ad21fa850fc6"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-8.radc",
                "bytes": 3012064,
                "sha256": "1ea53338424ecdc82bb76987461b29f4b3f8661b89f460f9425e70a32c23da8d"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-9.radc",
                "bytes": 3152056,
                "sha256": "01ea7159db9d1227e4f15bd57e004fbc6c89995e4631ee096c366349d352ace7"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-10.radc",
                "bytes": 3085224,
                "sha256": "b4b61846cb8edd92b1496f41ba92f62864f57e5a01a6ef482843b3b348c39526"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-11.radc",
                "bytes": 3181096,
                "sha256": "5e9e0606346b19c2b688fb8e7316a9ccc80d2acb57a37d97c927415de59c91dd"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-12.radc",
                "bytes": 3351680,
                "sha256": "d69220d1abb1d3edb9be17a0b82088e137c8e462c6f354ba54d033a728aa040f"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-13.radc",
                "bytes": 3348768,
                "sha256": "a0fb681c82a575b82733ef76d3dd5e66c202814209bbccd245067871b739ec53"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-14.radc",
                "bytes": 495224,
                "sha256": "3aa2977556bbb358d8f9fa34e48b4deade53d1b28125446892c311b75e1ec425"
              }
            ]
          }
        },
        {
          "file": "0_2_0_0_0_0.sog",
          "bytes": 11680066,
          "sha256": "bff308862a681eeb9e78b8bd630841326e481a57de82c3e3f53f410258fbde1c",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_2_0_0_0_0-lod.rad",
            "bytes": 2816,
            "sha256": "18294104ee16df56653400713d20bded2b1cd021624d879c8bbbff664e63a17c",
            "splats": 969453,
            "chunks": [
              {
                "file": "lod/0_2_0_0_0_0-lod-0.radc",
                "bytes": 3235136,
                "sha256": "ed92d4311544f976a0ccf2dae6a8e9db24a4ecbf47bfcf50275238f6e0bbe12c"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-1.radc",
                "bytes": 3308392,
                "sha256": "25853add4ffdbcede41434631700f152db1f91afab10317a8b85a9bf4a282529"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-2.radc",
                "bytes": 2958368,
                "sha256": "5591873a6ba923ca524d493fa02243e1ad9034b9800c733422b1941a0732705e"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-3.radc",
                "bytes": 2996952,
                "sha256": "ce4734d8146d65b110dddf8ba9a7dfcb1773b24215ab05182949dc43fdab4371"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-4.radc",
                "bytes": 3293696,
                "sha256": "00daf294d412e75f25acc0a0b72cb6340411dd99795376688e26078f811b9c3a"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-5.radc",
                "bytes": 3347792,
                "sha256": "b67095cf0a4fc1b3d28432952d5bc6c4e1ff0b3abdc731b0b616267eb237d4da"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-6.radc",
                "bytes": 3402168,
                "sha256": "7147bc1537b62069078b84b8de5bb96f6ac2e578b02bee014cec7846780df5cb"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-7.radc",
                "bytes": 3477056,
                "sha256": "22a8eb19b2514784979b9105fa924d1c294f14f16c25e516e03645d1c6fea27b"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-8.radc",
                "bytes": 2979832,
                "sha256": "36b01247a23f5e7be6c1506f21127216aa7870b45125a310e975053bc4a9104e"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-9.radc",
                "bytes": 3233520,
                "sha256": "771c819c9fb20237315183ce772e6df273e8fd479e3b61ce0d45881c7938b744"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-10.radc",
                "bytes": 3420152,
                "sha256": "aca82d57fa078f7dfa1988c16622cee33d41b211bd09b4827b37109a82feabcd"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-11.radc",
                "bytes": 3420632,
                "sha256": "03ce0eb998bcd529c9e58b4217775890a1050e9e80f41efa0156c4a6dae95435"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-12.radc",
                "bytes": 3376064,
                "sha256": "d12e69e697a9eec36e526d397b710a8d8ee2872253adf16faa3ab956ddabf93c"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-13.radc",
                "bytes": 3341240,
                "sha256": "0b0cff0a2683313d30e518c7d4946863cc0ccf2fec0914488157041aba0853ea"
              },
              {
                "file": "lod/0_2_0_0_0_0-lod-14.radc",
                "bytes": 2584040,
                "sha256": "ac079b38718f5c2e2c9203331ce3a5f1dc2689a5dab7256cf9dd5b18538c15c6"
              }
            ]
          }
        },
        {
          "file": "0_3_0_0_1_0.sog",
          "bytes": 10863740,
          "sha256": "70c21acf0b83f341069303262c378fd47c489c9c25174f5714192805482eed4d",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_3_0_0_1_0-lod.rad",
            "bytes": 2616,
            "sha256": "35b78eaf82ebd1efa4aebf08468060f2cfa56a9333c6a76273594b33393704b8",
            "splats": 840285,
            "chunks": [
              {
                "file": "lod/0_3_0_0_1_0-lod-0.radc",
                "bytes": 3155720,
                "sha256": "78e34ecf6c016dd22d30be94253ec6acc091ea8ee4c6040ec63ff5aa4e7cf713"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-1.radc",
                "bytes": 3175336,
                "sha256": "54b6ed5d638c09b4c2cd28097250c59da71fce788b63bcc670d2545e3cc5754a"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-2.radc",
                "bytes": 3017816,
                "sha256": "9e79a4b9aee6aefb80a8437bffdd5e4cef2c3aeb57a6720bca023b3da17892e1"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-3.radc",
                "bytes": 3084120,
                "sha256": "a084cef254116bde2f3997748ba5c08548de9f5724df7ae980094033ea3691d4"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-4.radc",
                "bytes": 3006192,
                "sha256": "204761bebaa5324b855181d1f7c81241b7fefd03fee7fd4af24f3f06e290e62d"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-5.radc",
                "bytes": 3362576,
                "sha256": "1879cadcbfb2cad4518fe76183aa2e9e80b498d4c23b451096e7fda037d0f350"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-6.radc",
                "bytes": 2914328,
                "sha256": "d216775dec783292f46d09062c1b9e9979b1ce3c70b056d8f07d427acfe59906"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-7.radc",
                "bytes": 3296832,
                "sha256": "af2cbd46131808a0239f7c5985226667ac07b57418e8090cdf705c90029711f5"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-8.radc",
                "bytes": 3297520,
                "sha256": "77e8029dcf13918ca27f7867750094c03481438a7d42385953de39049bfd2870"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-9.radc",
                "bytes": 3237800,
                "sha256": "a26e1ac5758b6a0c2e24eb7bff8801c4f17e6cb882239a3afbb897ae67b35ce2"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-10.radc",
                "bytes": 2927816,
                "sha256": "c263859c45dd93e400c4dea3e7338e98c373469c498d86cce224fdf86e74fecd"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-11.radc",
                "bytes": 3389752,
                "sha256": "4322da967e69b868c51af7affb573bd86c81b1de9b895b6c3a945aca28824f6b"
              },
              {
                "file": "lod/0_3_0_0_1_0-lod-12.radc",
                "bytes": 2546896,
                "sha256": "4aa08b8c1bc44e71b1ae6ea00699cc46aab68fe0d10fdafa5b9b58cbf912fc03"
              }
            ]
          }
        },
        {
          "file": "0_4_0_0_0_1.sog",
          "bytes": 9160530,
          "sha256": "2b4a677bda03f49b79d1c7f3531557531208a9a4496c10367ca71ba23788aa2d",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_4_0_0_0_1-lod.rad",
            "bytes": 2424,
            "sha256": "bd81a144a7599d0e423e5b8cea51eb6df42c046e5f967ee62ce1e1d6db6356ba",
            "splats": 717124,
            "chunks": [
              {
                "file": "lod/0_4_0_0_0_1-lod-0.radc",
                "bytes": 3176728,
                "sha256": "65501c8c9bbd6d39d77dae05ea506d4fe5369012ef4f861e73c87323efe1b4a4"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-1.radc",
                "bytes": 3198528,
                "sha256": "df09523bb3d8bc655abc3b6d47c6360d22807a26071713ef8fbe2c0a3b980adb"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-2.radc",
                "bytes": 3208160,
                "sha256": "2e32909313641151443de38d66a18e8a849c520c361b1d14259bd04cc63cc605"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-3.radc",
                "bytes": 3234488,
                "sha256": "ac45b3b3c12bdf878f3195b830d874395711deee734b9b83e7a94831c320260a"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-4.radc",
                "bytes": 3370040,
                "sha256": "c0a3c94e38d773930fe642e8634eb40d36ecd79fd73aa1e23a4c50d3c409634b"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-5.radc",
                "bytes": 3230256,
                "sha256": "dd9107a421e85eee1da53578fb22c41ae767363bee22ac1147933592414712a6"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-6.radc",
                "bytes": 3291960,
                "sha256": "b52207fd06b9e9d5ceb0c8328caa98f676f3e232eedb3b78bd12eb5e846276b6"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-7.radc",
                "bytes": 3377400,
                "sha256": "80a41ca80824ea49ad81090a9cd2c35a2d76ea8622afe73d4fba952e075ff4a1"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-8.radc",
                "bytes": 3334840,
                "sha256": "8cbc21ac68a4a14166a271b9b75bdad0713bb8b773f41058935ffdc46389e59e"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-9.radc",
                "bytes": 3379304,
                "sha256": "326ce2b7ce26db1866d8c6730754e055e803437e0672d8710001634bbb01bc13"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-10.radc",
                "bytes": 3232000,
                "sha256": "7a93cb387b4bf7b0d6a967f2f5e36b520fe8e45b8921175f0fef26a50329777e"
              }
            ]
          }
        },
        {
          "file": "0_5_0_0_0_0.sog",
          "bytes": 10888914,
          "sha256": "0b2aabfa856cec9c8e092dc086881bc33ced6854771efcba0fe7a8f36ff93c81",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_0_0_0-lod.rad",
            "bytes": 2720,
            "sha256": "3b72c30daf07c3040a2d612a330200d37f6e4828e6f4ed1dd47d47692789db62",
            "splats": 872218,
            "chunks": [
              {
                "file": "lod/0_5_0_0_0_0-lod-0.radc",
                "bytes": 3495776,
                "sha256": "8b306f2e592382d7a703044f8933376451d9f13d7599b1bc2d388fbdff386aa0"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-1.radc",
                "bytes": 3243968,
                "sha256": "71d24ba583a5a04af951e2f836464aea65d66c9063a661d3695f291f65498d5c"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-2.radc",
                "bytes": 3044144,
                "sha256": "e9604d5ab67ed98b9d46195c4984ef10ce973258b43111a3bd40893931baf565"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-3.radc",
                "bytes": 3337120,
                "sha256": "88eb41b4e1c51c31b716b7c049e687193dacc79f6449b52e6599d3cbab536553"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-4.radc",
                "bytes": 3136768,
                "sha256": "7f00f3c7ed0e1c3c32af0f5e4a5a11677f3ec0cb198096b98034cbab8a25c053"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-5.radc",
                "bytes": 3111240,
                "sha256": "f26b3f08ac630aa8febeaeb581d28f7035ab4ac5f6a9e9d5832e0b0931685d74"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-6.radc",
                "bytes": 2883360,
                "sha256": "fa83551bee939dc5250f8721fd89f22293cc1d0ed2fd5b537cea0cd5656d610d"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-7.radc",
                "bytes": 2918816,
                "sha256": "78aadfa034064d3ed0da7ab0126d9c59b2c9d20d63d40ded0a54d7dc5e2175ce"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-8.radc",
                "bytes": 3285432,
                "sha256": "e34a2824bcc50b88008c85fb5e770cdd32604fae137bf7d055a99d2287abb22a"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-9.radc",
                "bytes": 3417024,
                "sha256": "faa7b81576d1505f0ae5a5b4163f89c7e612632138959399d9bf7c8d62518660"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-10.radc",
                "bytes": 3366928,
                "sha256": "6ba65e4101349fe106057cded2ff13ea7974af9cddd5c279018a73e9c6a34601"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-11.radc",
                "bytes": 3384920,
                "sha256": "082c1bc3ce8b6f4f5df3f22a89b769b7e6fac4906f274617392cd2c4177d361b"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-12.radc",
                "bytes": 3229064,
                "sha256": "92732dcf9817f951f09abc8b1077ae83a60ed0281d51bb002c99518f99407216"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-13.radc",
                "bytes": 1035672,
                "sha256": "99c9f8c0d1a22689f13ca283e3c554108215e0a6c96e19d82925e14329ee3a6d"
              }
            ]
          }
        },
        {
          "file": "0_6_0_0_0_1.sog",
          "bytes": 10641195,
          "sha256": "7755104db0ce7a884557f2ce8eede237d00d511fff5de9716593e394e415a2bc",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_6_0_0_0_1-lod.rad",
            "bytes": 2616,
            "sha256": "7a5271e2d816b1c4ad5aec5af8f3207e742efcd6a8bad586b700e7ac4c8228a2",
            "splats": 845389,
            "chunks": [
              {
                "file": "lod/0_6_0_0_0_1-lod-0.radc",
                "bytes": 3120336,
                "sha256": "8630e62d9333d69c957bcba4bc68709687f43053569d9cf3e8b78a038f85f9f5"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-1.radc",
                "bytes": 2930168,
                "sha256": "2f8c2b6ed3999f8ab18d97525d9e8a773be2b61e2b6cfecc69071b145205c8a9"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-2.radc",
                "bytes": 3218360,
                "sha256": "9b2c691d298a6a38342e3c41995358292866a44571cf4f2ac18649a2a3bec6b8"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-3.radc",
                "bytes": 3139048,
                "sha256": "e517abc4c73ada68dfa8d40efa91da607a3ff1a72725091928861db7e0033762"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-4.radc",
                "bytes": 3037192,
                "sha256": "03db0431efec3a843d7951e06d832a15ab5e77e97477be70289620aa09f13331"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-5.radc",
                "bytes": 3056304,
                "sha256": "abe57062b34f35b0d4404fea052753be1b99b5243e8e31ff37650e4b69198ff2"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-6.radc",
                "bytes": 3345880,
                "sha256": "89a2ad0b7fab253bf784eb52d21e83725ac06cf620f207884d931a21787f27c0"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-7.radc",
                "bytes": 3214920,
                "sha256": "3ad19076c85578da06368bdceb45782f1b2bc32770f7b6350a77313b825a0471"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-8.radc",
                "bytes": 3306472,
                "sha256": "16ec1f3a9a1a7fa676ea8946d43352367af5bc4a0eeafc657924871d3e081e60"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-9.radc",
                "bytes": 3013616,
                "sha256": "8224a5b75ff0d7af3c9ed86eeacb8a7609adc314f54bd7ea0c7312e133ff3053"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-10.radc",
                "bytes": 3067448,
                "sha256": "16b0b8667272a2b6b5028e004f770b7f17361effe53b52415e5cef3511453234"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-11.radc",
                "bytes": 3303368,
                "sha256": "424499affd8ce27023c08cc6fb8635648a7be9862f4127774eb3797c2a5bec41"
              },
              {
                "file": "lod/0_6_0_0_0_1-lod-12.radc",
                "bytes": 2966256,
                "sha256": "06bafe45c13f05cc0472f85eae43c3eb53bf3f13a2c6d263ec19b2073b6bad82"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_0_1.sog",
          "bytes": 10593746,
          "sha256": "7db77ca010c356574369515eb5662ced8229e055b93caa3f24b01d89d70f4ef5",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_0_1-lod.rad",
            "bytes": 2616,
            "sha256": "bc952a52db84dc4cec4ca323e55ac2a7799d64ef735d01312bc6d924961e94d3",
            "splats": 823705,
            "chunks": [
              {
                "file": "lod/0_7_0_0_0_1-lod-0.radc",
                "bytes": 3022848,
                "sha256": "5f22382cadb739fe5b9705bdefe3824cee5b557b82ad5c378afa7906bc6c7a56"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-1.radc",
                "bytes": 2897272,
                "sha256": "b4239922ed5a4af191d93ef6bda0bb013ad6871792aec818a83462a84c16552b"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-2.radc",
                "bytes": 3128688,
                "sha256": "736e2ae71710c645833dcebcdeb24ee14bb4dfc30328850bd5e2584ec5ef8df6"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-3.radc",
                "bytes": 3157096,
                "sha256": "99c4bf93b3de9996a93ab461be1a435cb0904898692c0751b75437258202ac78"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-4.radc",
                "bytes": 2991768,
                "sha256": "ca61715f026890a0bc5fd4ecb296c7c4e91b749d7dfefb9f4e23d4d717d12f5b"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-5.radc",
                "bytes": 2688840,
                "sha256": "5053b1bd2cfcdff1bcd251efee4370255e25e273d1a73206882769bbb8652546"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-6.radc",
                "bytes": 3325664,
                "sha256": "22fa685ec045aab59974fc3ac8cf8d9996d1d6942340676259f606ea126b9b48"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-7.radc",
                "bytes": 3130384,
                "sha256": "1518c11622f4e0e981affb765d1c2707cb16b21088ffd5a39e620ad4242ebe7e"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-8.radc",
                "bytes": 3167608,
                "sha256": "8bbb67b295ba283771bc800d4d17c8bb35f594adb17ebc9ce3b539bc44c5470e"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-9.radc",
                "bytes": 2884360,
                "sha256": "32be367b209a8d22879c99e60fc23cd051870da4e583048d7a42816c864f7d51"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-10.radc",
                "bytes": 3246696,
                "sha256": "158aea7aa80e5b898ed6d87cdba802f04047b4433a6ab76e367278b55cac7dcb"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-11.radc",
                "bytes": 3224512,
                "sha256": "c6e6c56fd497f023a01b8b0ac732322cd4f2a62c533242d0a63048ad467972a4"
              },
              {
                "file": "lod/0_7_0_0_0_1-lod-12.radc",
                "bytes": 1947696,
                "sha256": "c6d629a2b2ee4ce025dd952f7bde3149fe83fd1b85144d0aef2603669aaee1f6"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_1_0.sog",
          "bytes": 6367616,
          "sha256": "4c64b91881e074398c88266acf1300d17595cea34a2fc7bd288be4af527e68eb",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_1_0-lod.rad",
            "bytes": 2016,
            "sha256": "8b922883672924b614d0959d3239228ec307f22b2b16eddf7c8356f40ca36a00",
            "splats": 399962,
            "chunks": [
              {
                "file": "lod/0_7_0_0_1_0-lod-0.radc",
                "bytes": 2897184,
                "sha256": "262e1b2411b8f6136b9520daf23e4a15da3960568fc9253b1ec3b531bda0a402"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-1.radc",
                "bytes": 2880504,
                "sha256": "621250ffbd4d945f10d900be3ac5d39dd09a28fc1d4d8ed91251dddff9743778"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-2.radc",
                "bytes": 3017592,
                "sha256": "215c097b2d83d8b9b626f283ed6c87dc9fe2036e7c0076ed2654aa42b723b4e9"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-3.radc",
                "bytes": 2919472,
                "sha256": "1b40f36acf5c347496c85e00275c5493d41d1c1d738178ad737dcbd931626c5e"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-4.radc",
                "bytes": 2661296,
                "sha256": "15341579525a94612bbf754c2ce981112e9a2666ff891a03db5c2b01624736a5"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-5.radc",
                "bytes": 3060232,
                "sha256": "4128e4316e2d5364441d5d2dea5212f61c7b3e2a9e520eb4f5b81b7d1fbde691"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-6.radc",
                "bytes": 300200,
                "sha256": "ead174e9cad10b2cbf5f34e71f61685423bb8b024f9f2ee8af547983d748af42"
              }
            ]
          }
        },
        {
          "file": "env.sog",
          "bytes": 330378,
          "sha256": "8711a9f483ad3f7f890d5e5eb4c741632bed7ec2a839d21f662618eade17a90b",
          "lodLevel": null,
          "isEnvironment": true,
          "lod": {
            "file": "lod/env-lod.rad",
            "bytes": 1408,
            "sha256": "52586914130e368d64dc2a18dabd5704d40873bc0a5f95af3177a75304a76028",
            "splats": 16791,
            "chunks": [
              {
                "file": "lod/env-lod-0.radc",
                "bytes": 851696,
                "sha256": "092c877ec646d6f4fd2d6a27ed8b5b9117f1fa68a5ca7c59382c0286f909993f"
              }
            ]
          }
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
      "splatsByLevel": [
        285187,
        570650,
        1141793,
        2286022
      ],
      "finestLevel": 4,
      "finestLevelSplats": 2286022,
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
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_1_0_0_1-lod.rad",
            "bytes": 2592,
            "sha256": "8aba450b6774fb15940e065688ad09c95585305e9d6e79b6d46fbc153de6f82b",
            "splats": 794282,
            "chunks": [
              {
                "file": "lod/0_1_0_0_1-lod-0.radc",
                "bytes": 3221688,
                "sha256": "e933c68db7bdab59027325ce6ad06c5a74cb2ac3a0161bf77b5b922f9299630d"
              },
              {
                "file": "lod/0_1_0_0_1-lod-1.radc",
                "bytes": 3254192,
                "sha256": "f475c2dbfe7a1d7420c479f6b6e05c75a326cdd7cc057e25365b6c518b2f6664"
              },
              {
                "file": "lod/0_1_0_0_1-lod-2.radc",
                "bytes": 3278616,
                "sha256": "7291d0e0e562802311f7dc5cc8ef645ed5959a99656035b570da18acba71742d"
              },
              {
                "file": "lod/0_1_0_0_1-lod-3.radc",
                "bytes": 3237712,
                "sha256": "9f8a334ea69d621b55a3d5a5e530a0d40e2544aefab2ac1a43108780bbd63b43"
              },
              {
                "file": "lod/0_1_0_0_1-lod-4.radc",
                "bytes": 3365920,
                "sha256": "d0e2f315650ad4de5ae99c7722cafe01b9a50415f698404f0610e5f1d1feb6aa"
              },
              {
                "file": "lod/0_1_0_0_1-lod-5.radc",
                "bytes": 3165080,
                "sha256": "4c658937299cb9d8e1f0ba3623721e7c49ca32e9b9aa17be7330b9b48bc0e7b5"
              },
              {
                "file": "lod/0_1_0_0_1-lod-6.radc",
                "bytes": 3370960,
                "sha256": "b1ba6057c06d3931d2e75ecdd10ccf6f35e650bdff0faa9888bc0bac73e159dd"
              },
              {
                "file": "lod/0_1_0_0_1-lod-7.radc",
                "bytes": 3306480,
                "sha256": "a2fd0bbee223b4fec7a016d66e9e42549c5d9ef068301db761c946e1fb3a96ad"
              },
              {
                "file": "lod/0_1_0_0_1-lod-8.radc",
                "bytes": 3376520,
                "sha256": "9d8f2aee8fd4b15e47936a10322d0ad348f5fd6bb1a5d4281643a9ea410e53f4"
              },
              {
                "file": "lod/0_1_0_0_1-lod-9.radc",
                "bytes": 3336416,
                "sha256": "41def18675a15bc3502ee8302404cba466fc0c22f2212d0ff49d96c53bc86fbe"
              },
              {
                "file": "lod/0_1_0_0_1-lod-10.radc",
                "bytes": 3300520,
                "sha256": "098b111b034f6957de609a406b5e9537ea593b7f8ff9274e904bcb899315bf54"
              },
              {
                "file": "lod/0_1_0_0_1-lod-11.radc",
                "bytes": 3264696,
                "sha256": "460656b4472a5fdf1ea3ec4b3218099d6dadc8042fbd0679d748bef98baf24bb"
              },
              {
                "file": "lod/0_1_0_0_1-lod-12.radc",
                "bytes": 408336,
                "sha256": "f73c658b4e16fab128e73edace3ff27abb72f6664facea15b91a2bb1a695aba1"
              }
            ]
          }
        },
        {
          "file": "0_3_0_0_1.sog",
          "bytes": 9542928,
          "sha256": "d2e1d8b87a6a628bae1127277a95267c6fc14a6ffe8f48aa23a547ef061a5804",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_3_0_0_1-lod.rad",
            "bytes": 2392,
            "sha256": "5a4b195fc287856e75ee7cccc7cc3a76686d7cd93e42532daf8377ab95354f68",
            "splats": 703278,
            "chunks": [
              {
                "file": "lod/0_3_0_0_1-lod-0.radc",
                "bytes": 3266720,
                "sha256": "a9b22224cef1586b7bfd248e2d474ef9cbe79d009cb127e1a4a8e2a0eb343703"
              },
              {
                "file": "lod/0_3_0_0_1-lod-1.radc",
                "bytes": 3193792,
                "sha256": "dddc09d4c02722c838019b86d6dc2fcaaaec9832cca813ae1ceb71bf7227d9dd"
              },
              {
                "file": "lod/0_3_0_0_1-lod-2.radc",
                "bytes": 3368072,
                "sha256": "8601c7b5ad1093bb28ccfe9fbe919f1e9e7691a7f1fa88b75d5f3d44beca7050"
              },
              {
                "file": "lod/0_3_0_0_1-lod-3.radc",
                "bytes": 3284984,
                "sha256": "d77f8aad28f595b33607eaed1eaa7226f1eea80f3df13f4f74ab6cef05349a43"
              },
              {
                "file": "lod/0_3_0_0_1-lod-4.radc",
                "bytes": 3166616,
                "sha256": "d26413fc8cb938d8983111f1d5adfdab04c06b0946bc8db4b21489bb037b7e1a"
              },
              {
                "file": "lod/0_3_0_0_1-lod-5.radc",
                "bytes": 3251208,
                "sha256": "3bac5679bec709095d1443c3366bac931cfaf3664ad1075fcfc302af92350dc0"
              },
              {
                "file": "lod/0_3_0_0_1-lod-6.radc",
                "bytes": 3312656,
                "sha256": "422e7b03da7b2a81d8bb390a0256bf6836c9ab4cba2bf6f7e89903045dfdc175"
              },
              {
                "file": "lod/0_3_0_0_1-lod-7.radc",
                "bytes": 3367104,
                "sha256": "b44a088eaa958b3287af67d8b4aa615cfcd0173825d148262fbdeaea427108fa"
              },
              {
                "file": "lod/0_3_0_0_1-lod-8.radc",
                "bytes": 3365312,
                "sha256": "deebcd6336c91b8263159cebf6297f6c2be4dac7eab5fbfed1fd65fb56283d1c"
              },
              {
                "file": "lod/0_3_0_0_1-lod-9.radc",
                "bytes": 3258848,
                "sha256": "aef70d409c13d2577989e8a5babdeab31e4fd0d91ebd5d70bc44a32a9dac5a7d"
              },
              {
                "file": "lod/0_3_0_0_1-lod-10.radc",
                "bytes": 2456976,
                "sha256": "87b21016e54bdd1a1f132537416823ac75967f6847fc0a533441b61706967f58"
              }
            ]
          }
        },
        {
          "file": "0_5_0_0_1.sog",
          "bytes": 10240293,
          "sha256": "2645bb78bcaf267710897f13d78c75c0a8ba86629e19f029009739b04ad416b8",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_0_1-lod.rad",
            "bytes": 2496,
            "sha256": "fa2441ec6222a6177f8c4b5ae8a4dee5b9e977118aedcc926377139f56e8277d",
            "splats": 779721,
            "chunks": [
              {
                "file": "lod/0_5_0_0_1-lod-0.radc",
                "bytes": 3325152,
                "sha256": "c09f5a0db16c1b0598fb15e7afdac72b2024ef47ec7f80f2e7c815530a451c22"
              },
              {
                "file": "lod/0_5_0_0_1-lod-1.radc",
                "bytes": 3326800,
                "sha256": "b6d85710c90ca7bf2801e2d8bc8fb55305a78bf22912ee8e8cb366047f100581"
              },
              {
                "file": "lod/0_5_0_0_1-lod-2.radc",
                "bytes": 3229520,
                "sha256": "8b7cac0da8bea272a9a86ccd6ee811ad4385cdf8d3be01b94edb6b622f10f9aa"
              },
              {
                "file": "lod/0_5_0_0_1-lod-3.radc",
                "bytes": 3313872,
                "sha256": "70709324f3a73d2d8bc52cbb1736fb049cd8adf622f6fac17458240b70732644"
              },
              {
                "file": "lod/0_5_0_0_1-lod-4.radc",
                "bytes": 3239416,
                "sha256": "a1fe453363b90223cfe9627419caa975905e1c6da561aff5f5c1faaf89c16fa7"
              },
              {
                "file": "lod/0_5_0_0_1-lod-5.radc",
                "bytes": 3376864,
                "sha256": "1cdcca1140a7751517b6d8e6d7b5875bf639cffd5a9d2d97ebd4e84e1d2077b7"
              },
              {
                "file": "lod/0_5_0_0_1-lod-6.radc",
                "bytes": 3321512,
                "sha256": "825069d412b696b05d41a773175a8bebb9d76e5924b6397e5373c83385ce963f"
              },
              {
                "file": "lod/0_5_0_0_1-lod-7.radc",
                "bytes": 3440344,
                "sha256": "96c2305168ef489545025f2fbfad4603491033fabed837d27b4ad441a40765f2"
              },
              {
                "file": "lod/0_5_0_0_1-lod-8.radc",
                "bytes": 3333456,
                "sha256": "adefcc0cad6740c9cdf9c97411c9cf03d6d8c301e17ce253992f58df4de44646"
              },
              {
                "file": "lod/0_5_0_0_1-lod-9.radc",
                "bytes": 3142312,
                "sha256": "8e9a1c9b8a012cbeac5df82c1ac4057b009df4c97fef2bb8b973dafe52f13290"
              },
              {
                "file": "lod/0_5_0_0_1-lod-10.radc",
                "bytes": 3383528,
                "sha256": "d950626df9ac1cda831aad90317fd804bad4fd85653949838fb68271fa598ecf"
              },
              {
                "file": "lod/0_5_0_0_1-lod-11.radc",
                "bytes": 3032792,
                "sha256": "5b1b22d7d902e753316b964973357b68ce4e136e9070e5fd33d978a36763523b"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_2.sog",
          "bytes": 10256741,
          "sha256": "48284eda318683f4481524603cf719145924de5d06d42566cb72fe3fee96ad8a",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_2-lod.rad",
            "bytes": 2592,
            "sha256": "28118c3bee3b769b7dc65c6ac41a41083c91be9629dd0c54d5fa85675ddb70ec",
            "splats": 790908,
            "chunks": [
              {
                "file": "lod/0_7_0_0_2-lod-0.radc",
                "bytes": 3287048,
                "sha256": "d885e536daa389d2122b8a13d3c9313eeb0c53f64e103ce0bf1bf3fba4644138"
              },
              {
                "file": "lod/0_7_0_0_2-lod-1.radc",
                "bytes": 3281568,
                "sha256": "a69945d08bf52a3b1072f13a6d1d1a83156ac9056c5c77d253019d964d3db70b"
              },
              {
                "file": "lod/0_7_0_0_2-lod-2.radc",
                "bytes": 3320224,
                "sha256": "d68b02f437bd38e376535ae750a4c0c8e325f39d420c2d2a5c9e77888f826105"
              },
              {
                "file": "lod/0_7_0_0_2-lod-3.radc",
                "bytes": 3349136,
                "sha256": "6626fb13c97b5315ab3334cbad110da37cecd13d947d2ef3104897ba48cb82d7"
              },
              {
                "file": "lod/0_7_0_0_2-lod-4.radc",
                "bytes": 3273240,
                "sha256": "978cca5475e8f7e2d3001ad7a42d0cf5f5295bf14e01bba1e81c36b647be3618"
              },
              {
                "file": "lod/0_7_0_0_2-lod-5.radc",
                "bytes": 3334040,
                "sha256": "1b71fc73afc833eb93fa77bb681c171d11a511a20ceec260b412a1a22a8bc5c2"
              },
              {
                "file": "lod/0_7_0_0_2-lod-6.radc",
                "bytes": 3332552,
                "sha256": "8d6eadfe9fede602b35f461698f8d624500753d5abf66d2b70e9009f5f4bfbbb"
              },
              {
                "file": "lod/0_7_0_0_2-lod-7.radc",
                "bytes": 3275464,
                "sha256": "78c0a0e28b272dec90a45689295df6840c68c068c191fa4ca1bc24c848166fed"
              },
              {
                "file": "lod/0_7_0_0_2-lod-8.radc",
                "bytes": 3511088,
                "sha256": "f00030fde56fbb5ff78bc2fdd14d215b5c06f3a8dcdbead25bb16772b4ca5d18"
              },
              {
                "file": "lod/0_7_0_0_2-lod-9.radc",
                "bytes": 3345568,
                "sha256": "75c90d4b1a66df5c61e54fcb81b3e09c824c2998ac0fa2fe5f61a667434b6230"
              },
              {
                "file": "lod/0_7_0_0_2-lod-10.radc",
                "bytes": 3358928,
                "sha256": "714846f69b2f299db4988e813224efcbddd556fb8e47ea362228cca6ab5e16a0"
              },
              {
                "file": "lod/0_7_0_0_2-lod-11.radc",
                "bytes": 3370896,
                "sha256": "8a34f3446a40788a76ee2f88394b607312bbdcacfa22914f201d735fb33a219e"
              },
              {
                "file": "lod/0_7_0_0_2-lod-12.radc",
                "bytes": 228496,
                "sha256": "449a433f62dd2e134522babd8fbfa8e0f7552f5239d25e56b9ea942e52786baa"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_3.sog",
          "bytes": 3633331,
          "sha256": "1a23afeac5b5d83e75d8f3f53f4d0aad3e3461059e5e06b9df2f3f03961d2d01",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_3-lod.rad",
            "bytes": 1616,
            "sha256": "c64bf813c763762c6982f9b0139058e6f1afa2cb2febbc4802278cc78e75b959",
            "splats": 148076,
            "chunks": [
              {
                "file": "lod/0_7_0_0_3-lod-0.radc",
                "bytes": 3280200,
                "sha256": "df3100c021d9882d88e130a74bcf1631195c33fa150eee5d0500210ee92dec27"
              },
              {
                "file": "lod/0_7_0_0_3-lod-1.radc",
                "bytes": 3274704,
                "sha256": "d2d5d6a2038cbc0e1719b0453a1ec4ade8acf508047c558f3718e8d7363e21ee"
              },
              {
                "file": "lod/0_7_0_0_3-lod-2.radc",
                "bytes": 860608,
                "sha256": "84e80ee964b6167fbafd58eba589d1e1af83d200fd3a0474c91eef9071b66b15"
              }
            ]
          }
        },
        {
          "file": "env.sog",
          "bytes": 115592,
          "sha256": "948c331c7f15c7698d87e8cfabce3e162e70e2e78de1cd5f622e6ad2c5325114",
          "lodLevel": null,
          "isEnvironment": true,
          "lod": {
            "file": "lod/env-lod.rad",
            "bytes": 1408,
            "sha256": "4b138931f858d8e097c0d88b7af4318bbc6444fd29c3fd28a0d7f7145e8fbabf",
            "splats": 3083,
            "chunks": [
              {
                "file": "lod/env-lod-0.radc",
                "bytes": 163440,
                "sha256": "5d258cbb2f341a8fd00bb5bd638756896b6f6136b68529819e61c77f025e08b5"
              }
            ]
          }
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
      "splatsByLevel": [
        354818,
        709939,
        1420574,
        2851361
      ],
      "finestLevel": 4,
      "finestLevelSplats": 2851361,
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
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_1_0_0_0-lod.rad",
            "bytes": 2488,
            "sha256": "9c0a471f1c3e79586bb496a33255eacb95ff2861f3daae6381fb4377fd583fa3",
            "splats": 731142,
            "chunks": [
              {
                "file": "lod/0_1_0_0_0-lod-0.radc",
                "bytes": 3143488,
                "sha256": "bb6284655db49f9c733a98e19497a86ba5bc986197208bf73a7d33718f2531f2"
              },
              {
                "file": "lod/0_1_0_0_0-lod-1.radc",
                "bytes": 3165320,
                "sha256": "66670b70a1ece37c0fcdf5dd321a2cb926eef1efd0b4a547e1a68b2388963983"
              },
              {
                "file": "lod/0_1_0_0_0-lod-2.radc",
                "bytes": 3293776,
                "sha256": "dcff7ef58d3e165968529b3abc64154a5fdd3fcc7729190aa1188a41e6f6d74b"
              },
              {
                "file": "lod/0_1_0_0_0-lod-3.radc",
                "bytes": 3146096,
                "sha256": "fb946e64ab64fc10ee9b50257ec8758e417341cc334f8774ef85e9e156352bca"
              },
              {
                "file": "lod/0_1_0_0_0-lod-4.radc",
                "bytes": 2869080,
                "sha256": "31b476ad0b1cd32b57641fb83a35a39ff72e36942600bef6802c5d0b9a3ae984"
              },
              {
                "file": "lod/0_1_0_0_0-lod-5.radc",
                "bytes": 3212352,
                "sha256": "e6df0302b2cf75212f57e9cd6e264a67f7aeee991b11424d1c5a40cbb4652e90"
              },
              {
                "file": "lod/0_1_0_0_0-lod-6.radc",
                "bytes": 3214664,
                "sha256": "59afde927041261df2bd6e2fe76a3dc8cc102f7e9675febf2390b65c3f78b066"
              },
              {
                "file": "lod/0_1_0_0_0-lod-7.radc",
                "bytes": 3254144,
                "sha256": "f89620b707456c7b5234ba32a5f1cd94bcc51a62d051adc698323b2dcfae2408"
              },
              {
                "file": "lod/0_1_0_0_0-lod-8.radc",
                "bytes": 3268784,
                "sha256": "40b8327f2dadf944c9b31b628be9b89b4dded2294a163d64cff8f7c422608d7b"
              },
              {
                "file": "lod/0_1_0_0_0-lod-9.radc",
                "bytes": 3087232,
                "sha256": "5f3267d0a63b010f4beca7a3bbcf6d3b2f22668abee5ecbe2ce57ecf88831bd1"
              },
              {
                "file": "lod/0_1_0_0_0-lod-10.radc",
                "bytes": 3203488,
                "sha256": "902fea81c3160fde8765cf90837fa0c7eba3951b1b7c16e5e6da3602e27665c7"
              },
              {
                "file": "lod/0_1_0_0_0-lod-11.radc",
                "bytes": 463680,
                "sha256": "351198188cdd1122a2612c1c7a212e8292440eea7ca30709058d4919fdc3f08c"
              }
            ]
          }
        },
        {
          "file": "0_2_0_1_0.sog",
          "bytes": 9586076,
          "sha256": "ddfaca78a85f0ec0319e468a931124b0a6b169b2f6940fdcfe442369ba3ff602",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_2_0_1_0-lod.rad",
            "bytes": 2496,
            "sha256": "80112a5e5df4b68ba52020ac892a639024dccf7a5655063c938a0d8319ccfa17",
            "splats": 764254,
            "chunks": [
              {
                "file": "lod/0_2_0_1_0-lod-0.radc",
                "bytes": 3191704,
                "sha256": "618d820ba8b37e21e2d7c6a73936f806a41b6e2425f09421fb280da1ef06395c"
              },
              {
                "file": "lod/0_2_0_1_0-lod-1.radc",
                "bytes": 3296792,
                "sha256": "030ed45e9a4ef246081bec6be11f48bc9d8ad620759a38be2f34c1847eadc28d"
              },
              {
                "file": "lod/0_2_0_1_0-lod-2.radc",
                "bytes": 3025624,
                "sha256": "58d1f18432ff9233e12a528b46327e0428e5c1e9b341871b9396a58c33ba953f"
              },
              {
                "file": "lod/0_2_0_1_0-lod-3.radc",
                "bytes": 3194984,
                "sha256": "6c1aabfb47a824c302e1194b0d5e88dca5794633c7a69c835030c02157648d8b"
              },
              {
                "file": "lod/0_2_0_1_0-lod-4.radc",
                "bytes": 3205328,
                "sha256": "7d0192ae429e4d09c38b780e1069d32033012bcc36e8d589395ecff816817326"
              },
              {
                "file": "lod/0_2_0_1_0-lod-5.radc",
                "bytes": 3277936,
                "sha256": "4ea360d41c0763ace900b767eb5f0e6cb1e330cf9e08eac7828b663a757b619e"
              },
              {
                "file": "lod/0_2_0_1_0-lod-6.radc",
                "bytes": 3052200,
                "sha256": "b2d339eccab622c994878c5715e7e444625b86893794042a268ea9f5e1d96e95"
              },
              {
                "file": "lod/0_2_0_1_0-lod-7.radc",
                "bytes": 3326384,
                "sha256": "08053d86a465b1aa4da4cee1f3ed2bd8715a27a597495ed276e574785bcaac7b"
              },
              {
                "file": "lod/0_2_0_1_0-lod-8.radc",
                "bytes": 3229248,
                "sha256": "86efdbc437cf7e1685046742c89465be4589983240151ae5dbf849b73d578ec7"
              },
              {
                "file": "lod/0_2_0_1_0-lod-9.radc",
                "bytes": 3114360,
                "sha256": "94eeea6c3765b0163c50ed7a84826ba9bfecb6015b237689c820e0629f0998dd"
              },
              {
                "file": "lod/0_2_0_1_0-lod-10.radc",
                "bytes": 3010600,
                "sha256": "47d0d38471899f22494923cabe16e4fd87e97cfdca7b674ce4324734e1ce211e"
              },
              {
                "file": "lod/0_2_0_1_0-lod-11.radc",
                "bytes": 2193200,
                "sha256": "41b4fc3237f6d0f04f6327d1fa24d1c6523ce22cd2c89ac049ee48be6a4d8941"
              }
            ]
          }
        },
        {
          "file": "0_4_0_0_0.sog",
          "bytes": 9855066,
          "sha256": "91c8a015213ce2c398e2e2981d23eea50c3868011c376f67bfb8132b45802c07",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_4_0_0_0-lod.rad",
            "bytes": 2592,
            "sha256": "13fabc9bd05b5c5abee4aac59fbbe310ff7428631ee2ff26b3e5f216debfb1da",
            "splats": 798103,
            "chunks": [
              {
                "file": "lod/0_4_0_0_0-lod-0.radc",
                "bytes": 3171192,
                "sha256": "75f3d3b2e37b932c29407091354e6efa1e3bbe6c62914bed9505cc45b2040272"
              },
              {
                "file": "lod/0_4_0_0_0-lod-1.radc",
                "bytes": 3106704,
                "sha256": "6768038e8129d9ba30b692b0dce2739a7f2e6a57bdc6c03c045fbdea23d0ebb9"
              },
              {
                "file": "lod/0_4_0_0_0-lod-2.radc",
                "bytes": 3196432,
                "sha256": "148f3005a5f1a8a68202190f5ee3c7bb4f391251b5490bc9522838bd1aa71f22"
              },
              {
                "file": "lod/0_4_0_0_0-lod-3.radc",
                "bytes": 2895312,
                "sha256": "dfc2ebaeb53d2da74be47b4fd96be9439d865761bf1022dcaf9540628f6d7c20"
              },
              {
                "file": "lod/0_4_0_0_0-lod-4.radc",
                "bytes": 3118248,
                "sha256": "8a2dc9bd0cdef340ed67ff269f3d3d2789e5eee8f93512b30da915bbabe5bf99"
              },
              {
                "file": "lod/0_4_0_0_0-lod-5.radc",
                "bytes": 3277032,
                "sha256": "89fbdbdbd2bbbacd50a41d6afcd65803fa43a910a03fa293cc714155437a73fe"
              },
              {
                "file": "lod/0_4_0_0_0-lod-6.radc",
                "bytes": 3315288,
                "sha256": "e890c49bec7107ff278f5721f28bcec9d5ceaad5503ff2c1118f9f22c3256021"
              },
              {
                "file": "lod/0_4_0_0_0-lod-7.radc",
                "bytes": 3244024,
                "sha256": "09b984d879ac8e08f131544c0c3427ff2450a41ccd4fac3ea35daa5b0a27cc72"
              },
              {
                "file": "lod/0_4_0_0_0-lod-8.radc",
                "bytes": 3311544,
                "sha256": "227e25058753eb67b75ccaa1f18311296b1940a395e323976f961d8cef8c44c0"
              },
              {
                "file": "lod/0_4_0_0_0-lod-9.radc",
                "bytes": 3194040,
                "sha256": "a8eab29f142a8a17d29334ac921f8a8ee0d2c0c2494b28d210c09de50694db34"
              },
              {
                "file": "lod/0_4_0_0_0-lod-10.radc",
                "bytes": 3340664,
                "sha256": "f79acaa96386bf641d0fba680c47366d29b3dfda25de72151f13d1ddceefddbd"
              },
              {
                "file": "lod/0_4_0_0_0-lod-11.radc",
                "bytes": 3365632,
                "sha256": "a8b9e5405b5d4f4f7d83e2a7b387a7f416ac354a43922672d157781bb266ea8c"
              },
              {
                "file": "lod/0_4_0_0_0-lod-12.radc",
                "bytes": 586296,
                "sha256": "2e879fdb73a9d15eec2f80edc7687abaca29804af46d51b1be9cb3dec324ade0"
              }
            ]
          }
        },
        {
          "file": "0_5_0_1_0.sog",
          "bytes": 10161477,
          "sha256": "95cf57c52149b4a0ee4f946fa4619cc3fe2a312067c2d71f53ecffc8cd7a7370",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_1_0-lod.rad",
            "bytes": 2592,
            "sha256": "569b24c03b1e2764ab290acc013c953bf6a8178693e13b73070b15fdd46905db",
            "splats": 808358,
            "chunks": [
              {
                "file": "lod/0_5_0_1_0-lod-0.radc",
                "bytes": 3141032,
                "sha256": "1b52557a5b3b088d7824cfb2c1f643ae8c191e9085f3f7fbaabecd07b13d4bd8"
              },
              {
                "file": "lod/0_5_0_1_0-lod-1.radc",
                "bytes": 3321920,
                "sha256": "50599982c8b619e2f34a099c3410220c3d957a2210e75d2c9ab96577080e0087"
              },
              {
                "file": "lod/0_5_0_1_0-lod-2.radc",
                "bytes": 3146880,
                "sha256": "4b2fed5c127e9c28fae9971dbfbfc5fb69f7d66f689dc9e3aa4e3a4eadebd971"
              },
              {
                "file": "lod/0_5_0_1_0-lod-3.radc",
                "bytes": 3007032,
                "sha256": "a171129c22cf2e3f91e570392c45d4337c5518201e19d61d905a71487acd8b5f"
              },
              {
                "file": "lod/0_5_0_1_0-lod-4.radc",
                "bytes": 3162896,
                "sha256": "43368142a07acaba0d9e3f887f44a4868a3ffab0d3de9bbf775a47ba3a326fa6"
              },
              {
                "file": "lod/0_5_0_1_0-lod-5.radc",
                "bytes": 3282904,
                "sha256": "ae14f59b4b4b422b07e0a97e4a4b28618607e5ab7195ea084382ce8ea3f08aa2"
              },
              {
                "file": "lod/0_5_0_1_0-lod-6.radc",
                "bytes": 3159616,
                "sha256": "bf60d7b00825e0f37a0c3ddf4032545ec7f57a066eca09980fa96c95cbf5c998"
              },
              {
                "file": "lod/0_5_0_1_0-lod-7.radc",
                "bytes": 3278624,
                "sha256": "2a70d7541fb384f07b6b5aa120b0cc9aa9f4d5ff683bd3a320c2d1eb39ffe6d4"
              },
              {
                "file": "lod/0_5_0_1_0-lod-8.radc",
                "bytes": 3236872,
                "sha256": "fc0d22fc257271e4d446f283acd5577ae7531fc40a169f46ebe96f2c343da555"
              },
              {
                "file": "lod/0_5_0_1_0-lod-9.radc",
                "bytes": 3040584,
                "sha256": "e2d32e937bfe9032eb7d994e7533550ae3ca45f553294ae7d5f0617d22bf2d99"
              },
              {
                "file": "lod/0_5_0_1_0-lod-10.radc",
                "bytes": 3317408,
                "sha256": "c3d2969dd1adb7b4939b8a3b56cca3cd26af27f075fc856a4c23c781f651512a"
              },
              {
                "file": "lod/0_5_0_1_0-lod-11.radc",
                "bytes": 3407400,
                "sha256": "ed86207a72482e81ac0aa733e8c41a226829472e1e6ece4832187569dc0940c1"
              },
              {
                "file": "lod/0_5_0_1_0-lod-12.radc",
                "bytes": 1026992,
                "sha256": "066f457515be8518eb3d056943d12184cae79b72c592d78a577aef76b60eb66d"
              }
            ]
          }
        },
        {
          "file": "0_7_0_1_0.sog",
          "bytes": 9438884,
          "sha256": "9942987e877c385e6e65a51331c385ac1780f40f52f8bec562463c9a09cf1c55",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_1_0-lod.rad",
            "bytes": 2496,
            "sha256": "88569d4f4cdbbdbe279d5770951348359a2e7f5e83e8abc3d896a43386f798e1",
            "splats": 747637,
            "chunks": [
              {
                "file": "lod/0_7_0_1_0-lod-0.radc",
                "bytes": 2989032,
                "sha256": "c647781ee39fdd8da1ea2d709b55a0a8c544475aee40374dfdd353328f7eab33"
              },
              {
                "file": "lod/0_7_0_1_0-lod-1.radc",
                "bytes": 2949576,
                "sha256": "85386940250a45ffc9a784a044050e6c312c9d11e850ba92ad01c59445620db4"
              },
              {
                "file": "lod/0_7_0_1_0-lod-2.radc",
                "bytes": 2794056,
                "sha256": "469ceae01a83dff982c95b6e07efc647f86e6a21b73224009d88a76b68995991"
              },
              {
                "file": "lod/0_7_0_1_0-lod-3.radc",
                "bytes": 3045560,
                "sha256": "9c81fad473a15d11439ccff9f94b2f4a6eb85d7a52b7ebca4175f92dc056042c"
              },
              {
                "file": "lod/0_7_0_1_0-lod-4.radc",
                "bytes": 3151336,
                "sha256": "ef129309b52911ef30c47273be29c7671867c9da9aaf21ea7126ae7b2d2a2bad"
              },
              {
                "file": "lod/0_7_0_1_0-lod-5.radc",
                "bytes": 3114304,
                "sha256": "c6c1c14d312862b705c1567996ff97080b5cbe93a1d51e1e1245389d2131a386"
              },
              {
                "file": "lod/0_7_0_1_0-lod-6.radc",
                "bytes": 2989256,
                "sha256": "ee6d545f34cde27567177f97abd80ab6b17780fb5e0ce72b12d8bd0815773ddb"
              },
              {
                "file": "lod/0_7_0_1_0-lod-7.radc",
                "bytes": 2805040,
                "sha256": "cffbf168d98eccf07f8263bd9e380a4d678c3b46a82c0d05e48b6a09a48eb973"
              },
              {
                "file": "lod/0_7_0_1_0-lod-8.radc",
                "bytes": 3084536,
                "sha256": "a92000f6de5d334299b2304f1c23a15404911384ddcb9e063558b14802ccc2f0"
              },
              {
                "file": "lod/0_7_0_1_0-lod-9.radc",
                "bytes": 3365584,
                "sha256": "d5b158c5b93a47328ff78d5f5dbda5daaf9e6a0316cac4834e1bf33ab1e6090d"
              },
              {
                "file": "lod/0_7_0_1_0-lod-10.radc",
                "bytes": 3194280,
                "sha256": "4df957cddf631024ea0b7da0ade1a6c4a20108cd287f2b3eda926c40f8cfaaed"
              },
              {
                "file": "lod/0_7_0_1_0-lod-11.radc",
                "bytes": 1337320,
                "sha256": "1a1131510e99d81b907a249a010cb62f06317b6332bd8a96a2c55f696a563aca"
              }
            ]
          }
        },
        {
          "file": "0_7_0_1_1.sog",
          "bytes": 3227543,
          "sha256": "bc56a8a5a1b41666b2558693791ec1cac89ddec4f84d38cd27a7f4897a8b7003",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_1_1-lod.rad",
            "bytes": 1616,
            "sha256": "05ee8adb5a18f29cb962bf0234ad63bd3003e0c4f37c2598bfd2fc16a569ec76",
            "splats": 152808,
            "chunks": [
              {
                "file": "lod/0_7_0_1_1-lod-0.radc",
                "bytes": 3148048,
                "sha256": "456e9d792a8ea3888f05cfe24618bbc8159d66b3bb23f3131c1f6974568f59af"
              },
              {
                "file": "lod/0_7_0_1_1-lod-1.radc",
                "bytes": 3614056,
                "sha256": "e837dadd5473d3ed68b6ba737794e5faf3da30c58d33025b62a53dd528f9c63c"
              },
              {
                "file": "lod/0_7_0_1_1-lod-2.radc",
                "bytes": 1171152,
                "sha256": "b26a1322d0d528dc876519d3234b26753b05e3549d741d4d7d0fc95c1b3a667a"
              }
            ]
          }
        },
        {
          "file": "env.sog",
          "bytes": 110147,
          "sha256": "18bd1da150397ce7abdb63191930f04d294f4e1248c65db5b0c8236e32f2b74e",
          "lodLevel": null,
          "isEnvironment": true,
          "lod": {
            "file": "lod/env-lod.rad",
            "bytes": 1408,
            "sha256": "ff8e2a4f0cbb9551f007ce559223a7d15060641852bf4feb2f80e941b7a8f415",
            "splats": 3803,
            "chunks": [
              {
                "file": "lod/env-lod-0.radc",
                "bytes": 181920,
                "sha256": "9b803f2cfd6b9ab2a9827c6c7825bb99407df0ae97b5c2488c5933dfc13e0599"
              }
            ]
          }
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
      "splatsByLevel": [
        345590,
        691503,
        1383761,
        2778219
      ],
      "finestLevel": 4,
      "finestLevelSplats": 2778219,
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
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_1_0_0_1-lod.rad",
            "bytes": 2592,
            "sha256": "53b1eab6abcc1f936ee43807b1bbb57c4f0a4c1f39545607dba0648355073003",
            "splats": 845013,
            "chunks": [
              {
                "file": "lod/0_1_0_0_1-lod-0.radc",
                "bytes": 3080488,
                "sha256": "51b3e42772bde8e19589396949d10473571e6aa7a32f8836ba4109dc43d36435"
              },
              {
                "file": "lod/0_1_0_0_1-lod-1.radc",
                "bytes": 3226720,
                "sha256": "08a847b4f20853666c938a59154f9e1789d27daba13f8e13897220e1e13b63d0"
              },
              {
                "file": "lod/0_1_0_0_1-lod-2.radc",
                "bytes": 3076312,
                "sha256": "c058ba4127fe6a217cd9895d56564428b1caf2aa58c335300f1e3b1088f961db"
              },
              {
                "file": "lod/0_1_0_0_1-lod-3.radc",
                "bytes": 3130960,
                "sha256": "084ad7559ac725e1cd8875f40ef1427d783b06eb0c915747b71655bda1a894ad"
              },
              {
                "file": "lod/0_1_0_0_1-lod-4.radc",
                "bytes": 3065776,
                "sha256": "d260515487688a500024fb5d695807937603a787443a9aa9417190aed707ad8f"
              },
              {
                "file": "lod/0_1_0_0_1-lod-5.radc",
                "bytes": 3034080,
                "sha256": "ea6c53aa6e3920c040166d99d18f3d0fcd32749247d07816f99167d23675a6f3"
              },
              {
                "file": "lod/0_1_0_0_1-lod-6.radc",
                "bytes": 3326472,
                "sha256": "3267e2b793102ca1ef624462d99ca7a2a434cfe28f3e77c826552764a2e02700"
              },
              {
                "file": "lod/0_1_0_0_1-lod-7.radc",
                "bytes": 3253208,
                "sha256": "eb889eb2be1a77685db4c40b9f7d005627d1e661507f7617444727b1b16b5177"
              },
              {
                "file": "lod/0_1_0_0_1-lod-8.radc",
                "bytes": 3384624,
                "sha256": "92bef0758049368569d49ef10fd476385915060bdfb041c7f4f8ac685a5acc46"
              },
              {
                "file": "lod/0_1_0_0_1-lod-9.radc",
                "bytes": 3168296,
                "sha256": "17a5bb9cb088d458c8702a4a5638d346fc89544739a2d4da3b210d6c5d709d10"
              },
              {
                "file": "lod/0_1_0_0_1-lod-10.radc",
                "bytes": 3117760,
                "sha256": "18a34a522aad7beb2eb0db942f394cf73a45db4bbe55f79a03063173e63fc85c"
              },
              {
                "file": "lod/0_1_0_0_1-lod-11.radc",
                "bytes": 3359072,
                "sha256": "65b293b5efa14a62f6de2dd1cc1ef1a2a8e7059e06e7abc3c078999ceaa9e0e7"
              },
              {
                "file": "lod/0_1_0_0_1-lod-12.radc",
                "bytes": 2971152,
                "sha256": "fec48a30b01ce55d9fa5b0f1c04e96a59e7e2443c4678a8c79f1087069f2a6c0"
              }
            ]
          }
        },
        {
          "file": "0_3_0_1_0.sog",
          "bytes": 11550736,
          "sha256": "496489e102af5f4db7dc376a29d46c44131adca8a4513cbadc242f70b93d524b",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_3_0_1_0-lod.rad",
            "bytes": 2784,
            "sha256": "b59ec48d317cac7d523c80cb9ca85335ccc6242641d43357fafb1ab04c3baf3e",
            "splats": 953506,
            "chunks": [
              {
                "file": "lod/0_3_0_1_0-lod-0.radc",
                "bytes": 3072752,
                "sha256": "bc4c8523ca1d4f47ce86107c31b4f066e1d5771e333b2dc3acca4b4488865632"
              },
              {
                "file": "lod/0_3_0_1_0-lod-1.radc",
                "bytes": 3057576,
                "sha256": "e606f373795145a8811a7c9723c2c49ba986751038965001d57b3d2945d3d863"
              },
              {
                "file": "lod/0_3_0_1_0-lod-2.radc",
                "bytes": 3100152,
                "sha256": "b509c01185d1c491edb32d0a0aaf11b0e616adee43b99966beaf52e43648ddb6"
              },
              {
                "file": "lod/0_3_0_1_0-lod-3.radc",
                "bytes": 3225272,
                "sha256": "2a36252803d635c6b5df81b1704025172cbc0d38a11b888bf2233abfc1353aef"
              },
              {
                "file": "lod/0_3_0_1_0-lod-4.radc",
                "bytes": 3122816,
                "sha256": "ebdbd2cd5702948caa65b856179ce3e6c6195de088fb0fbb0ef24eef0aa2365b"
              },
              {
                "file": "lod/0_3_0_1_0-lod-5.radc",
                "bytes": 3397072,
                "sha256": "9e4ed453a805d5534c3be65f7bb7bf05ed1797a6096fe684eab93cf8c81c3e35"
              },
              {
                "file": "lod/0_3_0_1_0-lod-6.radc",
                "bytes": 3230064,
                "sha256": "8fbfa5ab86529920eb782276b46ec1f17e9169faec00dbe78958a927ae3ddd49"
              },
              {
                "file": "lod/0_3_0_1_0-lod-7.radc",
                "bytes": 3144400,
                "sha256": "70a5ac38891889e865519a02e9de76b9ef9b3326fa3993a407c87ad1cd112e35"
              },
              {
                "file": "lod/0_3_0_1_0-lod-8.radc",
                "bytes": 3051360,
                "sha256": "58886a16abafda16ff6b78b2be29f5abcdfab7704dd1157e5a1aa5c643363d2b"
              },
              {
                "file": "lod/0_3_0_1_0-lod-9.radc",
                "bytes": 3222648,
                "sha256": "974dd3ce8966164d569598c0bb056855af6ccda0cc4981c5677e75cf38350ab2"
              },
              {
                "file": "lod/0_3_0_1_0-lod-10.radc",
                "bytes": 3402744,
                "sha256": "eed9aa106ba68c0f92dcfebdbf937ecd897558761ad9738419855928d0440f23"
              },
              {
                "file": "lod/0_3_0_1_0-lod-11.radc",
                "bytes": 3248096,
                "sha256": "e6799543498e7c0cd620dc8d5f276ab93c4b510ef6ba41e93932be247a23d00c"
              },
              {
                "file": "lod/0_3_0_1_0-lod-12.radc",
                "bytes": 3514504,
                "sha256": "a7958da5ffc35c81050858cab68695229bd6cfaca0cd1d04692676497de9dfde"
              },
              {
                "file": "lod/0_3_0_1_0-lod-13.radc",
                "bytes": 3467024,
                "sha256": "b4122a730c53449e7e744810c8749c6c6c1b05fa6313964629c4cc6ec54bdd8b"
              },
              {
                "file": "lod/0_3_0_1_0-lod-14.radc",
                "bytes": 1880920,
                "sha256": "a213010fab36f84b54485ac753e9048ffa0e70babdd316796075552242cb74c6"
              }
            ]
          }
        },
        {
          "file": "0_5_0_0_0.sog",
          "bytes": 10061959,
          "sha256": "f9e3498f7cdc5367a1459c7d8a97f41adc34a8a01df311cb28b652677ab5ac64",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_0_0-lod.rad",
            "bytes": 2592,
            "sha256": "287efc6479e89064cf38f0303ce7f4664fee63f3379fbfd3dbbbc5c13bb884f2",
            "splats": 825893,
            "chunks": [
              {
                "file": "lod/0_5_0_0_0-lod-0.radc",
                "bytes": 3320168,
                "sha256": "3259e08802ab867d2f2791e1f3c0ef8f91b133bc92a6325202758e7a998c5cec"
              },
              {
                "file": "lod/0_5_0_0_0-lod-1.radc",
                "bytes": 3248656,
                "sha256": "2b89f056f180f2e1be63e46d8ab458b31d0e8d9989adf58c2517a7a2785c0ccd"
              },
              {
                "file": "lod/0_5_0_0_0-lod-2.radc",
                "bytes": 3132616,
                "sha256": "0c339b53dd98f3f0db71d8be151983cfac08bfc446511540257e6c2af6cde720"
              },
              {
                "file": "lod/0_5_0_0_0-lod-3.radc",
                "bytes": 3114032,
                "sha256": "5d4b2239c08575cd185c0ea0dbdc422729caabafca942286c4e9557be008bfb9"
              },
              {
                "file": "lod/0_5_0_0_0-lod-4.radc",
                "bytes": 3432112,
                "sha256": "aa5eb0d8a6d1c94ae1619004fd1677a35efff1372d5460a7697008fee38f9bf7"
              },
              {
                "file": "lod/0_5_0_0_0-lod-5.radc",
                "bytes": 3229696,
                "sha256": "1729a414c8204c1ef7222d6842c14c76a7ed93e1c9d0f74ebb755e1dea4c5e7c"
              },
              {
                "file": "lod/0_5_0_0_0-lod-6.radc",
                "bytes": 3303912,
                "sha256": "af2a81b85bfd9515d3165e57effc3203cdf9e8f863a62995c405962c3e3dc779"
              },
              {
                "file": "lod/0_5_0_0_0-lod-7.radc",
                "bytes": 3237136,
                "sha256": "9954af0d6176b31ed5041507801328f5c7702b7c893a4cc0c53b1386963b643d"
              },
              {
                "file": "lod/0_5_0_0_0-lod-8.radc",
                "bytes": 3239808,
                "sha256": "ce43dcc5cbd11abd1a94c4b2210566f6f9c2c9bb0b4c026b45fa6aec73937497"
              },
              {
                "file": "lod/0_5_0_0_0-lod-9.radc",
                "bytes": 3337408,
                "sha256": "b5f30af16b7a5a4c64f6693be3d959fa47a5a65057a2cabffaefc05a2b559bc7"
              },
              {
                "file": "lod/0_5_0_0_0-lod-10.radc",
                "bytes": 3413168,
                "sha256": "a4984c58b020b8a13b10821fa8d2f4aecd6444aec0d564a133b0de1769ef1e42"
              },
              {
                "file": "lod/0_5_0_0_0-lod-11.radc",
                "bytes": 3346256,
                "sha256": "6dd1272616033992dbd04d6e9f19cf06a1dca96132fb169a9ce4cdd7592a236e"
              },
              {
                "file": "lod/0_5_0_0_0-lod-12.radc",
                "bytes": 1971296,
                "sha256": "b509a650c3c17668940b87e503bd507057a9b0426502e4be35892516748cf8a7"
              }
            ]
          }
        },
        {
          "file": "0_6_0_1_0.sog",
          "bytes": 9426298,
          "sha256": "abcc1493668db3c9e01cd8ee6b7c164ef6ef8ed652ec745e3c3dfb2d1c004f4a",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_6_0_1_0-lod.rad",
            "bytes": 2496,
            "sha256": "56c1796d991d61783251813306af541ce42f4d00971e838837698ec161508749",
            "splats": 750557,
            "chunks": [
              {
                "file": "lod/0_6_0_1_0-lod-0.radc",
                "bytes": 3249008,
                "sha256": "91abd794028a0617c53aa24ac4b3be01d0c6e069b5e0bc3365fd0b15f9129d28"
              },
              {
                "file": "lod/0_6_0_1_0-lod-1.radc",
                "bytes": 3130112,
                "sha256": "6310de65994b36a418049aceab7f5fb2f633751fc738f140e35ca6bebb67c29e"
              },
              {
                "file": "lod/0_6_0_1_0-lod-2.radc",
                "bytes": 3163576,
                "sha256": "85a8fd214b202f878bb9f433abb16b9d9a5b87f81d6063c79aad8d84bc3f3101"
              },
              {
                "file": "lod/0_6_0_1_0-lod-3.radc",
                "bytes": 3383208,
                "sha256": "fa2a9356fffcb9aa0f6f73c54c2ea8f12de5c7bbb86c78b09568e7e86ba322f2"
              },
              {
                "file": "lod/0_6_0_1_0-lod-4.radc",
                "bytes": 3084192,
                "sha256": "7083d0bf930985c203fb7dd862af87832572963549002da7f82ece7a94337b91"
              },
              {
                "file": "lod/0_6_0_1_0-lod-5.radc",
                "bytes": 3199344,
                "sha256": "89503e5602db026f7714b8c83207ce4a5c27a3cc6651a8c3e3c03d335f911775"
              },
              {
                "file": "lod/0_6_0_1_0-lod-6.radc",
                "bytes": 3097776,
                "sha256": "42871cccfe3dbb29ef1612c7790b8b01bbeb31cb4b0fecd2c3e31b7c080a795c"
              },
              {
                "file": "lod/0_6_0_1_0-lod-7.radc",
                "bytes": 3287552,
                "sha256": "8b573eea0aadab6cee564dcce778e0f6c917609e230b91f68e1f02a7168272e3"
              },
              {
                "file": "lod/0_6_0_1_0-lod-8.radc",
                "bytes": 3254064,
                "sha256": "f4d9bfe98ce57d5bd8bd52ff6dbc0c1ed4a3ce20f8902f8be2ce50ba8f4256b4"
              },
              {
                "file": "lod/0_6_0_1_0-lod-9.radc",
                "bytes": 3308064,
                "sha256": "152070f042c97e82bb6ce2833ed869ef668fb0f71f12a36c66cb53a7fa18147a"
              },
              {
                "file": "lod/0_6_0_1_0-lod-10.radc",
                "bytes": 3336624,
                "sha256": "ff7228c884d6f1131e2ea3bd3781c346b0c917cbb2a66f77892893aa0ec51b9d"
              },
              {
                "file": "lod/0_6_0_1_0-lod-11.radc",
                "bytes": 1451568,
                "sha256": "cff13935f1ebdaa418c32fabf6f041510a3cc3d0e956e368c04dffb72b964dd9"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_0.sog",
          "bytes": 7163770,
          "sha256": "23e73ec8779ac4c3a2f1f12b0f24f78b14f7e164a5dcbcb727e93f385f74d7e4",
          "lodLevel": 4,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_0-lod.rad",
            "bytes": 2200,
            "sha256": "d5864b61a0a02f9a17b1436841e83383231dfb94809b8a4cea128cafb0b5c388",
            "splats": 528946,
            "chunks": [
              {
                "file": "lod/0_7_0_0_0-lod-0.radc",
                "bytes": 3293640,
                "sha256": "8be3a44cce6fbe51408019a0941564545c2b1bbad8086b5dfeee6a67a1858109"
              },
              {
                "file": "lod/0_7_0_0_0-lod-1.radc",
                "bytes": 3189408,
                "sha256": "49efa45f5c9b57d7cc6187e0c4a8eec0cf412b67bcba7a4f0889b08f4156ee08"
              },
              {
                "file": "lod/0_7_0_0_0-lod-2.radc",
                "bytes": 3188080,
                "sha256": "3ff9f3f0bdcdb0db143b54d6c71225eadff8f95b573dd8b0c3f6000483e7ab6c"
              },
              {
                "file": "lod/0_7_0_0_0-lod-3.radc",
                "bytes": 3320384,
                "sha256": "d86701615c646e033440c4a3f9008cbff8760185ab25323165d2f4ec7641ae08"
              },
              {
                "file": "lod/0_7_0_0_0-lod-4.radc",
                "bytes": 3273040,
                "sha256": "2fe111127e9c1eeb451e3386424faba6257bfd97668867167ea481cf52e6f48b"
              },
              {
                "file": "lod/0_7_0_0_0-lod-5.radc",
                "bytes": 3353968,
                "sha256": "04f4265e8253118258392b6d57831e476a4dc81c6b699695234e0a91542c8585"
              },
              {
                "file": "lod/0_7_0_0_0-lod-6.radc",
                "bytes": 3285944,
                "sha256": "b73577dcd6a60382d4278ac1fc7a5ea41eee1505d3bb15bc3e0ba3a51078101a"
              },
              {
                "file": "lod/0_7_0_0_0-lod-7.radc",
                "bytes": 3298744,
                "sha256": "2341162553c2eb2e6e7c3d2deab22c51577719440257819704e4bc51d92dfb75"
              },
              {
                "file": "lod/0_7_0_0_0-lod-8.radc",
                "bytes": 226848,
                "sha256": "e58c34829ed86b334fbe9b6e0aa8ab7852b953974a9029b72e06b7793ff4e87d"
              }
            ]
          }
        },
        {
          "file": "env.sog",
          "bytes": 115576,
          "sha256": "c820be095251b34fca4016ef6944b63d29cb8048079a7274663f6ffbc38cfa1d",
          "lodLevel": null,
          "isEnvironment": true,
          "lod": {
            "file": "lod/env-lod.rad",
            "bytes": 1408,
            "sha256": "f96a4c2bdb45732be9bac0f968e4b220ec77b2e2663ce37e7631fdcf8bec9ccc",
            "splats": 4277,
            "chunks": [
              {
                "file": "lod/env-lod-0.radc",
                "bytes": 207832,
                "sha256": "51920d439b636424ad6b3a5e37ca522d14ec4fbfb1ab543efd11fd7b4c684133"
              }
            ]
          }
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
        3.4443495000000004,
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
      "alignmentConfidence": "confident",
      "alignmentNote": "Derived from scan_output_1_south: floor from the room mesh, room from the scanner's own walk. No published dimensions for this room; derived extent stands unchecked."
    },
    {
      "roomSlug": "deacon-conveners-room",
      "captureDir": "scan_output_1_DC",
      "splatType": ".sog",
      "totalSplats": 7948346,
      "totalLevels": 5,
      "splatsByLevel": [
        254937,
        510435,
        1022179,
        2046576,
        4114219
      ],
      "finestLevel": 5,
      "finestLevelSplats": 4114219,
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
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_1_0_0_0_0-lod.rad",
            "bytes": 2920,
            "sha256": "5457281e3e47dfaaade0b454f1fe5e9289335095533baf85eb132a7b8e6f1610",
            "splats": 995139,
            "chunks": [
              {
                "file": "lod/0_1_0_0_0_0-lod-0.radc",
                "bytes": 3229920,
                "sha256": "3146c848e9da0b7de63779bbfe713b017072669636eab125916326db9ce29f8b"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-1.radc",
                "bytes": 3240224,
                "sha256": "c3d309a6409db9c4e514265b20fd41f5dfea72f92f6e70abfdc813c46cd0f360"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-2.radc",
                "bytes": 3259424,
                "sha256": "d136dcab6defc88216c5c79c12888b2133a0db7fcc86d4d35f9c58fcb37f76b8"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-3.radc",
                "bytes": 3250216,
                "sha256": "0995d8301d33019675566e5d281431bbaf44ecf44b3562753f68eba99cb8f66e"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-4.radc",
                "bytes": 3285528,
                "sha256": "82cb0cd27aceb1c0318a0ed23d18aaf07c5fef684ebb7c435290dabea05ad60c"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-5.radc",
                "bytes": 3306032,
                "sha256": "18c24a4cae5211f13db4385dc3d490f74d85c9b75a7f1ed80beb489702ebb7cf"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-6.radc",
                "bytes": 3131112,
                "sha256": "603be8518d00c49d9aaf841f738e80e45b6ead4fda6bd12de10f7e3d88ff1eb1"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-7.radc",
                "bytes": 3302248,
                "sha256": "94034ffdd75de5b03a80670c7ac576e4fc06d794e8d293a6295eb26488e435f5"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-8.radc",
                "bytes": 3199776,
                "sha256": "db6acdb1c863ea4d8ca3527910cc6daf7a0bc1097bd0962a7cd49e834e69be19"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-9.radc",
                "bytes": 3352992,
                "sha256": "8c764e387c1c3fbe8f203b539219df8d8a2da20ad219dc176366c31c116542cd"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-10.radc",
                "bytes": 3371192,
                "sha256": "1a4ec74662b3033537b16f4fc61731ad408a4b07eb09f9684fb336b902196dae"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-11.radc",
                "bytes": 3322576,
                "sha256": "802ddd3ae96d15868da5784fe0bc9b94be9edcd8eef77ace70fe6d088d36279a"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-12.radc",
                "bytes": 3362104,
                "sha256": "e357f01e3582bd631efa9e9c505bbf65bdff3b864355769a3ae01b63aa7dbca8"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-13.radc",
                "bytes": 3291352,
                "sha256": "bffa5e9e8aca58a9b4318dd4ab381c646aa4f310a35affb22bc108e2ff68e649"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-14.radc",
                "bytes": 3441008,
                "sha256": "1ce76c31079e4611557be307e9e874596b567664a978118a3e18ff0181c680f8"
              },
              {
                "file": "lod/0_1_0_0_0_0-lod-15.radc",
                "bytes": 622312,
                "sha256": "ead1a2ef98cc73069b033749bd05a75634086630702038b3e92f97b4f01c9e8f"
              }
            ]
          }
        },
        {
          "file": "0_2_0_0_0_1.sog",
          "bytes": 9237677,
          "sha256": "a77df3473b7a4e627d1446806d8ccade5819a34f7031197a13382866838c58cb",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_2_0_0_0_1-lod.rad",
            "bytes": 2416,
            "sha256": "0a0f4a99d1702c0dfd20aac3eda82b0e6416054986df76b6d163c23087758066",
            "splats": 716752,
            "chunks": [
              {
                "file": "lod/0_2_0_0_0_1-lod-0.radc",
                "bytes": 3276528,
                "sha256": "84bf3edb4bf3bdf4e6aa58adbb4fdd272736ca0a896fc72fd2c56354c37c177e"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-1.radc",
                "bytes": 3285344,
                "sha256": "aa201194f78fd9f8eae47173a9a8f59d8fee1610538822f6f99fa456421392a3"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-2.radc",
                "bytes": 3343576,
                "sha256": "22fb41a8282f138af1da77081bd208febc643d55a54cfb144232d5bb1e6560f5"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-3.radc",
                "bytes": 3275120,
                "sha256": "980047103e7f55d7195a0ccf54fc841f22b54b595d40111bd80efa45984b0098"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-4.radc",
                "bytes": 3341728,
                "sha256": "7117748704aebac33deb18c0ffd311370604b79a70942b96823c59f7fa5af911"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-5.radc",
                "bytes": 3365040,
                "sha256": "14fd9956f19f49c5e3a5f96775e3a45c2ec1659b4259b798101e1e1ec51c422f"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-6.radc",
                "bytes": 3407624,
                "sha256": "427f677ae7522674a220a0dfed5a77aa24266e7834b93f352dd3700ba867930c"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-7.radc",
                "bytes": 3342440,
                "sha256": "7661bd8d0472de194b142fe03ceab3eaf4b03539dff09470a6a94073bdc2e1ec"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-8.radc",
                "bytes": 3377128,
                "sha256": "0fbf18406c755c8729152e0497fd509c7a42e2d4a24c5c8774246f42a84f7087"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-9.radc",
                "bytes": 3381304,
                "sha256": "3a8d755cb0191a9812ec8522f30bab8134e59c7bb8ad60e6245b32a9c7a32c89"
              },
              {
                "file": "lod/0_2_0_0_0_1-lod-10.radc",
                "bytes": 3199616,
                "sha256": "f744aaa2163da227e82d15f3d344375f906b362ed5427408fc81d43bedad5100"
              }
            ]
          }
        },
        {
          "file": "0_3_0_0_0_1.sog",
          "bytes": 10185247,
          "sha256": "faef9aa939ddbcf18a5b97c78ee7b2a3d380211f9632a21d7925892664743c87",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_3_0_0_0_1-lod.rad",
            "bytes": 2520,
            "sha256": "6ebbd2c50a5f8f3b1df37dd3c9a33dfb7b45befd2098eb840ff45e348a8184d7",
            "splats": 785117,
            "chunks": [
              {
                "file": "lod/0_3_0_0_0_1-lod-0.radc",
                "bytes": 3281192,
                "sha256": "777f0c0d8279ff8570ad32cc3b5434db38ad6de08ab43661226264107c7eac08"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-1.radc",
                "bytes": 3336736,
                "sha256": "c3bcdf98e6174881bc72ee26ed6892f2f144bff8f67f3c0a9ac9d15145512a40"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-2.radc",
                "bytes": 3135616,
                "sha256": "e9bbb64b2783a995888eb4b4faaedddf0ddb4b4879f89e3fc72879c8d39cc47c"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-3.radc",
                "bytes": 3201344,
                "sha256": "20bfee82a5ec3d0ff6d891d2c2811409ed07995f74100365fb289cf2054f54d6"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-4.radc",
                "bytes": 3408536,
                "sha256": "3a141358c77c93696e9e6d48c5217d9624d98820b2aa1dc38fdf8cdadede92dd"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-5.radc",
                "bytes": 3243848,
                "sha256": "7562698b1d3c5aae9012035c6667ce03abe1ef226c081af746dd3d082f3dfe05"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-6.radc",
                "bytes": 3349864,
                "sha256": "747426de23a53b5648a67f4cd5565f64f57739f0204c7d388d31c30b4ab3075c"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-7.radc",
                "bytes": 3305176,
                "sha256": "ae8113ba0f68f0146d58423ed4e52443b72b1ab5e88ecd12a8611b3fd27efd34"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-8.radc",
                "bytes": 3322032,
                "sha256": "256d9f151b85680c2ff0e60c38dccad07cdd7618cf06e80a476c8e96649a8969"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-9.radc",
                "bytes": 3444240,
                "sha256": "ae4e8b2044c53d911cef59498d4137916fb84fde780aae420336fbed8a760d6a"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-10.radc",
                "bytes": 3472504,
                "sha256": "acf55bd5310b57804487d1ff9291ad658612286fa5031fa47d9e3e6d6a6f0c7f"
              },
              {
                "file": "lod/0_3_0_0_0_1-lod-11.radc",
                "bytes": 3339288,
                "sha256": "d7200857a7db3bfc014d3b824a9f043034b4ea2e2b5150b3bdb334c727adee23"
              }
            ]
          }
        },
        {
          "file": "0_4_0_0_0_1.sog",
          "bytes": 9922426,
          "sha256": "bd1a3daf04a0770bcb48d5ccd2376a8e20b05a4ddd6f19a4e177d315cc1c7661",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_4_0_0_0_1-lod.rad",
            "bytes": 2520,
            "sha256": "6d590a8f8c706dfd565aee902d0add68fa3dc96d3e2d6a10f0f37aded93fabf0",
            "splats": 765119,
            "chunks": [
              {
                "file": "lod/0_4_0_0_0_1-lod-0.radc",
                "bytes": 3272560,
                "sha256": "fbcc52c2f07cc7f0a2d27b6484b82a3cc3d18435b0ca6bf37afec9607a5802d5"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-1.radc",
                "bytes": 3331048,
                "sha256": "e3b1d5feb9562730868aa84b47db99be15a61ff14e3cefc422df8aa5f75edb75"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-2.radc",
                "bytes": 3347056,
                "sha256": "063e03edd521126c5c4868a3f9cbcc7f5a5065444476922c40b221396a7d4521"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-3.radc",
                "bytes": 3216120,
                "sha256": "a0ed2906fd0c87268287ec5ee57439c6c6ab7dc870bc0e37ac71a38ba40d78d8"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-4.radc",
                "bytes": 3444712,
                "sha256": "65333236fb8e08d6bff3a2978d1a446d4311bbfc6b9c996ca6d43aa02ed46706"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-5.radc",
                "bytes": 3444544,
                "sha256": "d26ac92dc9af2f31a47b64baf8f7ec0435500e61239f3e3bee5d2acd814b7134"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-6.radc",
                "bytes": 3480992,
                "sha256": "1e4b5c556852bdc6061b999734f2f0b6e5c731ccf1542f6aafd1fd6636d4fec4"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-7.radc",
                "bytes": 3345200,
                "sha256": "6710609e77d57b770d47f0c88ae64056de18478a429698253e8586dd5e36a1ed"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-8.radc",
                "bytes": 3351704,
                "sha256": "4ed0846c45983bed9d951fc95bb0c40b9f19e870c88d28d902b82da48d940f7b"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-9.radc",
                "bytes": 3283024,
                "sha256": "8a68ca2a38d37c7b72f5484827f66e3d707b01382e45fdc66c3bc737aac94804"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-10.radc",
                "bytes": 3360352,
                "sha256": "872a8398447028ba05230b4bb5b96dfafc4d420396020693a603868c71fde2bc"
              },
              {
                "file": "lod/0_4_0_0_0_1-lod-11.radc",
                "bytes": 2366776,
                "sha256": "efd7e2c2248388190a3addb55b6e41a776f105f00dbe1987f21ebc3f89c4845b"
              }
            ]
          }
        },
        {
          "file": "0_5_0_0_0_0.sog",
          "bytes": 9144672,
          "sha256": "cf325908875bd4401f73dfb2c2c951b341a10e93002e5e7742a5de005623cb11",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_5_0_0_0_0-lod.rad",
            "bytes": 2416,
            "sha256": "888d8be246b2bc52d4c41cab3e1c183563deda05fcf4a9c50f76bb58fc624edd",
            "splats": 698088,
            "chunks": [
              {
                "file": "lod/0_5_0_0_0_0-lod-0.radc",
                "bytes": 3360320,
                "sha256": "d4136975ad2bb157f7ae5283a7fc66e61a4684d7c9b491957441cd529351ffd4"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-1.radc",
                "bytes": 3392416,
                "sha256": "1959e5892f6a4af0284aca6df8eed93ba8b5ce7cbd25c0fb53005b5c400dbd6a"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-2.radc",
                "bytes": 3432904,
                "sha256": "ec6bd5ad3792f2a5a55e198b93553f32bf47804d0995b06a073d04bad4659929"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-3.radc",
                "bytes": 3474832,
                "sha256": "52aba8df872a80baf4007728a56bfbbd12e306769df6417280a1eb9975825a30"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-4.radc",
                "bytes": 3460856,
                "sha256": "3de47717e1f73303a05822b1769be71b68b9d005e494f26dc3a00747420e3651"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-5.radc",
                "bytes": 3293616,
                "sha256": "60abc43546602ac0a2e00c612e0189dbdef103c17836554c799ea45502880a13"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-6.radc",
                "bytes": 3433720,
                "sha256": "6ed4c1b6df792d5750683b334bf2a82ce355f963f2a58e443da89310f1b87625"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-7.radc",
                "bytes": 3468424,
                "sha256": "912160ec0c5c08aebb39dff4d8390e7820615c953fb635c5eb2990d11dfb9be4"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-8.radc",
                "bytes": 3510304,
                "sha256": "8c2239b4697bcae5d5b975885d58124aac8298f18c2c0e693477e304773af35d"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-9.radc",
                "bytes": 3513392,
                "sha256": "4d59b095039a156cde8c992c181f4e681dc693b7462fdf557d05bc0381a3b243"
              },
              {
                "file": "lod/0_5_0_0_0_0-lod-10.radc",
                "bytes": 2287344,
                "sha256": "f5cda468b22961163dd90df90f1635ffbcd99d7f4dd4aa2503b7378b4636a922"
              }
            ]
          }
        },
        {
          "file": "0_6_0_0_0_0.sog",
          "bytes": 10521268,
          "sha256": "00118884a59b2b4f112057e22afe3c9e299d4abddef40e8e3475825963a2af57",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_6_0_0_0_0-lod.rad",
            "bytes": 2616,
            "sha256": "14db3997deb8a0b5b916371ee33234d68876e45d6f6600169d35ab7679a7688e",
            "splats": 837279,
            "chunks": [
              {
                "file": "lod/0_6_0_0_0_0-lod-0.radc",
                "bytes": 3300600,
                "sha256": "885e6a9baae6d0a14b4e7838dbb0ca6da210929bb94c7afe46a46d49934a09c6"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-1.radc",
                "bytes": 3387120,
                "sha256": "fde6ca4be0c1335ba22bd90e2485aeca17d304e71dd1404644a0e2b2fa9abc86"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-2.radc",
                "bytes": 3187568,
                "sha256": "0561fa674a180a360a0678e56182a56a5d3397f8b5e6bcbc65f25197ec9db656"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-3.radc",
                "bytes": 3298392,
                "sha256": "16066854a72f1ca43d526fc7fccda7e39b9ad3164256a2e616cea4837443376b"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-4.radc",
                "bytes": 3452720,
                "sha256": "f2fbfcb17107cfcceee54a335a52db6297d1e8e2bc00b87d59862bc7033b01b6"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-5.radc",
                "bytes": 3431392,
                "sha256": "b968d647b44f23672248373a36fe7014375d093489b16c66117be73ec08cb1e0"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-6.radc",
                "bytes": 3501728,
                "sha256": "cb1b676b6a6ae75ba7c45f1d5dfe202a624ae70ad5c150be049566898c087a87"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-7.radc",
                "bytes": 3126952,
                "sha256": "ff22904f457000555d66f1030c7979c3b14b30ee1a2ddbcff04827a7cebc6f2b"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-8.radc",
                "bytes": 3228480,
                "sha256": "bbbb4af26dc591a972811d9046b83d3656366aed55ef879a0303c1e52089d7d0"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-9.radc",
                "bytes": 3294064,
                "sha256": "e1d0db44324870ef861a6406d4b98abdf45ae71c950d3d3ae592ee67bc1be3dc"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-10.radc",
                "bytes": 3541416,
                "sha256": "35b77362b70781af455700fd350565f9c24ec0cd7fcf309bc9ca4fbf0d430fbf"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-11.radc",
                "bytes": 3398560,
                "sha256": "1de62b8bb2a7d6c9fd82c605ac8d3b62611b879c9088b2329084cdfccf4d7c10"
              },
              {
                "file": "lod/0_6_0_0_0_0-lod-12.radc",
                "bytes": 2685192,
                "sha256": "ab282a4910348e8aa58223a97663212785c76cff290c63ff9c78f69a011f44ca"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_1_0.sog",
          "bytes": 10010896,
          "sha256": "099446e515d1e440233d082b5dc9973eda15e317e18b1641f942244d63f5918c",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_1_0-lod.rad",
            "bytes": 2520,
            "sha256": "171c05ef00abd879e1d64aaacc020ab2254bb4c63feec59f2f896ff675529a8c",
            "splats": 759594,
            "chunks": [
              {
                "file": "lod/0_7_0_0_1_0-lod-0.radc",
                "bytes": 3235600,
                "sha256": "4625e0414262b6db63d0babe71f4e7cc5209b4598e407911ed88144d19f4ddfc"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-1.radc",
                "bytes": 3164504,
                "sha256": "cbbaf5fd92458e7eac788fe08a82ee9916de375b59c636716e7d737a73b6328c"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-2.radc",
                "bytes": 3108960,
                "sha256": "64614e008ba74ef6d4477484b540cf4004b0fc39bc4d6362808bf4a538130a9c"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-3.radc",
                "bytes": 3220264,
                "sha256": "38912d780900c6eed1fed3f28183fd2a64e48f26a643e3df98dad36fd381e90a"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-4.radc",
                "bytes": 3354136,
                "sha256": "0f5253795630fe6be9cd4d6500ebbc8bc9ed1ec198b0b7e0ae647c48fd00d5e3"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-5.radc",
                "bytes": 3432600,
                "sha256": "7e485f0cb53cc2b6a4fdd0d4298fc0d1651322ba5e33b7817cc7f2700da6e741"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-6.radc",
                "bytes": 3356112,
                "sha256": "bbede0da209eef490a7eeeabf8802f2e085bb75bca00e77f91f50723e043346f"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-7.radc",
                "bytes": 3188568,
                "sha256": "6f5292b6c4687fca3a931fff1da71ccbae777beb95479c921ab322102fa7a7b2"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-8.radc",
                "bytes": 3162184,
                "sha256": "e66e91c4bd24f906c5fc381f47783a150eaba7c88bec8d353c36c29e85780edd"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-9.radc",
                "bytes": 3210480,
                "sha256": "1b95bbff00b8182b757c57ff51f448c744698330f6f680306c8d952c6582b35f"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-10.radc",
                "bytes": 3353088,
                "sha256": "26200ab13b5818cb045eb4c9039ca17d8e63bb7dfbff7554c319f09d32762e72"
              },
              {
                "file": "lod/0_7_0_0_1_0-lod-11.radc",
                "bytes": 2028664,
                "sha256": "7eaf8720d16699f548cea0f9a96825eab54eea5bc4b4794f7b8cb7011e6bc1c3"
              }
            ]
          }
        },
        {
          "file": "0_7_0_0_1_1.sog",
          "bytes": 3743383,
          "sha256": "b48b2eb1770c41bd77e48446ec1e447ad003f46571332a235f8cb484d7b66eb7",
          "lodLevel": 5,
          "isEnvironment": false,
          "lod": {
            "file": "lod/0_7_0_0_1_1-lod.rad",
            "bytes": 1632,
            "sha256": "c3dfb703df9419aaadea2084a13e32047327438e266eafee6c1d11b3aa2d49ae",
            "splats": 175878,
            "chunks": [
              {
                "file": "lod/0_7_0_0_1_1-lod-0.radc",
                "bytes": 3246312,
                "sha256": "cbca556d006998fb79974b155531c29c9398aea4ac462d9f9c311730ec6950ec"
              },
              {
                "file": "lod/0_7_0_0_1_1-lod-1.radc",
                "bytes": 3379568,
                "sha256": "b3ecfd32ae515470f31403692d9ba9abdee72b643d9abe2059a08afaf5fc3e9d"
              },
              {
                "file": "lod/0_7_0_0_1_1-lod-2.radc",
                "bytes": 2354496,
                "sha256": "4f75e2dd2492b668c687ef6f4295adc1c3fb520bd70768acc8a6b0cf44b9fb26"
              }
            ]
          }
        },
        {
          "file": "env.sog",
          "bytes": 112555,
          "sha256": "617f1fcc3a6fe60eb4c11b38093e3bf40fc0a7fe9bffa20a3edc65418d7b52db",
          "lodLevel": null,
          "isEnvironment": true,
          "lod": {
            "file": "lod/env-lod.rad",
            "bytes": 1408,
            "sha256": "97e11dd3c48304fbb0c490a47ed1e62a2cb1d9afa0e67e516bb56e46a5fb67ab",
            "splats": 3546,
            "chunks": [
              {
                "file": "lod/env-lod-0.radc",
                "bytes": 183032,
                "sha256": "6c0c79565ba885f68726562bd2c043d754fa2722a15594c639757e351faf2dc0"
              }
            ]
          }
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
