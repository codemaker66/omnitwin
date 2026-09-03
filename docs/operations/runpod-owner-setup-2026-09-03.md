# RunPod: what the owner sets up, and why this path

**Date:** 2026-09-03 · **For:** Blake · **Supersedes for now:** the R2-bucket-and-pod-template path in `infra/runpod/RUNBOOK.md` (kept for the day the Foundry control plane exists) · **Prices checked:** runpod.io/pricing and docs.runpod.io on 2026-09-03

## Why a network volume and an API key, not R2 and a template

The runbook's design pulls a dataset from Cloudflare R2 into an 80 GB container disk on every run. Today's datasets are bigger than that disk (the whole-hall trainer package alone is about 70 GB, the COLMAP dataset another 77 GB) and the work is iterative: several COLMAP runs, several training runs, comparisons against the vendor build. A network volume is uploaded once, outlives every pod, and is mounted by whichever GPU is available in its datacenter; an API key lets the agent create, monitor and stop pods itself; an SSH key lets it move data and drive the pod without the console. R2 stays optional until there is a control plane to consume its bundles.

## The five owner steps (about fifteen minutes)

1. **Credits.** Billing → Load credits. Suggested opening balance: **$150**. Reference prices (Community Cloud, per hour): A100 80 GB PCIe $1.19, H100 80 GB PCIe $1.99, H200 $3.59, L40S $0.79, RTX 4090 $0.34; Secure Cloud is 15 to 45 % more. A whole-hall COLMAP run is about an hour on an A100; a 30,000-step training run two to four hours; the storage below about $35 a month. The agent reports spend per run in `state/training_runs.jsonl`.
2. **API key.** Settings → API Keys → Create API Key, permission **All** (or Restricted with Read/Write on pods, volumes and GPU types). The key is shown once. Save it to `C:\Users\blake\deploy-secrets\runpod-api-key.txt` (the same folder and convention as the production database URL). Never paste it into chat; the agent reads the file into an environment variable and never prints it.
3. **SSH key.** Settings → SSH Public Keys → add this public key (generated on this machine on 2026-09-03; the private half stays in `C:\Users\blake\.ssh\omnitwin_runpod`):

   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEbrBk2Zr8vwv1C4FoRtiXKZZp8vbnIe02ay7YIL+0Fc omnitwin-runpod-2026-09
   ```

4. **Network volume.** Storage → Network Volumes → Create. Name `omnitwin-foundry`, size **500 GB**, tier **Standard** ($0.07/GB/month under 1 TB, so about $35 a month; size can grow, never shrink). Choose the datacenter by GPU availability: the create dialog lists what each datacenter offers, pick one showing **H100 80 GB or A100 80 GB available** (secure or community). The volume is locked to that datacenter; every pod that uses it must be deployed there, which the agent handles.
5. **Nothing else.** No pod template, no Docker Hub account, no R2 buckets for now: pods are created from RunPod's official PyTorch image with a start-up script that installs COLMAP (CUDA) and the pinned gsplat wheel, and the dataset goes up once over SSH to the volume.

**Progress on 2026-09-03:** step 2 done (the key is stored in `deploy-secrets` and answers read-only REST calls: no pods, one volume); step 4 done (`omnitwin-foundry`, 500 GB, datacenter EUR-IS-3, id `orf68cmk9p`). Open: step 1 (credits) and step 3 (the SSH key). The agent's next move once credits exist: a small test pod against the volume, stopped within minutes, then the upload.

## What the agent will then do with it

- Upload the whole-hall COLMAP dataset and trainer package to the volume (one-off, 150 GB; hours from a home connection, so it runs unattended).
- Re-run COLMAP with CUDA SIFT and matching on the pod: the hybrid CPU pipeline that takes fourteen hours here takes about one.
- Run the Config B training smoke, then the full 30,000-step run, then variants (fisheye virtual views versus pinhole-only, depth priors on and off), each with a signed bundle back on the volume and a row in `state/training_runs.jsonl`.
- Stop every pod when idle; the volume keeps the state.

## What still needs a written decision from the owner before training

The rights record (`D:\claude\colmap-gh\rights-record-DRAFT.json`), the governing policy for dispatch (runbook path or Foundry gate), and the spend cap. The credits step above is authorisation to spend; the rights and policy lines are in the T-572 report's last section.
