# OmniTwin Foundry technology and licence matrix

**Research cutoff:** 2026-07-19

**Purpose:** commercial-risk screen, not legal advice.

“Permissive” does not clear patents, optional dependencies, checkpoints, training data, captured-content rights, privacy or service terms. Production approval is for an exact version/image/checkpoint/dependency closure, not a project name.

## 2026-07-19 purpose-scoped outcome

This refresh removes cybersecurity, identity attestation, signing and
publication from the ordinary super-app engineering path. Those concerns are
not prerequisites for local file intake, reconstruction, deterministic quality
review or a separately labelled visual-derivative lane.

The engineering path may continue with exact, pinned permissive components:
the currently integrated Three.js 0.180.0, React Three Fiber 8.18.0 and Spark
2.0.0 runtime; libE57Format/pye57, PDAL and Open3D for owned or authorised
inputs; COLMAP plus a curated hloc lane for registration; gsplat 1.5.3 for the
preferred owned-data training implementation; and narrowly packaged MIT
PlayCanvas/SPZ/Basis components after their exact dependency and notice closure
is recorded in a new local manifest. This is an engineering go-ahead for the
browser stack and newly written local product code, not a blanket legal
approval. It expressly excludes the existing `infra/runpod/Dockerfile`, which
contains older pye57/Open3D pins and moving-main SPZ/DN-Splatter acquisitions.

The following boundaries remain mandatory:

- never infer rights in a venue capture, photograph, video, LCC/LCC2/SPZ/SOG
  payload, trained checkpoint or exported asset from the tool's code licence;
- accept XGRIDS raw/XBIN only through an official vendor-supported export or
  written permission; do not build a raw decoder or treat possession as a grant;
- keep the original graphdeco implementation, Mip-Splatting, released
  ArtiFixer/MeshCoder/ScaRF default weights and the complete WorldMesh pipeline
  out of the commercial production lane under their current terms;
- keep AI-enhanced output in a distinct, opt-in visual-derivative lane that is
  never measurement, collision, planning or captured-truth authority; and
- treat RunPod, R2, AWS, Matterport, RealityScan and similar products as
  separately accepted service/tool contracts, not open-source dependencies.

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
| libE57Format 3.3.0 | [official repo](https://github.com/asmaloney/libE57Format) at `d885ae35147dabd0ad9f6a85e46538b27b1b701c` | Boost Software License 1.0 | source E57 rights and Xerces closure remain separate | permissive | Candidate E57 core; pye57 0.4.19 pins the earlier libE57Format 3.1.1, so record the actual binary closure rather than assuming current head |
| PDAL 2.10.2 | [official repo](https://github.com/PDAL/PDAL) at `27008f6241be44585c866a29dfc13bb16d678dab` | BSD-3-Clause | plugins/build dependencies vary | permissive core | Candidate point I/O; not currently declared in an OmniTwin package/environment manifest |
| Open3D 0.19.0 | [official repo](https://github.com/isl-org/Open3D) at `1e7b17438687a0b0c1e5a7187321ac7044afe275` | MIT | optional ML models, CUDA and datasets vary | permissive core | Planned local ICP/TSDF/QA candidate. The checked-in legacy RunPod image pins 0.18.0 instead and is excluded pending a complete image audit |
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
| ScaRF-SLAM | [official repo](https://github.com/ori-drs/ScaRF-SLAM) at `a309a6541ea7ba70d5fd281be5396082dfe4f1ac` and [official group page](https://ori-drs.github.io/) | GPL-3.0; the README separately asks commercial users to contact the authors, so that statement must be reconciled with the licence before any commercial distribution | The released default hard-codes `DA3NESTED-GIANT-LARGE`; its [exact model card](https://huggingface.co/depth-anything/DA3NESTED-GIANT-LARGE/blob/8615eefb62f2db4f8d6ebaa59160086981672829/README.md) is CC-BY-NC-4.0. OpenVINS/ORB-SLAM, linked datasets and other checkpoints remain separate | released default is directly noncommercial; GPL distribution obligations also apply to the code | Research only / reject the released default pipeline. Technique-only study may inform an independent permissive implementation |
| VINS-Fusion | [official repo](https://github.com/HKUST-Aerial-Robotics/VINS-Fusion) | GPL-3.0 | dependencies | closed-product conflict | Reject default |
| FAST-LIO | [official repo](https://github.com/hku-mars/FAST_LIO) | GPL-2.0; commercial contact | per-point timing/calibration essential | closed-product conflict | Reject default / license |
| COLMAP 4.1.1 | [official release](https://github.com/colmap/colmap/releases/tag/4.1.1) and [COPYING at release commit `a0d785fb`](https://github.com/colmap/colmap/blob/a0d785fba74b2664f31edc4a29026a8b27c00f67/COPYING.txt) | new-BSD core at exact release commit `a0d785fba74b2664f31edc4a29026a8b27c00f67` | COPYING expressly says dependencies are separately licensed and can affect the resulting build; source-photo/capture rights govern outputs | active strong candidate; includes the global mapper | Candidate SfM/MVS core after exact release/build-closure and input-rights review. Re-pin/re-audit before upgrading the previously reviewed 4.1.0 build |
| GLOMAP 1.2.0 | [official repo](https://github.com/colmap/glomap) | BSD-3-Clause; v1.2.0 released 2025-10-31 | archived 2026-03-09, deprecated/unmaintained and migrated into COLMAP | permissive but obsolete standalone | Reject as a new standalone dependency; use COLMAP global mapper |
| hloc v1.4 | [official release](https://github.com/cvg/Hierarchical-Localization/releases/tag/v1.4) at `80ccb7ee3bc048cb3a8ef221c5bc4d8ac25d5792` | Apache-2.0 root at the exact tag | extractors, matchers, submodules and checkpoints differ; source-image rights remain separate | conditional | Curated exact-model lane only |
| LightGlue | [official repo](https://github.com/cvg/LightGlue) | Apache-2.0 code and official LightGlue weights | DISK is Apache-2.0 and ALIKED BSD-3; SuperPoint/pretrained-inference provenance is restrictive | conditional | Prefer SIFT/DISK/ALIKED plus LightGlue; exclude uncleared SuperPoint/SuperGlue paths |
| AliceVision | [official repo](https://github.com/alicevision/AliceVision) | MPL-2.0 | assets/dependencies inspect | commercial with file-level copyleft | Conditional photogrammetry lane |
| OpenMVG | [official repo](https://github.com/openMVG/openMVG) | MPL-2.0 | dependency review | workable obligations | Secondary/conditional |
| OpenMVS | [official repo](https://github.com/cdcseacave/openMVS) | AGPL-3.0 | no model escape | high closed/hosted risk | Reject default / commercial licence |
| CloudCompare | [official repo](https://github.com/CloudCompare/CloudCompare) | GPL-3.0 | plugins vary | copyleft | External analyst tool only |
| Blender | [official licensing](https://www.blender.org/about/license/) and [repository copying notice](https://github.com/blender/blender/blob/9b4e4a58cdb0f876853beca1ebe377a00c5e0405/COPYING) | default source is GPL-2.0-or-later; official combined binaries are GPL-3.0-or-later because included components require GPLv3 compatibility | add-ons/assets vary; user-created artwork/data is not automatically GPL, while scripts using Blender's integral Python API generally need GPL-compatible licensing | external process workable | External isolated tool only; do not link/embed its application or integral API scripts into the closed product without a specific compliance design |
| CGAL | [official licensing](https://www.cgal.org/license.html) | dual GPL/commercial | component-specific | closed integration requires licence/care | Buy or avoid GPL components |
| IfcOpenShell | [official repo](https://github.com/IfcOpenShell/IfcOpenShell) | LGPL-3.0 core; ecosystem tools vary | dynamic-link/distribution obligations | conditional | Candidate IFC adapter with compliance |

## Media and general interchange dependencies

| Component | Primary source | Code licence | Build/plugin caveat | Decision |
|---|---|---|---|---|
| pye57 0.4.19 | [official repo](https://github.com/davidcaron/pye57) at `64c9000738ad54242e87e1da6bca6b683b13374b` | MIT wrapper | release pins [libE57Format 3.1.1 at `1914b8ea`](https://github.com/asmaloney/libE57Format/releases/tag/v3.1.1) plus Xerces; read-only mode and source E57 rights remain required | Planned local Python E57 candidate. The checked-in legacy RunPod image pins 0.4.16 instead; neither its presence nor the planned upgrade establishes an approved binary closure |
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
| gsplat 1.5.3 | [official release](https://github.com/nerfstudio-project/gsplat/releases/tag/v1.5.3) at `937e29912570c372bed6747a5c9bf85fed877bae`; Apache-2.0 | permissive core | no mandatory pretrained checkpoint | examples, methods, datasets and dependencies require separate review; source-capture rights govern trained outputs | Candidate after FTO/dependency review. Main's later sensor, LiDAR, 3DGUT, HiGS and CUDA 13 changes are explicitly **unreleased** from 1.5.3; use the exact tag or a separately audited commit |
| Nerfstudio 1.1.5 | [official release](https://github.com/nerfstudio-project/nerfstudio/releases/tag/v1.1.5) at `6b60855003011b2ca23c2fe3f8e2ca6314c69924`; Apache-2.0 core | permissive framework core | plugin methods and checkpoints differ | datasets, submodules and source captures differ by selected method | Conditional framework only with an allow-listed method/model/data registry |
| DN-Splatter | [official repo](https://github.com/maturk/dn-splatter); Apache-2.0; no releases; last push 2025-07-05 | permissive research code | optional Omnidata and DSINE pretrained-normal chains require separate clearance | Replica, MuSHRoom, ScanNet++, Neural-RGBD, DTU and Tanks and Temples terms are independent; a sensor-depth-only path still needs exact dependency/input review | Research only today; may graduate through a minimal owned-data, sensor-depth path |
| NVIDIA 3DGRUT 1.1.0 | [official repo](https://github.com/nv-tlabs/3dgrut), [attributions](https://github.com/nv-tlabs/3dgrut/blob/a37ef721012dea0f29c0fcfff2d525023b4e854a/ATTRIBUTIONS.md) and [submodules](https://github.com/nv-tlabs/3dgrut/blob/a37ef721012dea0f29c0fcfff2d525023b4e854a/.gitmodules); inspected head `a37ef721012dea0f29c0fcfff2d525023b4e854a` | Apache-2.0 core; latest official release is v1.1.0. Official attributions include mixed dependencies, notably `plyfile` under GPL-3.0 | no mandatory released checkpoint for owned-data training; samples/checkpoints inspect separately | tiny-cuda-nn, OptiX/CUDA, GPL dependency placement, datasets and assets require exact-build review; captured-input rights govern output | Conditional/high-diligence candidate only after the exact environment and distributed binary closure are audited. Prefer gsplat for the initial production lane |
| Mip-Splatting | [official repo](https://github.com/autonomousvision/mip-splatting); no releases; exact head `dda02ab5ecf45d6edb8c540d9bb65c7e451345a9`, 2024-12-17 | no root LICENSE grant was found; the [README](https://github.com/autonomousvision/mip-splatting/blob/dda02ab5ecf45d6edb8c540d9bb65c7e451345a9/README.md) explicitly says to follow the graphdeco 3DGS licence, so apply its noncommercial research/evaluation terms conservatively | checkpoints separate | datasets and captured inputs separate, but do not cure the code restriction | Reject default; internal research only. Prefer an independently licensed gsplat antialiasing path after audit |
| CL-Splats | [paper](https://arxiv.org/abs/2506.21117) and [official source at `587fffc2`](https://github.com/jan-ackermann/cl-splats/tree/587fffc207f9c7cbb348f35e6d1d223d007eab69); no tags/releases | original contributions are MIT, but [derived 3DGS files](https://github.com/jan-ackermann/cl-splats/blob/587fffc207f9c7cbb348f35e6d1d223d007eab69/3DGS_LICENSE.md) remain noncommercial research/evaluation | no blanket checkpoint grant established | companion dataset has no declared licence metadata/file | Reject whole repository for production; independent continual-update study over permissive components only, with no restricted-code copying and patent/FTO unresolved |
| ReAct-GS | [paper](https://arxiv.org/abs/2510.19653) and [official source at `5cf1b9dd`](https://github.com/react-gs/ReAct-GS/tree/5cf1b9dd7a3ac0cc991976969a41cfb1fcad90a5); no tags/releases | [project licence](https://github.com/react-gs/ReAct-GS/blob/5cf1b9dd7a3ac0cc991976969a41cfb1fcad90a5/LICENSE.md) adopts original Gaussian-Splatting noncommercial research/evaluation terms | no official weights release found | benchmark and source-capture rights separate | Reject whole repository for production; independent densification/reactivation study only, with no restricted-code copying and patent/FTO unresolved |
| WildGaussians | [paper](https://arxiv.org/abs/2407.08447) and [official source at `66fa22ac`](https://github.com/jkulhanek/wild-gaussians/tree/66fa22ac74a6ffba024842dff29ded114d41f4d0); no tags/releases | original contributions are MIT, but the [root licence](https://github.com/jkulhanek/wild-gaussians/blob/66fa22ac74a6ffba024842dff29ded114d41f4d0/LICENSE) embeds noncommercial 3DGS renderer terms and the README also requires 3DGS/Mip-Splatting compliance | separate checkpoint repository does not cleanse training-code restrictions | benchmark/source-image provenance remains separate | Reject whole repository for production; independent appearance/transient strategy study over a permissive rasterizer only |
| PPISP 1.2.1 | [official project](https://research.nvidia.com/labs/sil/projects/ppisp/) and [tag v1.2.1](https://github.com/nv-tlabs/ppisp/tree/v1.2.1) at `df33809f7b3b20ac06de088dfc871b144b8fb54d` | [Apache-2.0](https://github.com/nv-tlabs/ppisp/blob/df33809f7b3b20ac06de088dfc871b144b8fb54d/LICENSE) with [third-party attributions](https://github.com/nv-tlabs/ppisp/blob/v1.2.1/ATTRIBUTIONS.md) | no mandatory pretrained checkpoint | optional official dataset is separately CC-BY-4.0; source imagery rights remain | Conditional photometric-compensation candidate after exact dependency/notice and input-rights closure |
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
| Splat Analyzer | [official repo](https://github.com/nigelhartman/splat_analyzer); MIT; exact head `e199fef611296249cb15604474ae08aecc7db69f`, 2026-07-10; no release | permissive application code; pin the exact audited commit. CUDA gsplat is the cleaner path; the Apple path uses [gsplat-mps](https://github.com/iffyloop/gsplat-mps/blob/10372c263f8e54427183de8a5855a62f94c2f206/LICENSE), which is AGPL-3.0 | [OWLv2 checkpoint](https://huggingface.co/google/owlv2-base-patch16-ensemble) at revision `cfd3195ba4ea9592eec887ded089f4c08eff231d` is Apache-2.0 | source-splat/customer rights persist; rendered views and semantic labels do not create new capture authority | Conditional CUDA semantic-proposal/human-review tool only. The Apple lane needs separate AGPL architecture review. Never collision or measurement authority; current app supports SPZ v1-v3, not v4 |
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

## Newly published or still-unreleased 2026 research references

| Component | Primary source/current status | Code rights | Model/data/dependency rights | Decision |
|---|---|---|---|---|
| WorldMesh | [official repo](https://github.com/mschneider456/worldmesh) and [licence at inspected head `ee19422f`](https://github.com/mschneider456/worldmesh/blob/ee19422fbc41592130636d8d2d12a3b155d60867/LICENSE) | core WorldMesh code is MIT, but the repository bundles SAM 3/SAM 3D Objects under the SAM licence, ComfyUI under GPL-3.0, Depth Pro under Apple terms and Nerfstudio under Apache-2.0 | current workflows require or reference FLUX.2 Klein noncommercial weights, gated SAM checkpoints, repackaged model artifacts and setup-time Mip-Splatting code under graphdeco-style noncommercial terms. The [21.7 GB dataset page](https://huggingface.co/datasets/mas456/worldmesh) labels the dataset MIT but has an empty card and no detailed provenance | Core-code extraction may be considered only after a file-level independent dependency audit. The released whole pipeline/container is **not a production-clean dependency**. Its structure/appearance split is an architecture-study candidate only, not code, weight, asset or patent clearance |
| SimFoundry | [official NVIDIA project page](https://research.nvidia.com/labs/gear/simfoundry/) and linked paper | no code repository, release or licence is linked from the official page at the cutoff | no checkpoint, dataset or redistributable asset grant was established | Technique/paper inspiration only. Do not name it as a dependency or claim reproducibility until an authoritative source release and terms appear |
| NeuWorld | [official placeholder repo](https://github.com/WU-CVGL/NeuWorld) at `eba2096d22c6ce9e2a473edc2d8dad002d38fd3c` and [project page](https://lizhiqi49.github.io/NeuWorld/) | no repository licence and no released code | README says the code/checkpoints are still under internal review and will be released later | Citation/research inspiration only; no executable, checkpoint or redistributable material is eligible |
| Cross-Temporal 3DGS | [arXiv paper](https://arxiv.org/abs/2512.00534) and [AAAI publication](https://ojs.aaai.org/index.php/AAAI/article/download/37217/41179) | no official implementation repository or software licence identified; arXiv distribution terms cover the article, not absent code | no public model/dataset terms identified | Paper-study candidate only; no dependency, code-copying or implementation/patent clearance |
| GaussianUpdate | [official project page](https://zju3dv.github.io/GaussianUpdate/) and [CC-BY-4.0 paper](https://arxiv.org/abs/2508.08867) | no official code repository or software licence identified; article licence does not cover absent code | no public project model/dataset terms identified | Paper-study candidate only; no dependency, code-copying or implementation/patent clearance |
| YouTube `vbtQ3tvi5ok` | [public video](https://www.youtube.com/watch?v=vbtQ3tvi5ok), [YouTube licence guidance](https://support.google.com/youtube/answer/2797468?hl=en-GB) and separately reviewed [PPISP project](https://research.nvidia.com/labs/sil/projects/ppisp/) | explanatory interview, not a code release; no Creative Commons designation was exposed | do not copy, bundle or redistribute the video/transcript without permission | Cite/link only. Evaluate PPISP's Apache implementation through its own row rather than treating the media link as a reusable asset |

## Runtime and interchange

| Component/format | Primary source/current status | Code/spec rights | Model, data, input and dependency rights | Decision |
|---|---|---|---|---|
| SPZ format v4 / source tag v3.0.0+adobe.32 | [exact source tag](https://github.com/nianticlabs/spz/tree/v3.0.0%2Badobe.32) at `21715c3b7a609ea6fb7c69b8ae42181a12b59f22` and [SPZ v4 announcement](https://www.nianticspatial.com/blog/spz4) | MIT implementation; the tag includes Adobe build metadata, while the source still [declares package version 1.1.0](https://github.com/nianticlabs/spz/blob/21715c3b7a609ea6fb7c69b8ae42181a12b59f22/CMakeLists.txt#L3-L6); file-format version 4 is a separate identity | v4 uses Zstandard while older v1-v3 use gzip; codec/dependency and patent/FTO review remain; source-splat rights persist through conversion | Conditional runtime/interchange; never archive or evidence master. Do not call `21715c3b…` plain library 3.0.0 |
| SOG | [official spec](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/) | public lossy WebP-based bundle | source-splat/input rights, WebP dependency and convention/LOD tests remain | Conditional web delivery |
| SplatTransform 3.1.3 | [official repo](https://github.com/playcanvas/splat-transform); MIT; v3.1.3 released 2026-07-18 at `51fe3dfcd706b6ef7610e224b13293bc74fb450d` | offline/browser conversion surface; exact runtime closure includes `@adobe/spz` plus a PlayCanvas peer. Test splats/golden images have no blanket asset grant | input-format, source-asset, customer/vendor and privacy terms remain; conversion never cleanses upstream rights | Conditional converter candidate only after an exact 3.1.3 dependency/fixture review. The previously reviewed 3.0.0 pin is stale; no PlayCanvas package is currently integrated in OmniTwin |
| SuperSplat / Viewer / PlayCanvas | [SuperSplat v2.31.1](https://github.com/playcanvas/supersplat/releases/tag/v2.31.1) at `206b289158ccb0386ac1ec0c8e85ffc80eea2a2c`; [Viewer](https://github.com/playcanvas/supersplat-viewer) v1.27.1; [Engine](https://github.com/playcanvas/engine) v2.20.6; [React](https://github.com/playcanvas/react) v0.11.5; all MIT | permissive editor, runtime, viewer and bindings. Engine npm excludes examples, but its source examples contain mixed assets including CC-BY-NC and noncommercial material | manual edits/exports require provenance; user content and every example/HDRI/model remain separately licensed; exact web/runtime dependency closure required | Narrow code/package candidates only. Do not wholesale bundle repository assets, and do not describe these as integrated dependencies |
| Spark | [official repo](https://github.com/sparkjsdev/spark); MIT; upstream v2.1.0 released 2026-05-18 and active through 2026-07-07 | permissive renderer | source splats and dependencies separately cleared; RAD ecosystem/spec remains young | Current OmniTwin renderer is pinned at 2.0.0; v2.1.0 is an upgrade candidate, not yet an adopted version; RAD experimental |
| Three.js / React Three Fiber | [Three.js r180](https://github.com/mrdoob/three.js/tree/0af9729d0c143a86a1d725d6e2c3ad83301f3f34) and [React Three Fiber 8.18.0](https://github.com/pmndrs/react-three-fiber/tree/f81bfe8cb29373d2687433c6130e0ce1daf7222c) | both MIT at the exact currently locked releases | repository example models and user content are separate; the current lock also fixes Spark 2.0.0 against Three 0.180.0 | Current integrated runtime candidates. Preserve notices; do not silently upgrade to Three r185, R3F 9 or Spark 2.1.0 |
| Three Meshlets experimental demo | [deployed demo](https://three-meshlets-z23hmxbz1jwlff.needle.run/), [Needle source](https://github.com/needle-tools/three.js/blob/feature/meshlet-creation-sample/examples/webgpu_compute_nanite_meshlets.html), [Needle branch licence](https://github.com/needle-tools/three.js/blob/feature/meshlet-creation-sample/LICENSE) and [original Sunag branch](https://github.com/sunag/three.js/tree/dev-nanite-style); exact Needle commit `dd4f73d3e8cc98cca32dfb9f04341e8134e1fab7`, authored 2026-05-22; Sunag commit `9da7062318feeee05cdf82ec90c1143c203d8971`, 2026-05-21 | Three.js fork code and [meshoptimizer](https://github.com/zeux/meshoptimizer/blob/master/LICENSE.md) are MIT; sample is an experimental Needle/Sunag fork branch, not an upstream Three.js release/package | Draco/other exact dependencies need review; bundled [Damaged Helmet](https://github.com/needle-tools/three.js/blob/feature/meshlet-creation-sample/examples/models/gltf/DamagedHelmet/README.md) is CC Attribution-NonCommercial and CoffeeMug provenance is not visible | Code extraction is conditional after commit pin, own assets, dependency closure and performance/security review. Demo bundle/assets are research only; never ship wholesale |
| Khronos Gaussian glTF | [official extension](https://github.com/KhronosGroup/glTF/blob/77b44be7bef26e01fb0b140e3d5bb1716421c5e9/extensions/2.0/Khronos/KHR_gaussian_splatting/README.md) | Release Candidate. The Khronos extension text is under `LicenseRef-KhronosSpecCopyright`: unmodified use/reproduction is permitted, but there is no patent, trademark or other IP grant in the text itself | implementation, payload and source-asset rights vary; adopter/conformance processes are separate | Feature-flagged adapter; do not copy/modify specification text casually or claim ratification/conformance |
| Basis Universal | [official repo](https://github.com/BinomialLLC/basis_universal) at `d77f9308e2d363c4a8b60d11be33e09a16290fe3`, [licence](https://github.com/BinomialLLC/basis_universal/blob/d77f9308e2d363c4a8b60d11be33e09a16290fe3/LICENSE) and [NOTICE](https://github.com/BinomialLLC/basis_universal/blob/d77f9308e2d363c4a8b60d11be33e09a16290fe3/NOTICE) | Apache-2.0 core with separately enumerated permissive dependencies; preserve licence/NOTICE and mark modified files | test images are expressly not owned by the project and have no blanket affirmative redistribution grant | Candidate encoder/transcoder code; exclude repository test assets and complete the exact dependency BOM |
| KTX-Software | [official repo](https://github.com/KhronosGroup/KTX-Software) at `78ad9c1d0e014d8958450fccbf750cd6793c3903` and [mixed licence notice](https://github.com/KhronosGroup/KTX-Software/blob/78ad9c1d0e014d8958450fccbf750cd6793c3903/LICENSE.md) | repository-owned files are generally Apache-2.0, but the default library build includes Ericsson's custom-licensed `external/etcdec/etcdec.cxx` with source-modification, use-field, patent-litigation and other restrictions | assets and other third-party files vary; repository metadata correctly reports no single licence | `needs_isolation`; do not treat the default whole source/binary as a generic Apache dependency. A restricted-file-free subset requires an exact build and legal review |
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
| XGRIDS Unreal SDK | [official repo](https://github.com/xgrids/LCC-Unreal-SDK); current v3.0.0 released 2026-07-15 at `1e974949a629711e0804e0ea9ef0482c0c8a23e0` | README-only public repository with no root LICENSE/SPDX commercial redistribution grant; the GitHub release has no SDK binary and the advertised Free/Pro download goes through the developer portal | LCC/LCC2/PLY/SOG/SPZ support claims do not grant payload, source-capture or redistribution rights | **Unknown / do not bundle** without written portal/binary terms. This replaces the stale v0.9.0 record |
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

### External desktop and cloud service contracts

| Product/service | Primary terms | Purpose boundary | Decision |
|---|---|---|---|
| RealityScan (formerly RealityCapture) | [official licensing](https://www.realityscan.com/license?lang=en-US) and [EULA](https://www.realityscan.com/eula?lang=en-US) | proprietary desktop reconstruction tool; current public pricing is free below the stated USD 1 million annual-revenue threshold and otherwise seat-based. The EULA restricts redistribution, third-party/SaaS access and reverse engineering; sample datasets are noncommercial | Optional external operator tool only. Never embed or expose it as a hosted super-app worker without custom terms; re-check the user's revenue/seat position and exact EULA before a real bake-off |
| RunPod service | [Terms of Service, last updated 2026-03-24](https://www.runpod.io/legal/terms-of-service) | provider may process customer content to operate the service and may use aggregated/anonymised content to improve services; customer retains ownership and remains responsible for content rights, backup and third-party marketplace terms | Conditional provider adapter after the account owner accepts current terms and an exact workload/data-region/retention decision is recorded. No credential or paid run is part of this review |
| Existing `infra/runpod/Dockerfile` | Local checked-in manifest | pins Open3D 0.18.0, pye57 0.4.16 and gsplat 1.5.3+pt24cu124, but installs SPZ and clones DN-Splatter from moving `main`; the whole base image/wheel/dependency/notice closure is not frozen | **Excluded from the T-534 candidate path.** Do not build, run, deploy or call it approved until every acquisition is immutable and the complete image BOM, notices, model/data and source rights are reviewed |
| Cloudflare R2 | [official R2 documentation](https://developers.cloudflare.com/r2/) and applicable [subscription terms](https://www.cloudflare.com/legal/terms/) | S3-compatible storage contract, not an open-source licence. Customer-content ownership and service obligations depend on the account agreement; object rights remain the customer's responsibility | Conditional storage adapter after exact account/agreement, location and source-asset permission are recorded |
| AWS EC2 | [AWS Customer Agreement](https://aws.amazon.com/agreement/) and [Service Terms](https://aws.amazon.com/service-terms/) | cloud compute contract, not an open-source dependency; marketplace images and software add their own terms | Conditional provider adapter only. No production account, spend or workload execution is authorised by this matrix |

## Navigation and crowd-motion support

| Component | Primary source/current status | Licence | Decision |
|---|---|---|---|
| Recast/Detour | [official repo](https://github.com/recastnavigation/recastnavigation) at `9f4ce64458dfae86e1239c525ddc219c4e9e06f1` and [licence](https://github.com/recastnavigation/recastnavigation/blob/main/License.txt) | zlib | Candidate deterministic navmesh/pathfinding code after exact pin and notice retention; generated routes are simulation support, not surveyed truth |
| RVO2 / ORCA | [official repo](https://github.com/snape/RVO2) at `b577921d2bc1281a6b721c2d4778f397d37da97d` and [licence](https://github.com/snape/RVO2/blob/main/LICENSE) | Apache-2.0 | Candidate local collision-avoidance code after exact dependency/notice closure; simulation output remains illustrative and assumption-bound |

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
