# Photometric Chain-of-Custody for Fixed-Light Residual Capture

Status: Active planning doctrine  
Date: 2026-05-01  
Source: PCC-001  
Depends on: Residual Radiance Layer, RRL-001, D-014, D-024, Truth Mode Doctrine  
Relates to: Proof-of-Reality, Capture Control Network, Lighting Context Package

## Purpose

Fixed-light residual capture needs more than a folder of photos. It needs an accountable record of what light state was captured, how the camera was configured, which calibration frames exist, which images were used for training, which images were held out, and which frames were excluded.

A Photometric Chain-of-Custody record is the required evidence artifact for any serious fixed-light Residual Radiance Layer evaluation. It makes appearance capture repeatable, reviewable, and falsifiable.

This doctrine does not implement capture tooling. It defines the record Venviewer should require before treating fixed-light residual evaluation as evidence.

## Production Boundary

Existing Matterport data is acceptable for pipeline bootstrap.

It can help validate ingestion, pose handling, rough appearance experiments, and early T-091/T-091B/T-091C readiness. It is not enough by itself for serious Residual Radiance evaluation because the lighting state, exposure settings, white balance, calibration frames, and holdout discipline may be incomplete or unavailable.

Serious residual evaluation requires a fixed-light controlled capture with a Photometric Chain-of-Custody record.

For practical execution, the Photometric Chain-of-Custody should be packaged as an Appearance Capture QA Pack. The QA Pack is the reviewable bundle of calibration frames, grey card/ColorChecker evidence, flicker test, train/holdout/challenge split, raw hashes, exclusions, and known issues used to decide whether an appearance capture is fit for residual evaluation.

## Required Fields

Every fixed-light residual capture should record:

- `captureSessionId`
- `zoneId`
- `lightingStateLabel`
- `cameraBody`
- `lens`
- `focalLength`
- `shutter`
- `aperture`
- `iso`
- `whiteBalance`
- `focusMode`
- `rawJpegStatus`
- `greyCardFrames`
- `colorCheckerFrames`
- `flickerTest`
- `calibrationStartFrames`
- `calibrationEndFrames`
- `trainImageList`
- `holdoutImageList`
- `challengeHoldouts`
- `rawFileHashes`
- `operator`
- `knownIssues`
- `excludedFrames`
- `excludedFrameReasons`

Field names can be refined during schema work, but the information cannot be dropped.

## Lighting State

`lightingStateLabel` names the controlled lighting condition.

Examples:

- `grand_hall_daylight_chandeliers_off`
- `grand_hall_daylight_chandeliers_on`
- `grand_hall_evening_chandeliers_on`
- `fireplace_zone_fixed_daylight`

The label should not be vague. If house lights, chandeliers, uplighting, stage lights, blinds, curtains, or daylight state matter, record them in the label or in structured notes.

## Camera and Calibration Discipline

Camera settings should be recorded once per capture block and overridden per frame only when they actually change.

The record should preserve:

- exposure settings: shutter, aperture, ISO
- optical state: camera body, lens, focal length, focus mode
- color state: white balance, RAW/JPEG status, grey card frames, ColorChecker frames
- temporal/light stability: flicker test, calibration start/end frames

Grey card and ColorChecker frames exist to make color/white-balance assumptions inspectable. Calibration start/end frames catch lighting drift and accidental camera-setting changes.

## Train, Holdout, and Challenge Sets

Holdouts must never be trained on.

The record must distinguish:

- `trainImageList`: images allowed for training/fitting.
- `holdoutImageList`: normal evaluation images never used for training.
- `challengeHoldouts`: deliberately difficult views, lighting transitions, specular surfaces, insertion-object-adjacent crops, or hero fixture angles.

If an image moves from holdout to training, all prior evaluation that used it as holdout is invalidated or must be clearly superseded.

Challenge holdouts should be chosen before training starts. They exist to prevent the residual from looking good only on easy views.

## Appearance Capture QA Pack

An Appearance Capture QA Pack should contain:

- Photometric Chain-of-Custody record
- grey card frames
- ColorChecker frames
- flicker test result
- calibration start/end frames
- train image list
- holdout image list
- challenge holdout list
- raw file hash manifest
- excluded frame list and reasons
- operator notes
- known issues
- review recommendation: usable, degraded, needs recapture, or rejected

The QA Pack is internal/expert evidence. It is not public marketing proof and it is not a claim that the venue has not changed since capture.

## Raw File Hashes

`rawFileHashes` are required for accountability.

The hash record should include:

- source filename or capture ID
- SHA-256 or another project-approved digest
- byte size
- capture timestamp where available
- RAW/JPEG status
- whether the file is train, holdout, challenge holdout, calibration, grey card, ColorChecker, excluded, or unused

Derived images, rectified frames, crops, masks, and converted formats should eventually cite the raw source hash that produced them.

## Excluded Frames

Excluded frames are not failures. Hidden exclusions are failures.

The record should list excluded frames and reasons such as:

- motion blur
- exposure mismatch
- focus miss
- person/staff occlusion
- camera shake
- lighting changed
- duplicate frame
- reflection or mirror contamination
- outside selected zone
- pose failure
- calibration target obstructed

Residual evaluation should report whether exclusions materially bias the train/holdout set.

## Integration With Residual Radiance Evaluation

Residual Radiance experiments should cite the Photometric Chain-of-Custody record in:

- input manifest
- training logs
- train/holdout split report
- metrics report
- challenge holdout report
- residual energy and semantic leakage diagnostics
- object insertion evaluation
- promote/revise/defer/reject decision

RRL metrics are not meaningful unless the train/holdout boundary and lighting state are known.

## Integration With Truth Mode

Truth Mode should eventually disclose:

- whether residual appearance came from controlled fixed-light capture or bootstrap Matterport data
- lighting state label
- capture session ID
- calibration completeness
- holdout discipline
- known issues and excluded-frame summary
- whether residual evidence is current, stale, partial, or requires review

Normal users do not need raw camera settings by default. QA/expert views should expose the full chain-of-custody record.

## Integration With Proof-of-Reality

Photometric Chain-of-Custody supports Proof-of-Reality for appearance evidence.

It does not prove the physical world has not changed since capture. It proves the project can account for the capture inputs, lighting state, camera/calibration settings, train/holdout split, raw file hashes, exclusions, and known issues used for a residual evaluation.

## Staleness

Residual capture evidence becomes stale or invalid for a given evaluation when:

- lighting state changes without a new capture session
- camera settings change unexpectedly
- calibration frames are missing or inconsistent
- holdout images are used for training
- Appearance Capture QA Pack is incomplete or rejected
- raw file hashes do not match
- excluded-frame reasons are missing or suspect
- the zone definition changes
- the mesh/runtime package used for evaluation changes
- known issues affect the measured metric or visual claim

## Non-Goals

- No capture-tooling implementation.
- No hash-tool implementation.
- No camera SDK dependency.
- No training pipeline change.
- No public copy change.
- No package rename.
