// Railway's settings for the Venviewer API, in Railway's new format.
//
// This file declares how Railway builds and runs the one service in the
// project: the API. `railway config plan` compares it with the settings Railway
// has stored and prints the difference. `railway config apply` writes that
// difference to production. Railway itself never reads this folder when it
// deploys. See README.md beside this file.
//
// Until railway.json is deleted, both files hold the same values. While
// railway.json exists, Railway reads it on every deploy, so change the two
// together. A CI step fails if their watch lists differ.
//
// A setting changes only by a reviewed pull request, and then a reviewed apply
// from a pinned plan, with the founder's yes at that moment.
//
// This file describes the whole project. A resource added on Railway's
// dashboard (a worker, a database) must be added here first, or the next plan
// will show it as a deletion.
import { defineRailway, github, project, service } from "railway/iac";
// The paths whose change makes Railway rebuild the API: one list, also read by
// .github/workflows/production-receipt.yml and checked against railway.json by
// .github/workflows/ci.yml.
import watchPatterns from "./watch-patterns.json" with { type: "json" };

export default defineRailway(() => {
  const api = service("@omnitwin/api", {
    source: github("codemaker66/omnitwin", { branch: "master", checkSuites: false }),
    build: {
      // Stored on Railway today. A Dockerfile build runs its own steps, so it
      // is not used, but leaving it out here would clear it.
      buildCommand: "pnpm --filter @omnitwin/api build",
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      watchPatterns,
    },
    // Keep --conditions=omnitwin-dist: without it the foundry packages resolve
    // to TypeScript source and the API cannot start.
    start: "node --conditions=omnitwin-dist dist/index.js",
    healthcheck: "/health/ready",
    // In seconds: long enough for CI and the Deploy workflow's migration pass.
    healthcheckTimeout: 2700,
    // The migration gate, run inside the built image before traffic moves.
    preDeploy: "node --conditions=omnitwin-dist dist/scripts/migrate-before-deploy.js",
    // One replica, in the one region. Railway stores this as a region map.
    replicas: { "europe-west4-drams3a": 1 },
    deploy: {
      preDeployTimeoutSeconds: 900,
      drainingSeconds: 30,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
      sleepApplication: false,
    },
    // The port is written out: a domain given without one defaults to 8080.
    domains: [{ domain: "api.venviewer.com", port: 3000 }],
    // The private-network name is left out on purpose. Railway's plan shows no
    // change without it, and an internal host name does not belong in a
    // public repository.
  });

  return project("bubbly-solace", {
    // Variables stay on Railway. With this, the tool writes none of them, and
    // none can be committed here.
    variables: { managed: false },
    resources: [api],
  });
});
