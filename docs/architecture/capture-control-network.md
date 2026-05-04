# Capture Control Network

Status: Active planning doctrine  
Date: 2026-05-01  
Source: CCN-001  
Depends on: D-010, D-011, D-014, D-015, D-024, T-091, T-116

## Purpose

Capture Control Network is Venviewer's doctrine for establishing metric, repeatable, inspectable spatial control for venue captures.

It unifies structured scan poses, Matterport sweep poses, fiducials, manual landmarks, control distances, COLMAP pose solves, TransformArtifacts, and capture-session metadata into one capture-control concept. The goal is not only to make assets line up visually. The goal is to know why they line up, which control source established the alignment, what residual error remains, and whether the result is strong enough for the intended capture certification tier.

Visual alignment is not enough for high-tier capture. If a mesh, splat, panorama, proxy asset, or runtime package is aligned only by eye, it must be labelled as visual alignment and treated as the lowest-confidence control source. It may be acceptable for appearance previews, but it is not sufficient for Black Label capture, survey-like claims, or load-bearing T-091B alignment evidence.

## Relationship to Existing Doctrine

- D-010 defines pose-frame indirection. Capture Control Network decides which pose/control sources are authoritative for a given capture and how they are compared.
- D-011 defines confidence bands. Control quality feeds those confidence bands.
- D-014 defines capture sessions and artifact bundles. Control observations and reports are capture-session artifacts.
- D-015 defines capture certification tiers. Higher tiers require stronger measured control and control QA evidence.
- D-024 defines TransformArtifactV0. Capture Control Network supplies the evidence and method behind load-bearing transforms.
- T-091B needs mesh/splat/runtime alignment proof. Capture Control Network is the planning doctrine for that proof path.

## Core Doctrine

Every production venue capture should have an explicit control network. A control network is the set of observations and transformations that ties raw capture products into the Canonical Venue Frame (CVF).

The network should answer:

- Which stations, sweeps, images, markers, landmarks, and distances were used?
- Which coordinate frames did they start in?
- Which transform maps each source into CVF or runtime frame?
- Which source has Pose Authority for each region or artifact?
- What residual errors, reprojection errors, or landmark deltas remain?
- Which assumptions, manual decisions, and reviewer approvals affect alignment?
- What becomes stale when the venue is recaptured or refreshed?

The network is evidence. It is not a rendering feature and it is not public marketing copy.

## Capture Control Sources

Initial supported source classes:

| Source | Meaning | Notes |
|---|---|---|
| `raw_structured_e57_poses` | Station poses stored in structured E57 data. | Preferred when present and internally consistent. Must preserve station IDs, frame, units, and extraction method. |
| `matterport_api_sdk_poses` | Sweep/camera poses exposed by Matterport API or SDK surfaces. | Useful when raw E57 station pose access is incomplete or when connecting panoramas/sweeps to Matterport-derived assets. |
| `colmap_poses` | COLMAP reconstructed camera poses from images or panorama-derived perspective views. | Strong visual geometry evidence when well constrained; weaker than measured control unless tied to metric references. |
| `apriltags` | Non-invasive AprilTag observations placed in venue-safe locations. | Good for repeatable station/image registration and annual refresh anchors when allowed by venue policy. |
| `charuco_boards` | ChArUco board observations for camera calibration and high-quality pose/control observations. | Useful for calibration sessions and controlled capture passes; operational practicality depends on venue permissions. |
| `manual_landmarks` | Human-picked correspondences such as corners, fireplace edges, door jambs, column centers, or fixture anchors. | Legitimate when recorded and reviewed; weaker than measured/fiducial control. |
| `control_distances` | Tape/laser/total-station distance checks between venue landmarks or marker positions. | Provides metric scale and sanity checks, especially for Pro3/Matterport captures. |
| `artist_blender_alignment_refs` | References used during Blender or artist-assisted alignment of proxy assets. | Valid for authored proxy placement when recorded as visual/manual alignment, not measurement-grade control. |
| `known_pose_colmap_model` | COLMAP reconstruction initialized or constrained by known camera/sweep/control poses. | Preferred over unconstrained COLMAP when E57, Matterport, or fiducial poses can seed or validate the solve. |

These source classes should become typed vocabulary before implementation. They are not DB schema in this doctrine.

## Authority Priority

Pose Authority is the selected control authority for a capture source, asset, region, or transform. It records which evidence source should be trusted first when sources disagree.

Default priority:

1. **Measured control / structured scan poses**  
   Raw structured E57 station poses, certified scanner registrations, total-station control, or equivalent measured control with units and residuals.

2. **Validated fiducial control**  
   AprilTag or ChArUco observations validated against control distances, measured landmarks, or structured scan poses.

3. **Manually picked landmarks**  
   Reviewed landmark correspondences with explicit source/target points, residuals where possible, and reviewer identity.

4. **COLMAP reconstructed poses**  
   SfM-derived pose graphs. Stronger when initialized or checked against measured/fiducial references; weaker when scale is unconstrained.

5. **Visual alignment only**  
   Eye-matched Blender/runtime placement, artist placement, or screenshot alignment without measured residual. This is the lowest-confidence source and cannot support high-tier capture claims by itself.

Authority priority can be overridden only by an explicit review record. For example, a malformed E57 pose export may be rejected in favour of fiducial or landmark control, but the rejection must be documented.

## Pose Authority

Pose Authority is not a single global flag for the venue. It can vary by:

- capture session
- station/sweep group
- asset type
- region
- TransformArtifact
- annual refresh pass

Examples:

- A broad room-shell mesh may use raw structured E57 poses as geometry Pose Authority.
- A chandelier proxy may use measured fixture anchor landmarks plus artist alignment references.
- A splat may use COLMAP poses for radiance training but be checked against E57/fiducial control before entering the runtime package.
- An annual refresh panorama set may use AprilTags and known landmarks to register into the previous CVF.

Truth Mode should expose Pose Authority to QA/hallkeeper users when alignment is relevant. Normal planners should see plain language such as "measured control", "fiducial checked", "landmark aligned", "COLMAP reconstructed", or "visually aligned only."

## TransformArtifact Integration

Every nontrivial transform used to move an asset between source frame, CVF, ARF, or RRF should have a TransformArtifactV0 record.

Capture Control Network supplies the TransformArtifact evidence:

- source control observations
- target frame
- units
- method
- 4x4 matrix
- residual RMSE where measurable
- landmark pairs or marker detections where applicable
- pose authority source
- capture session reference
- creator/reviewer/date
- stale conditions

`alignmentMethod` values should be precise enough to distinguish E57 extraction, Matterport pose extraction, fiducial solve, landmark solve, ICP, known-pose COLMAP, unconstrained COLMAP, and visual/manual alignment.

## T-091B Alignment

T-091B needs mesh and splat to align correctly with debug visualization and a target alignment threshold. Capture Control Network gives that milestone an evidence shape.

For T-091B, the runtime should eventually be able to show:

- which source established the mesh pose
- which source established the splat/camera poses
- which TransformArtifact maps each into CVF/RRF
- which landmarks or control points were used for comparison
- residual RMSE in metres where measurable
- whether any axis/scale/unit conversion was applied
- whether the alignment is measured, fiducial checked, landmark checked, COLMAP reconstructed, or visual-only

A visual overlay can demonstrate alignment, but it is not the whole proof. The QA report must preserve the control evidence behind the overlay.

## Truth Mode

Truth Mode should use Capture Control Network data to disclose alignment trust:

- measured control vs visual-only alignment
- current vs stale control
- contested or rejected pose sources
- fiducial/landmark residuals
- source frame and target frame for selected assets
- whether annual refresh data still matches the previous control network

Truth Mode must not collapse alignment trust into a single green badge. A region can have excellent appearance, weak metric control, and a manually reviewed proxy transform at the same time.

## Capture Certification

D-015 capture certification depends on control evidence.

Minimum posture:

- Bronze / appearance-only capture may rely on visual or SfM alignment if labelled honestly.
- Silver / Pro3 layout-grade capture should include control distances, structured E57 or Matterport pose inspection where available, and a control QA report.
- Gold / ops-grade capture requires stronger measured scanner registration or equivalent measured control.
- Black Label capture requires measured control strong enough to support the declared tier, reviewer accountability, and inspectable QA evidence. Visual alignment alone cannot contribute Black Label authority.

Public copy must not claim survey-grade or Black Label quality until the relevant control network, QA report, and capture certification evidence exist for that venue and capture session.

## Annual Refreshes

Annual or periodic refreshes should not start from scratch unless the venue has materially changed.

The refresh protocol should:

- reuse CVF from the prior accepted runtime package
- capture a small set of persistent landmarks or venue-safe fiducials
- compare new station/sweep/COLMAP poses against prior control
- record deltas and changed regions
- stale affected claims, transforms, evidence packs, and Scene Authority entries
- preserve the previous control network for audit

Refresh control is what lets Venviewer distinguish "the venue changed" from "the reconstruction drifted."

## Capture Session Metadata

A capture session that participates in the control network should record at least:

- capture session ID
- venue ID and space/region scope
- capture date/time and operator
- hardware and firmware/software versions
- raw asset references
- source frame declarations
- units
- station/sweep/image IDs
- marker kit ID or landmark set ID where applicable
- control distances
- environment notes that affect repeatability
- TransformArtifact references
- QA report reference
- reviewer and review status

This metadata belongs in future schemas/artifacts, not in this doctrine file.

## Control QA Report

Every production control network should be able to produce a control QA report.

The report should include:

- source inventory
- authority priority decision
- rejected or contested sources
- transform list
- residual metrics
- landmark/fiducial correspondence summary
- unit and axis conversion checks
- annual-refresh deltas if relevant
- confidence/certification implication
- reviewer sign-off or human-review requirement
- known limitations

The report is the bridge between capture operations and downstream trust surfaces.

## Guardrails

- Do not treat a rendered overlay as proof of alignment by itself.
- Do not treat unconstrained COLMAP scale as metric control without an external metric reference.
- Do not let Blender/manual placement silently become measurement authority.
- Do not mix E57, Matterport, COLMAP, Blender, and renderer frames without persisted TransformArtifacts.
- Do not allow capture certification tier language to outrun the control network.
- Do not hide failed or rejected pose sources; they are audit evidence.
- Do not use intrusive markers in heritage venues without venue approval and removal protocol.

## Non-Goals

- No E57 extraction implementation.
- No Matterport API/SDK integration.
- No AprilTag or ChArUco detection implementation.
- No COLMAP changes.
- No database tables.
- No runtime UI.
- No public copy changes.
- No package rename.
