# OmniTwin Foundry technology and licence matrix

**Research cutoff:** 2026-07-14

**Purpose:** commercial-risk screen, not legal advice.

“Permissive” does not clear patents, optional dependencies, checkpoints, training data, captured-content rights, privacy or service terms. Production approval is for an exact version/image/checkpoint/dependency closure, not a project name.

## Decision policy

| Decision | Meaning |
|---|---|
| Candidate | commercially plausible; exact-build review still required |
| Conditional | obligations or model/data/source rights require a documented gate |
| External tool | may be invoked separately; do not link/bundle without compliance decision |
| Research only | may support an internal experiment only |
| Reject default | do not put in a closed commercial product without separate terms |

## Rights layers

Treat each layer as a separate production gate. A permissive row in one column does not clear another column.

| Layer | Required evidence |
|---|---|
| Code | exact source/release/commit, licence, NOTICE/source and redistribution obligations |
| Model/checkpoint | exact digest and model-card terms; a permissive framework licence does not clear weights |
| Training/evaluation data | dataset licence, consent, provenance and allowed purposes, including retraining and derivative-model restrictions |
| Captured/source input | customer ownership/authority, vendor/service terms, privacy/biometric rights and allowed transformations |
| Output | code licences usually do not allocate trained/exported-output ownership, but model, dataset, input, contract and privacy terms can; format conversion never cleanses upstream restrictions |
| Dependencies and patents | complete binary/plugin closure plus a separate patent/FTO decision; Apache-2.0 grants only contributor-controlled claims, while MIT/BSD generally include no express patent grant |

## Geometry, SLAM and registration

| Component | Primary source | Code licence | Weights/data/dependencies | Posture | Decision |
|---|---|---|---|---|---|
| libE57Format | [official repo](https://github.com/asmaloney/libE57Format) | Boost Software License 1.0 | source E57 rights separate | permissive | Candidate E57 core |
| PDAL | [official repo](https://github.com/PDAL/PDAL) | BSD-style | plugins/build dependencies vary | permissive core | Candidate point I/O |
| Open3D | [official repo](https://github.com/isl-org/Open3D) | MIT | optional ML models vary | permissive core | Candidate ICP/TSDF/QA |
| PCL | [official repo](https://github.com/PointCloudLibrary/pcl) | BSD-3-Clause | dependency closure varies | permissive | Candidate algorithms |
| PoissonRecon | [official repo](https://github.com/mkazhdan/PoissonRecon) | MIT | no required weights | permissive | Candidate deterministic mesh |
| KISS-ICP | [official repo](https://github.com/PRBonn/kiss-icp) | MIT | no required weights | permissive | Candidate LiDAR odometry |
| LIO-SAM | [official repo](https://github.com/TixiaoShan/LIO-SAM) | BSD-3-Clause | ROS/toolchain | permissive, integration-heavy | Candidate LiDAR-inertial baseline |
| RTAB-Map | [official repo](https://github.com/introlab/rtabmap) | BSD-style | optional models/deps vary | generally permissive | Conditional multimodal candidate |
| Kimera-VIO | [official repo](https://github.com/MIT-SPARK/Kimera-VIO) | BSD-2-Clause | older environment assumptions | permissive | Benchmark |
| GTSAM | [official repo](https://github.com/borglab/gtsam) | BSD-style | dependency review | permissive | Candidate factor graph |
| Cartographer | [official repo](https://github.com/cartographer-project/cartographer) | Apache-2.0 | maintenance status risk | permissive | Reference, not greenfield default |
| Basalt | [official repo](https://github.com/VladyslavUsenko/basalt) | BSD-3-Clause | third-party deps | permissive core | Conditional calibration/VIO benchmark |
| Kalibr | [official repo](https://github.com/ethz-asl/kalibr) | BSD with advertising clause | ROS/toolchain; calibration targets | obligation-bearing | Conditional external calibration tool |
| ORB-SLAM3 | [official repo](https://github.com/UZ-SLAMLab/ORB_SLAM3) | GPL-3.0; commercial licensing advertised | vocabulary/assets inspect separately | closed-product conflict | Reject default / buy licence |
| OpenVINS | [official repo](https://github.com/rpng/open_vins) | GPL-3.0 | no required learned weights | closed-product conflict | Reject default |
| ScaRF-SLAM | [official repo](https://github.com/ori-drs/ScaRF-SLAM) and [official group page](https://ori-drs.github.io/) | GPL-3.0; no release; created 2026-05-29 and active through 2026-07-11 | OpenVINS/ORB-SLAM, Depth Anything v3, datasets and checkpoints require separate review | research-stage; GPL permits commerce but creates copyleft obligations on distribution | Research only / reject proprietary bundled integration absent a compliant architecture or commercial licence |
| VINS-Fusion | [official repo](https://github.com/HKUST-Aerial-Robotics/VINS-Fusion) | GPL-3.0 | dependencies | closed-product conflict | Reject default |
| FAST-LIO | [official repo](https://github.com/hku-mars/FAST_LIO) | GPL-2.0; commercial contact | per-point timing/calibration essential | closed-product conflict | Reject default / license |
| COLMAP 4.1.0 | [official repo](https://github.com/colmap/colmap), [COPYING](https://github.com/colmap/colmap/blob/main/COPYING.txt) and [changelog](https://github.com/colmap/colmap/blob/main/CHANGELOG.rst) | new-BSD core; v4.1.0 released 2026-06-26 at tag target `fa8e3b3ff591552855f8ad2806723c80f963f69c`; moving main was `6e706e3bc1dbebccff13aeec488dde52005707c7` on 2026-07-14 | COPYING expressly says dependencies are separately licensed and can affect the resulting build; source-photo/capture rights govern outputs | active strong candidate; includes the global mapper | Candidate SfM/MVS core after exact release/build-closure and input-rights review; do not substitute moving main for the reviewed release |
| GLOMAP 1.2.0 | [official repo](https://github.com/colmap/glomap) | BSD-3-Clause; v1.2.0 released 2025-10-31 | archived 2026-03-09, deprecated/unmaintained and migrated into COLMAP | permissive but obsolete standalone | Reject as a new standalone dependency; use COLMAP global mapper |
| hloc | [official repo](https://github.com/cvg/Hierarchical-Localization) | Apache-2.0 core; latest tagged v1.4, active through 2025-12-10 | extractors, matchers, submodules and checkpoints differ; source-image rights remain separate | conditional | Curated exact-model lane only |
| LightGlue | [official repo](https://github.com/cvg/LightGlue) | Apache-2.0 code and official LightGlue weights | DISK is Apache-2.0 and ALIKED BSD-3; SuperPoint/pretrained-inference provenance is restrictive | conditional | Prefer SIFT/DISK/ALIKED plus LightGlue; exclude uncleared SuperPoint/SuperGlue paths |
| AliceVision | [official repo](https://github.com/alicevision/AliceVision) | MPL-2.0 | assets/dependencies inspect | commercial with file-level copyleft | Conditional photogrammetry lane |
| OpenMVG | [official repo](https://github.com/openMVG/openMVG) | MPL-2.0 | dependency review | workable obligations | Secondary/conditional |
| OpenMVS | [official repo](https://github.com/cdcseacave/openMVS) | AGPL-3.0 | no model escape | high closed/hosted risk | Reject default / commercial licence |
| CloudCompare | [official repo](https://github.com/CloudCompare/CloudCompare) | GPL-3.0 | plugins vary | copyleft | External analyst tool only |
| Blender | [official repo](https://github.com/blender/blender) | GPL-3.0-or-later | add-ons/assets vary; outputs not automatically GPL | external process workable | External tool with compliance |
| CGAL | [official licensing](https://www.cgal.org/license.html) | dual GPL/commercial | component-specific | closed integration requires licence/care | Buy or avoid GPL components |
| IfcOpenShell | [official repo](https://github.com/IfcOpenShell/IfcOpenShell) | LGPL-3.0 core; ecosystem tools vary | dynamic-link/distribution obligations | conditional | Candidate IFC adapter with compliance |

## Media and general interchange dependencies

| Component | Primary source | Code licence | Build/plugin caveat | Decision |
|---|---|---|---|---|
| pye57 | [official repo](https://github.com/davidcaron/pye57) | MIT wrapper | libE57Format/Xerces dependency closure; read-only mode required for ingest | Candidate Python E57 inspection |
| LASzip | [official repo](https://github.com/LASzip/LASzip) | Apache-2.0 current project | pin exact library/package build | Candidate LAZ codec |
| OpenImageIO | [official repo](https://github.com/AcademySoftwareFoundation/OpenImageIO) | Apache-2.0 core | many format plugins and third-party codecs have separate notices | Conditional image/RAW adapter |
| OpenCV | [official repo](https://github.com/opencv/opencv) | Apache-2.0 core | contrib modules, models and bundled codecs separately reviewed | Candidate camera/image processing |
| FFmpeg | [official repo](https://github.com/FFmpeg/FFmpeg) | mainly LGPL; optional components make builds GPL | codec patents, distribution flags and exact binary configuration are decisive | Conditional external video tool; exact build allow-list |
| Assimp | [official repo](https://github.com/assimp/assimp) | modified BSD-3-Clause | importer-specific robustness and dependencies | Candidate approved mesh importer |
| tinyobjloader | [official repo](https://github.com/tinyobjloader/tinyobjloader) | MIT core | optional pybind11/earcut third-party notices | Candidate narrow OBJ importer |

## Gaussian, neural geometry and appearance

| Component | Primary source/current status | Code rights | Model/checkpoint rights | Data, captured-input and dependency rights | Posture / decision |
|---|---|---|---|---|---|
| graphdeco Gaussian Splatting | [official licence](https://github.com/graphdeco-inria/gaussian-splatting/blob/main/LICENSE.md) | custom noncommercial research/evaluation; commercial software use requires explicit consent | sample checkpoints/assets do not create a commercial escape | captured-image rights and dataset terms remain separate; a trained PLY is not a workaround for prohibited commercial use of the software | Reject default; internal research only |
| gsplat 1.5.3 | [official repo](https://github.com/nerfstudio-project/gsplat); Apache-2.0; v1.5.3 released 2025-07-04; moving main was `77ab983ffe43420b2131669cb35776b883ca4c3c` on 2026-07-09 | permissive core | no mandatory pretrained checkpoint | examples, methods, datasets and dependencies require separate review; source-capture rights govern trained outputs | Candidate after FTO/dependency review. Main's 2026 sensor, LiDAR, 3DGUT, HiGS and CUDA 13 changes are explicitly **unreleased**; use v1.5.3 or an audited commit |
| Nerfstudio 1.1.5 | [official repo](https://github.com/nerfstudio-project/nerfstudio); Apache-2.0 core; latest v1.1.5 released 2024-11-11; last push 2025-07-29 | permissive framework core | plugin methods and checkpoints differ | datasets, submodules and source captures differ by selected method | Conditional framework only with an allow-listed method/model/data registry |
| DN-Splatter | [official repo](https://github.com/maturk/dn-splatter); Apache-2.0; no releases; last push 2025-07-05 | permissive research code | optional Omnidata and DSINE pretrained-normal chains require separate clearance | Replica, MuSHRoom, ScanNet++, Neural-RGBD, DTU and Tanks and Temples terms are independent; a sensor-depth-only path still needs exact dependency/input review | Research only today; may graduate through a minimal owned-data, sensor-depth path |
| NVIDIA 3DGRUT 1.1.0 | [official repo](https://github.com/nv-tlabs/3dgrut), [attributions](https://github.com/nv-tlabs/3dgrut/blob/main/ATTRIBUTIONS.md) and [submodules](https://github.com/nv-tlabs/3dgrut/blob/main/.gitmodules); active through 2026-07-08 | Apache-2.0 core; latest official release is v1.1.0, 2026-06-10 | no mandatory released checkpoint for owned-data training; samples/checkpoints inspect separately | tiny-cuda-nn, OptiX/CUDA, datasets and assets require exact-build review; captured-input rights govern output | Strong conditional candidate. Main README's “v2.0.0” describes untagged v2-era development; no v2 tag/release exists. Pin v1.1.0 or an audited commit |
| Mip-Splatting | [official repo](https://github.com/autonomousvision/mip-splatting); no releases; exact head `dda02ab5ecf45d6edb8c540d9bb65c7e451345a9`, 2024-12-17 | README and [licence](https://github.com/autonomousvision/mip-splatting/blob/main/LICENSE.md) follow the graphdeco 3DGS noncommercial research/evaluation terms; no permissive commercial escape | checkpoints separate | datasets and captured inputs separate, but do not cure the code restriction | Reject default; internal research only. Prefer an independently licensed gsplat antialiasing path after audit |
| 2D Gaussian Splatting | [official repo](https://github.com/hbb1/2d-gaussian-splatting) | inherits/references graphdeco restrictive terms | checkpoints separate | datasets/input rights separate | Reject default; internal research only |
| Gaussian Opacity Fields | [official repo](https://github.com/autonomousvision/gaussian-opacity-fields) | restrictive graphdeco-derived terms | models separate | datasets/input rights separate | Reject default; internal research only |
| SuGaR | [official repo](https://github.com/Anttwo/SuGaR) | restrictive graphdeco-derived terms | models separate | datasets/input rights separate | Reject default; internal research only |
| NeuS | [official repo](https://github.com/Totoro97/NeuS) | MIT | checkpoints vary | datasets and input rights vary | Research candidate |
| VolSDF | [official repo](https://github.com/lioryariv/volsdf) | MIT | checkpoints vary | datasets and input rights vary | Research candidate |
| Neuralangelo | [official repo](https://github.com/NVlabs/neuralangelo) | NVIDIA custom/research terms | models separately licensed | datasets and input rights separate | Reject default |
| nvdiffrast | [official repo](https://github.com/NVlabs/nvdiffrast) | NVIDIA terms | no model clearance implied | dependencies and inputs separate | Legal review before use |

Apache-2.0 includes a limited contributor patent grant; MIT/BSD generally do not. Obtain 3DGS/2DGS/3DGUT patent freedom-to-operate review before commercial launch.

## Generative and semantic models

| Component | Primary source/current status | Code rights | Model/checkpoint rights | Training data and source-input rights | Output/product decision |
|---|---|---|---|---|---|
| ArtiFixer v1 | [official repo](https://github.com/nv-tlabs/ArtiFixer) and [official model card](https://huggingface.co/nvidia/ArtiFixer); public checkpoint released 2026-06-04 | Apache-2.0 code; third-party notices/submodules still apply | official checkpoint is for research and development only under NVIDIA OneWay Noncommercial terms | DL3DV-10K/3DGUT/Qwen/MoGe training chain is not cleared by the code licence; user imagery must also be authorised | Released feature is reject production / research only. Apache code alone is conditional if paired with independently trained and cleared weights. Enhanced imagery is a generated derivative, not capture truth |
| NVIDIA Fixer v2 | [official model card](https://huggingface.co/nvidia/Fixer) and [Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) | integration code inspect separately | model licence, AUP and attribution conditions; do not confuse this distinct model with ArtiFixer | input-content/client/privacy rights remain separate | Conditional cinematic derivative only |
| MotionBricks | [official source](https://github.com/NVlabs/GR00T-WholeBodyControl/tree/main/motionbricks); initial public release 2026-04-27; parent active through 2026-07-10 | Apache-2.0 code | released VQ-VAE/pose/root checkpoints use the [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/), allowing conditional commercial use with attribution, AUP, export and related obligations; NVIDIA claims no ownership in outputs under that model licence | [BONES-SEED public terms](https://bones.studio/info/seed-license) are noncommercial for academic use, contain narrow status-dependent startup permissions, and expressly restrict training motion-generative substitutes; no downstream retraining permission follows from NVIDIA's checkpoint distribution | Released runtime/weights are conditional product candidates; retraining/fine-tuning on public BONES-SEED is reject default absent separate permission. Input character, rig and performer rights remain; animation output is not capture truth. README's “~one month” full-training-pipeline roadmap remains unfulfilled/stale at cutoff |
| Splat Analyzer | [official repo](https://github.com/nigelhartman/splat_analyzer); MIT; exact head `e199fef611296249cb15604474ae08aecc7db69f`, 2026-07-10; no release | permissive application code; pin the exact audited commit | [OWLv2 checkpoint](https://huggingface.co/google/owlv2-base-patch16-ensemble) at revision `cfd3195ba4ea9592eec887ded089f4c08eff231d` is Apache-2.0; CUDA gsplat and separate Metal `gsplat-mps` paths need exact review | source-splat/customer rights persist; rendered views and semantic labels do not create new capture authority | Conditional semantic-proposal/human-review tool only, never collision or measurement authority. Emits approximate clustered 3D boxes and supports SPZ v1-v3, not current v4 |
| MeshCoder | [official code](https://github.com/InternRobotics/MeshCoder), [official model](https://huggingface.co/InternRobotics/MeshCoder) and [official dataset](https://huggingface.co/datasets/InternRobotics/MeshCoderDataset); code head `bc72d5fa3d3c3659930eee1a595c5bd93c3aab06`, 2025-12-08; no release | MIT code only | gated model revision `f1490abdbce75db6886b88bcfce9fbec250b5596` is CC-BY-NC-SA-4.0 and also depends on its base-model terms | dataset revision `e199a6fe086f406aaa7feb7081f0e7881949e8f3` has conflicting BY-SA header versus NC-SA gate/licence text; apply the conservative noncommercial interpretation | Released functionality is reject production / research only. Reuse only the MIT code with independently cleared base model, tokenizer, data and checkpoints |
| NeuWorld | [official placeholder repo](https://github.com/WU-CVGL/NeuWorld) at `eba2096d22c6ce9e2a473edc2d8dad002d38fd3c`, 2026-06-30, and [project page](https://lizhiqi49.github.io/NeuWorld/) | no repository licence and no released code | README says code/checkpoints will be released; none is available at cutoff | project assets and any future model/data chain require separate review | Citation/research inspiration only; no executable or redistributable material is currently eligible |
| NeRFiller | [official repo](https://github.com/ethanweber/nerfiller) | Apache-2.0 code | LaMa/Stable Diffusion checkpoints separately licensed | training data and user inputs separately licensed | Research until the full chain is approved |
| VGGT | [official repo](https://github.com/facebookresearch/vggt) | code terms inspect at exact pin | original and commercial checkpoints differ under custom licence/AUP | dataset and source-image rights separate | Only an exact gated commercial checkpoint may qualify; conditional initializer, never metric authority |
| VGGT-Omega | [official repo](https://github.com/facebookresearch/vggt-omega) | FAIR Noncommercial Research License | noncommercial checkpoint | data/input rights separate | Reject production |
| SAM 2 | [official repo](https://github.com/facebookresearch/sam2) | code/demo/training Apache-2.0; optional component BSD-3 | official checkpoints Apache-2.0 | source-image and any retraining-data rights separate | Candidate semantic proposal lane, not truth authority |
| SAM 3/3.1 | [official repo](https://github.com/facebookresearch/sam3) | custom SAM licence | checkpoint redistribution/use/indemnity restrictions | data/input rights separate | Commercial use may be possible but conditional; prefer SAM 2 initially |
| GroundingDINO | [official repo](https://github.com/IDEA-Research/GroundingDINO) | Apache-2.0 code | exact checkpoint licence and digest still required | training data/source imagery separate | Proposal tool after checkpoint review |
| OpenMask3D | [official repo](https://github.com/OpenMask3D/openmask3d) | MIT code | common ScanNet-derived checkpoints | ScanNet's noncommercial restrictions contaminate common training/data paths | Retrain on owned/cleared data or exclude |
| Mask3D | [official repo](https://github.com/JonasSchult/Mask3D) | MIT code | common checkpoint terms vary | dataset terms vary | Retrain on owned/cleared data or exclude |
| Pointcept | [official repo](https://github.com/Pointcept/Pointcept) | MIT code | checkpoints vary | common ScanNet/other dataset terms are dataset-specific | Retrain or obtain exact clearance |
| ScanNet | [official terms](https://kaldir.vc.in.tum.de/scannet/ScanNet_TOS.pdf) | not software | checkpoints derived from it inherit a commercial-risk gate | dataset is restricted to noncommercial research/education | Do not use derived checkpoints commercially |

Generated output also inherits captured-content/client/privacy restrictions. Record model/version, checkpoint digest, input assets, prompt/condition digest, mask, provenance class, confidence, AUP/export restrictions and Truth Mode disclosure.

## Runtime and interchange

| Component/format | Primary source/current status | Code/spec rights | Model, data, input and dependency rights | Decision |
|---|---|---|---|---|
| SPZ format v4 / library v3.0.0 | [official repo](https://github.com/nianticlabs/spz) and [SPZ v4 announcement](https://www.nianticspatial.com/blog/spz4); library v3.0.0 released 2026-05-05 and active through 2026-07-10 | MIT implementation; **library major version 3 is distinct from format version 4**; lossy transport | v4 uses Zstandard while older v1-v3 use gzip; codec/dependency and patent/FTO review remain; source-splat rights persist through conversion | Conditional runtime/interchange; never archive or evidence master |
| SOG | [official spec](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/) | public lossy WebP-based bundle | source-splat/input rights, WebP dependency and convention/LOD tests remain | Conditional web delivery |
| SplatTransform 3.0.0 | [official repo](https://github.com/playcanvas/splat-transform); MIT; v3.0.0 released 2026-07-09 | reads PLY/compressed PLY/SOG/SPZ v2-v4/SPLAT/KSPLAT/LCC; writes PLY/compressed PLY/SOG/SPZ/GLB `KHR_gaussian_splatting`/CSV/HTML/LOD/voxel/WebP | input-format, source-asset, customer/vendor and privacy terms remain; current README says LCC, not a separately cleared LCC2 grant | Conditional approved-format converter; conversion does not cleanse upstream rights |
| SuperSplat / Viewer / PlayCanvas | [SuperSplat](https://github.com/playcanvas/supersplat) v2.29.0, 2026-07-08; [Viewer](https://github.com/playcanvas/supersplat-viewer) v1.27.1, 2026-07-08; [Engine](https://github.com/playcanvas/engine) v2.20.6, 2026-07-06; [React](https://github.com/playcanvas/react); all MIT and active at cutoff | permissive editor, runtime, viewer and bindings | manual edits/exports require provenance; content/input rights govern resulting assets; exact web/runtime dependency closure required | Conditional product candidates at exact pins; do not rely on stale 1.22.4/2.18.1 version records |
| Spark | [official repo](https://github.com/sparkjsdev/spark); MIT; upstream v2.1.0 released 2026-05-18 and active through 2026-07-07 | permissive renderer | source splats and dependencies separately cleared; RAD ecosystem/spec remains young | Current OmniTwin renderer is pinned at 2.0.0; v2.1.0 is an upgrade candidate, not yet an adopted version; RAD experimental |
| Three Meshlets experimental demo | [deployed demo](https://three-meshlets-z23hmxbz1jwlff.needle.run/), [Needle source](https://github.com/needle-tools/three.js/blob/feature/meshlet-creation-sample/examples/webgpu_compute_nanite_meshlets.html), [Needle branch licence](https://github.com/needle-tools/three.js/blob/feature/meshlet-creation-sample/LICENSE) and [original Sunag branch](https://github.com/sunag/three.js/tree/dev-nanite-style); exact Needle commit `dd4f73d3e8cc98cca32dfb9f04341e8134e1fab7`, authored 2026-05-22; Sunag commit `9da7062318feeee05cdf82ec90c1143c203d8971`, 2026-05-21 | Three.js fork code and [meshoptimizer](https://github.com/zeux/meshoptimizer/blob/master/LICENSE.md) are MIT; sample is an experimental Needle/Sunag fork branch, not an upstream Three.js release/package | Draco/other exact dependencies need review; bundled [Damaged Helmet](https://github.com/needle-tools/three.js/blob/feature/meshlet-creation-sample/examples/models/gltf/DamagedHelmet/README.md) is CC Attribution-NonCommercial and CoffeeMug provenance is not visible | Code extraction is conditional after commit pin, own assets, dependency closure and performance/security review. Demo bundle/assets are research only; never ship wholesale |
| Khronos Gaussian glTF | [official extension](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_gaussian_splatting) | release candidate | implementation, payload and source-asset rights vary | Feature-flagged adapter; do not claim ratification |
| glTF 2.0 | [official repo](https://github.com/KhronosGroup/glTF) | royalty-free specification | library/dependency and embedded-asset rights vary | Primary mesh runtime |
| OpenUSD 26.05 | [official repo](https://github.com/PixarAnimationStudios/OpenUSD) and [v26.05 licence](https://raw.githubusercontent.com/PixarAnimationStudios/OpenUSD/v26.05/LICENSE.txt) | Tomorrow Open Source Technology License 1.0 | custom Apache-like trademark terms, third-party notices and source-asset rights remain | Conditional DCC/composition adapter |
| OGC 3D Tiles 1.1 | [official standard](https://docs.ogc.org/cs/22-025r4/22-025r4.html) | OGC Community Standard | implementation and payload rights vary | Optional geospatial hierarchy; Gaussian payload support is not a stable 2.0 standard |
| OGC 3D Tiles 2.0 | [official work-item notice](https://www.ogc.org/requests/ogc-seeks-public-comment-on-proposed-3d-tiles-2-0-community-standard-work-item/) | proposed work item in 2026 | no released-standard rights/status to claim | Do not claim support/ratification |
| meshoptimizer/gltfpack | [official repo](https://github.com/zeux/meshoptimizer) | MIT | codec/patent/dependency and source-asset review | Conditional mesh LOD/compression candidate |

## XGRIDS and Matterport

| Asset/service | Primary source/current status | Code/format/service grant | Data, captured-input and output rights | Decision |
|---|---|---|---|---|
| LCC format | [official whitepaper](https://github.com/xgrids/LCCWhitepaper) | custom non-OSI grant with attribution, modification/redistribution flow-down, competitive-AI-training, public/no-less-open derivative, termination, trademark and dispute provisions | source-capture/customer/vendor terms remain; permissive third-party parsing code cannot override the format/source grant | **Reject default / blocked** for product ingestion, conversion, redistribution or training absent written XGRIDS and counsel clearance; never canonical |
| LCC2 format | [official whitepaper](https://github.com/xgrids/LCC2Whitepaper) | custom non-OSI grant retaining LCC obligations and adding broad prohibited-use clauses | competing-AI training requires consent; derivative/content and source-input restrictions remain after export | **Reject default / blocked** absent written XGRIDS and counsel clearance; never canonical |
| LCC Studio | [official downloads](https://www.xgrids.com/support/download?page=LCCStudio) and [manual](https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.0.0/02-version-and-updates.html) | vendor binary/service/click-through terms; official manual identifies v2.0.0 in June 2026, while observed download evidence reported v2.1.0 on 2026-07-02 | PLY/USD/SOG/SPZ export capability does not itself grant source-content or automation rights | External manual export bridge only after customer/vendor-rights verification; pin installer hash and accepted terms to resolve the version conflict |
| XGRIDS Web SDK | [official repo](https://github.com/xgrids/LCC-Web-SDK); latest visible release v0.6.1, 2026-06-16 | public repository/release binary but no root LICENSE/SPDX commercial redistribution grant found | LCC/LCC2 payload and customer/source rights remain separate | **Unknown / do not bundle** without written portal/binary terms |
| XGRIDS Unity SDK | [official repo](https://github.com/xgrids/LCC-Unity-SDK); latest visible release v1.2.18, 2025-08-28 | public repository/release binary but no root LICENSE/SPDX commercial redistribution grant found | LCC/LCC2 payload and customer/source rights remain separate | **Unknown / do not bundle** without written portal/binary terms |
| XGRIDS Unreal SDK | [official repo](https://github.com/xgrids/LCC-Unreal-SDK); latest visible release v0.9.0, 2025-05-30 | public repository/release binary but no root LICENSE/SPDX commercial redistribution grant found | LCC/LCC2 payload and customer/source rights remain separate | **Unknown / do not bundle** without written portal/binary terms |
| XGRIDS raw xbin | [official terms](https://xgrids.com/UserAgreement) plus local evidence | no public decoder; reverse-engineering/competition restrictions | raw capture/customer/vendor rights remain independent | Official SDK/export/rights only; no reverse engineering |
| Matterport E57/MatterPak | [official E57 page](https://matterport.com/en-gb/add-ons/e57) | registered export functionality; service/software terms apply | source/export/customer rights are contract-specific | Ingest only with asset policy and contract evidence |
| Matterport Data for AI | [2026 Terms of Use](https://matterport.com/terms-of-use) | service terms, not an open code/data grant | commercial AI/ML training using Matterport Data is prohibited | No model training absent written clearance |
| Matterport customer ownership | [Platform Subscription Agreement](https://matterport.com/de/legal/platform-subscription-agreement) | as between Customer and Matterport, the customer owns Customer Data/Spaces, subject to the agreement; this does not establish third-party rights | Matterport rights, export-access clauses and AI restrictions remain | Counsel reconciles ownership and allowed-use clauses before ingest/training |
| Trades Hall reference imagery | [venue terms](https://www.tradeshallglasgow.co.uk/terms-and-conditions/) updated 2024-03-11 | downloads/extracts are limited to personal use and images may not be separately used | exact Grand Hall reference-image SHAs and any organisational/commercial review, public display, model input or redistribution purpose require written permission or replacement | Restricted supporting evidence only; omit the full identity image set from redistributable/T-486 material until cleared |

The fact that SplatTransform can parse LCC/LCC2 does not remove XGRIDS format or source-asset restrictions.

## Desktop and orchestration

| Component | Primary source | Licence/terms | Decision |
|---|---|---|---|
| Tauri 2 | [official repo](https://github.com/tauri-apps/tauri) | MIT/Apache-2.0 | preferred shell candidate after parity test |
| Electron | [official repo](https://github.com/electron/electron) | MIT | renderer-consistency fallback |
| Qt 6 | [official licensing](https://doc.qt.io/qt-6/licensing.html) | commercial or LGPL/GPL; module/WebEngine obligations vary | use only with formal programme |
| Temporal server/SDK | [server](https://github.com/temporalio/temporal), [TypeScript SDK](https://github.com/temporalio/sdk-typescript) | MIT | durable control-plane candidate |
| SkyPilot | [official repo](https://github.com/skypilot-org/skypilot) | Apache-2.0; provider/service terms separate | optional multi-provider adapter |
| Argo Workflows | [official repo](https://github.com/argoproj/argo-workflows) | Apache-2.0 | cluster adapter when Kubernetes exists |
| Prefect | [official repo](https://github.com/PrefectHQ/prefect) | Apache-2.0 | MVP alternative; never canonical job model |
| Dagster | [official repo](https://github.com/dagster-io/dagster) | Apache-2.0 | alternative; asset model must not replace Foundry contracts |
| OCI image/runtime specs | [official image spec](https://github.com/opencontainers/image-spec) | Apache-2.0 | canonical portable worker package |
| RunPod SDK | [official repo](https://github.com/runpod/runpod-python) | MIT; provider terms/pricing/data handling separate | provider adapter only |
| MCAP | [official repo](https://github.com/foxglove/mcap) | MIT | candidate open sensor log |
| hash-wasm 4.12.0 | [official repo](https://github.com/Daninet/hash-wasm) | MIT; zero runtime dependencies at the pinned package version | Candidate local resumable SHA-256 worker. Treat exported `save()` state as sensitive source material: upstream warns that it can retain plaintext input bytes. Keep it private, integrity-bound and out of browser/download artifacts; do not describe resumable checkpoints as harmless metadata. |

## Production approval record

For every component and model, store:

- canonical name, source URL, exact version/commit and digest;
- code licence and NOTICE/source obligations;
- every bundled dependency and plugin;
- weight/model licence and exact checkpoint digest;
- training/evaluation dataset rights;
- source-asset/client/vendor terms;
- patent/FTO decision;
- cloud/API terms and data-retention region;
- redistribution, modification, hosted-service and commercial-use decisions;
- reviewer/date/expiry and prohibited purposes.

An unknown field blocks automatic production approval. Re-review terms at each upgrade and at least annually for services/custom model/format licences.
