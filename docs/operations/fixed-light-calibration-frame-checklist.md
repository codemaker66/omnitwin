# Fixed-Light Calibration Frame Checklist

Status: operator checklist. This document does not prove that any room asset has
been processed, reviewed, signed, or loaded in Venviewer.

Last updated: 2026-06-07

## Purpose

Use this checklist when capturing fixed-light images for Residual Radiance Layer
evaluation or an Appearance Capture QA Pack.

The goal is to make the capture repeatable, reviewable, and falsifiable before
any training, residual evaluation, or runtime package registration starts. The
checklist records the calibration frames, lighting state, camera settings,
holdout discipline, raw-file accountability, and operator signoff required by
the Photometric Chain-of-Custody doctrine.

This is an internal operator document. It is not public marketing copy, it does
not certify the venue condition, and it does not mark T-091 or T-091A done.

## Use This Before

- fixed-light residual experiments
- Appearance Capture QA Pack review
- RRL-001 zone input freeze
- residual train/holdout/challenge split creation
- raw-file hash manifest creation

Do not use this checklist as a substitute for a real AssetVersion,
RuntimePackage, signed manifest, or visual review.

## Capture Session Header

Fill this before taking images.

- [ ] `captureSessionId`:
- [ ] `venueSlug`:
- [ ] `roomSlug`:
- [ ] `zoneId`:
- [ ] capture date:
- [ ] operator:
- [ ] assistant or reviewer:
- [ ] capture device:
- [ ] camera body:
- [ ] lens:
- [ ] file format: RAW, JPEG, or RAW+JPEG
- [ ] source storage location:
- [ ] planned output storage location:
- [ ] notes file location:

Stop if the room, zone, operator, camera, or source storage location is unknown.

## Lighting State Lock

Record one lighting state per capture block. Start a new block if the light
state changes.

- [ ] `lightingStateLabel` is specific and stable.
- [ ] daylight state recorded: none, low, mixed, or dominant.
- [ ] chandeliers recorded: off, on, dimmed, or mixed.
- [ ] house lights recorded: off, on, dimmed, or mixed.
- [ ] uplighting or stage lighting recorded.
- [ ] blinds, curtains, doors, and obvious reflective surfaces recorded.
- [ ] any temporary practical lights recorded.
- [ ] operator confirms nobody intentionally changed lighting during the block.
- [ ] known unavoidable lighting drift is written down.

Good lighting labels include room, time/light condition, and fixture state, for
example `grand_hall_daylight_chandeliers_off`.

Stop if the lighting state cannot be described clearly enough for a future
reviewer to reproduce or reject it.

## Camera Setting Lock

Record the default settings once per block and override per frame only when the
setting changes.

- [ ] shutter speed:
- [ ] aperture:
- [ ] ISO:
- [ ] focal length:
- [ ] focus mode:
- [ ] focus distance if available:
- [ ] white balance mode:
- [ ] white balance Kelvin if fixed:
- [ ] exposure mode:
- [ ] image stabilization state:
- [ ] tripod or handheld:
- [ ] bracket/HDR mode:
- [ ] noise reduction or in-camera processing:
- [ ] color profile:
- [ ] time sync checked where possible.

Stop if exposure, white balance, or focus mode changes without a recorded reason.

## Start Calibration Frames

Capture these before the main image set for each lighting state.

- [ ] grey card frame at representative room exposure.
- [ ] grey card frame near the selected zone.
- [ ] ColorChecker frame at representative room exposure.
- [ ] ColorChecker frame near the selected zone.
- [ ] calibration-wide room context frame.
- [ ] close zone context frame.
- [ ] focus/exposure sanity frame.
- [ ] optional lens chart or straight-edge frame if distortion is a concern.

For each frame, record:

- [ ] filename or capture ID
- [ ] frame role
- [ ] camera position note
- [ ] lighting state label
- [ ] whether it can be used for calibration, review only, or exclusion

Stop if the grey card or ColorChecker is missing for the lighting state unless
the exception is explicitly recorded in the capture notes.

## Flicker Test

Run this before the main image set when artificial lights are active or mixed
with daylight.

- [ ] capture a short video or burst sequence under the target lighting state.
- [ ] include the main fixtures affecting the zone.
- [ ] record frame rate or burst cadence.
- [ ] record shutter speed used.
- [ ] note visible banding, pulsing, dimmer cycling, or color shifts.
- [ ] store the flicker test file with the capture session.
- [ ] mark whether flicker is absent, present, uncertain, or not checked.

Stop if visible flicker is present and the experiment depends on stable
appearance, unless the capture lead records why the block is still worth keeping
for research comparison.

## Main Capture Discipline

During the main capture block:

- [ ] keep one lighting state per block.
- [ ] keep one camera-setting family per block.
- [ ] capture enough overlap for pose recovery or alignment review.
- [ ] include 8-12 or more usable training views for the selected zone when possible.
- [ ] include 3-5 or more holdout views when possible.
- [ ] include challenge holdouts before training starts.
- [ ] include at least one object-insertion-adjacent view if RRL-001 editability is being tested.
- [ ] avoid moving furniture or props unless the movement is part of a separate recorded block.
- [ ] record any staff/person occlusion.
- [ ] record any camera shake, focus miss, glare, reflection, or blocked target.

Holdout and challenge views must be chosen before training starts. If a holdout
image later moves into training, prior metrics that used it as holdout are stale
or superseded.

## End Calibration Frames

Capture these immediately after the main image set for each lighting state.

- [ ] grey card frame at representative room exposure.
- [ ] grey card frame near the selected zone.
- [ ] ColorChecker frame at representative room exposure.
- [ ] ColorChecker frame near the selected zone.
- [ ] calibration-wide room context frame.
- [ ] close zone context frame.
- [ ] repeat focus/exposure sanity frame.
- [ ] record whether start/end calibration appears consistent.

Stop if start and end calibration disagree materially and the difference cannot
be explained.

## Raw File Preservation

Before any processing, conversion, or cleanup:

- [ ] raw capture copied to primary storage.
- [ ] raw capture backed up to a second location.
- [ ] source directory is read-only or otherwise protected from accidental edits.
- [ ] no raw capture has been deleted.
- [ ] no processed export replaces the raw capture.
- [ ] filenames or capture IDs are preserved.
- [ ] obvious duplicate imports are noted, not silently removed.
- [ ] raw-file hash step is scheduled before training.

The future raw-file hash manifest should record filename or capture ID, SHA-256,
byte size, capture timestamp where available, file format, and frame role.

## Frame Role Review

Create an initial list for each frame role.

- [ ] calibration start frames
- [ ] calibration end frames
- [ ] grey card frames
- [ ] ColorChecker frames
- [ ] flicker test files
- [ ] training image candidates
- [ ] holdout image candidates
- [ ] challenge holdout candidates
- [ ] excluded frames
- [ ] unused but retained frames

No frame may be in both training and holdout. No excluded frame may be used for
training, holdout, or challenge evaluation unless the exclusion is explicitly
removed with a dated note.

## Excluded Frame Log

Excluded frames are acceptable. Hidden exclusions are not.

For every excluded frame, record the filename or capture ID and at least one
reason:

- [ ] motion blur
- [ ] exposure mismatch
- [ ] focus miss
- [ ] person or staff occlusion
- [ ] camera shake
- [ ] lighting changed
- [ ] duplicate frame
- [ ] reflection or mirror contamination
- [ ] outside selected zone
- [ ] pose failure
- [ ] calibration target obstructed
- [ ] other, with note:

Review whether exclusions bias the train/holdout/challenge split. If they do,
record that risk before any residual evaluation.

## Operator Signoff

Complete this before the capture session is treated as an input to residual
work.

- [ ] capture session header complete.
- [ ] lighting state labels complete.
- [ ] camera settings complete.
- [ ] start calibration frames present.
- [ ] end calibration frames present.
- [ ] flicker test present or explicitly not checked.
- [ ] raw files preserved and backed up.
- [ ] frame roles drafted.
- [ ] holdout and challenge candidates drafted before training.
- [ ] exclusion reasons recorded.
- [ ] known issues recorded.
- [ ] operator has not represented the capture as a published runtime asset.
- [ ] reviewer has enough information to accept, degrade, request recapture, or reject the QA Pack.

Operator:

Date:

Reviewer:

Review date:

## Stop Conditions Before Training

Do not start serious residual training or evaluation if any of these are true:

- lighting state is vague or changed without notes
- camera settings are missing or changed without notes
- grey card or ColorChecker evidence is missing for the block
- start/end calibration suggests untracked drift
- holdout or challenge frames are not frozen
- raw files are not backed up
- raw hashes are unavailable when the evaluation needs immutable source evidence
- excluded-frame reasons are missing
- zone definition is unstable
- transform or mesh inputs are not ready for the selected zone

Bootstrap experiments may continue only when labelled as bootstrap work and kept
out of public claims and runtime AssetVersion promotion.

## Handoff To Future Steps

After this checklist is complete:

1. Create the raw-file hash manifest.
2. Freeze train, holdout, and challenge lists.
3. Create the residual capture session manifest.
4. Attach this checklist to the Appearance Capture QA Pack.
5. Review the QA Pack before any residual metrics are interpreted.
6. Register AssetVersion and RuntimePackage records only when real processed
   outputs exist with R2 keys, SHA-256 values, file sizes, and review notes.

This checklist does not load assets in the web runtime. Runtime loading remains
owned by the AssetVersion / RuntimePackage workflow.
