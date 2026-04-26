"""Venviewer trainer-side utilities.

This package contains the modules invoked on a RunPod A100 pod to
train a Gaussian splat for a venue. It is import-only on the pod;
nothing here is shipped into the runtime web app or API.

Operational procedure: infra/runpod/RUNBOOK.md
Bundle format spec:    docs/specs/runpod-training-contract.md
ADRs:                  D-006a (trainer choice), D-014 (boundary), D-016 (RunPod canonical)
"""

__version__ = "0.1.0"
