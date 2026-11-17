# Railway settings

`railway.ts` declares how Railway builds and runs the API, in Railway's new
format. `watch-patterns.json` is the list of paths whose change makes Railway
rebuild the API. Why this folder exists, and how the move away from
`railway.json` is done: [the Railway config move](../docs/operations/railway-config-move.md).

## Install the kit

From this folder:

```bash
npm ci --ignore-scripts
```

This installs Railway's TypeScript kit (`railway`) at the version pinned in
`package-lock.json`, without running any package's install script: the kit
needs none, and a script brought in by a later version would otherwise run on
your machine. `node_modules` is ignored by git.

Railway's command-line tool is not pinned here, on purpose: pinning it would
put its installer's dependencies into this public repository's lockfile. Use a
Railway command-line tool of version 5.42.1 or newer, installed outside the
repository. This file was planned with 5.74.0; say which version you used when
you record a plan.

This folder is not part of the pnpm workspace. Never add it to
`pnpm-workspace.yaml` or the kit to the root `package.json`: both are watched
paths, so either change deploys production, and the first also breaks the
image build.

## Preview

```bash
railway config plan
```

`plan` only reads. It prints what Railway has stored next to what `railway.ts`
says, and changes nothing. It needs the tool signed in and linked to the
project.

Under Git Bash on Windows, run the tool's own program file directly, not
through `timeout` or an npm shim: the kit finds the tool through the `_`
environment variable and refuses to run if it cannot.

## Apply

Applying changes production and most likely redeploys the API.

- Only from a pinned plan: `railway config plan --json --out <file>`, read it,
  then `railway config apply --plan <file> --yes`. Keep the plan file outside
  the repository. A pinned plan also pins this whole folder, so nothing that
  changes `.railway/` may merge between the plan and the apply.
- Only with the founder's yes at that moment, with the plan in front of him.
- Never pass `--confirm-destructive`. Without it the tool refuses any deletion.
  If a plan shows one, stop.
- Never pass `--show-values`, `--decrypt-variables` or `--include-variables`.
- Afterwards, `railway config plan --detailed-exit-code` must exit 0.

## Variables

Variables are not managed here (`variables: { managed: false }`). They stay on
Railway. Never write a Railway variable's name or value in this folder.

## The watch list

The paths live in one place, `watch-patterns.json`. It is read by:

- `railway.ts`;
- `.github/workflows/production-receipt.yml`, which falls back to
  `railway.json` for commits older than this file;
- a step in `.github/workflows/ci.yml`, which fails while `railway.json`
  exists and its list differs.

`/.railway/**` is not a watched path. Railway does not read this folder when it
deploys and the image does not contain it, so a change here makes Railway
deploy nothing. (Vercel still republishes the web on every merge to master, as
for any pull request.) A settings change takes effect only through `apply`.
