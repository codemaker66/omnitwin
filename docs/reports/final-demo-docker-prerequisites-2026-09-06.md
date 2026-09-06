# Final demo Docker prerequisites — 6 September 2026

This isolated follow-up to `b0477037` supplies the existing composed Spark patch
to both Docker stages that invoke pnpm, and changes the Node image default from
22.12.0 to the repository's verified minimum, 22.18.0. pnpm stays at 9.15.4.
Runtime ownership, health checks, deployment conditions and build provenance are
unchanged. The active demo checkout and its running services were not edited.

The missing patch was reproduced through real pnpm 9.15.4, without Docker or a
dependency install: materializing the dependency stage's actual COPY inputs and
running `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts`
failed with ENOENT for the declared Spark patch. The same command passes after
the added COPY, using a separate fresh directory. The build stage also receives
patches before `pnpm --prod deploy`, which reads the same manifest/lockfile.

Three built-in Node regressions pass with
`node --test tools/deployment/docker-prerequisites.test.mjs`: the image default
matches the current engine minimum, and all declared patches are available at
each relevant pnpm boundary. They inspect the current literal COPY grammar and
do not pretend to implement a Docker engine. Independent source review found no
material issue and confirmed the ignore files leave the patch available.

Evidence is preserved under `D:/claude/venviewer-final-demo-20260906`:
`docker-deps-baseline.log`, `docker-deps-fixed.log`, their input manifests,
`docker-prerequisites-tests.log`, and `docker-version.json`. No dependencies,
production credentials, production data or running services were changed by
these checks.

A real Linux image build is still required before API publication. Docker client
29.4.3 is installed, but the configured Docker Desktop Linux daemon is unavailable
(its named pipe does not exist). The successful Windows pnpm/context checks do
not qualify Alpine/native dependencies, the image build or its production boot.
No image, release, resource, migration or deployment was created. Migration 0064,
production authentication/build variables, freeze approval and final publication
checks remain separate release requirements; this commit grants no release
authority.
