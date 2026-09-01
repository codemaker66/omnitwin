**Read this when:** editing `Dockerfile`, changing the pnpm or Node version
the API image uses, or debugging a Railway build that fails inside
`pnpm install` with a pnpm error the pinned version cannot produce.

# A Dockerfile `ARG` declared before `FROM` is empty inside every stage

`ARG PNPM_VERSION=9.15.4` at the top of the file is visible only to `FROM`
lines. Inside a stage, `${PNPM_VERSION}` expands to nothing unless the stage
re-declares it with a bare `ARG PNPM_VERSION` after its `FROM`. The API image
therefore ran `npm install -g pnpm@` — the latest pnpm on the day — from the
commit that introduced the pin (b39a6ae6) until 2026-09-02, when the latest
became pnpm 11 and it refused our 9.15.4 lockfile with
`ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE` ("@pnpm/exe.linux-x64 ... missing
from pnpm-lock.yaml"). Production was never at risk: Railway's health gate
kept the old image serving.

Rules:

- Every stage that uses a top-level `ARG` re-declares it right after `FROM`.
- `NODE_VERSION` was never affected because it is used only in `FROM`.
- Docker Desktop is rarely running on this machine, so the Railway build is
  the gate for a Dockerfile change: watch `railway logs --build <id>` for the
  `[deps 13/13] RUN pnpm install` line and confirm the pnpm version it prints.
- The deploy checklist (`docs/operations/diary-deploy-checklist.md` §5) is the
  procedure; the D: worktree recipe in its §2 spares the nearly full C: drive.
