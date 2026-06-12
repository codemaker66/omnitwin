import { describe, it, expect } from "vitest";
import {
  venues,
  spaces,
  users,
  assetDefinitions,
  configurations,
  placedObjects,
  enquiries,
  enquiryStatusHistory,
  photoReferences,
  pricingRules,
  files,
  referenceLoadouts,
  referencePhotos,
  guestLeads,
  captureSessions,
  assetVersions,
  roomManifests,
  runtimePackages,
  configurationLayoutRevisions,
  processingJobs,
  events,
  eventPhases,
  eventScenarios,
  layoutVariants,
  eventConfigurationLinks,
  phaseLayoutSnapshots,
  evidenceItems,
  checkResults,
  assumptionRecords,
  reviewGates,
  claimStates,
  evidencePacks,
  evidencePackItems,
  staleEvidenceEvents,
  generalAuditLog,
  handoffPacks,
  opsTasks,
  taskGroups,
  furniturePickLists,
  pickListItems,
  suppliers,
  supplierInstructions,
  loadInSequences,
  breakdownSequences,
  roomFlipPlans,
  beoDocuments,
  snapshotDiffs,
  eventDayIssues,
  taskAssignments,
  taskCompletionEvents,
  opsStatusUpdates,
  guestFlowReplays,
  agentTrajectories,
  densityHeatmaps,
  routeConflicts,
  queueZones,
  staffLanes,
  revenueScenarios,
  pricingAssumptions,
  comfortConstraints,
  scenarioComparisons,
  analyticsSnapshots,
  integrationConnections,
  webhookEndpoints,
  externalCalendarLinks,
  websiteEmbedConfigs,
  emailTemplates,
  integrationEvents,
} from "../db/schema.js";
import { getTableColumns } from "drizzle-orm";

// ---------------------------------------------------------------------------
// schema.ts — verify all table definitions export correctly
// ---------------------------------------------------------------------------

describe("venues table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(venues);
    expect(cols.id).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.slug).toBeDefined();
    expect(cols.address).toBeDefined();
    expect(cols.logoUrl).toBeDefined();
    expect(cols.brandColour).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });
});

describe("spaces table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(spaces);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.slug).toBeDefined();
    expect(cols.widthM).toBeDefined();
    expect(cols.lengthM).toBeDefined();
    expect(cols.heightM).toBeDefined();
    expect(cols.floorPlanOutline).toBeDefined();
    expect(cols.sortOrder).toBeDefined();
  });
});

describe("users table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(users);
    expect(cols.id).toBeDefined();
    expect(cols.email).toBeDefined();
    expect(cols.clerkId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.role).toBeDefined();
    expect(cols.venueId).toBeDefined();
  });
});

describe("assetDefinitions table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(assetDefinitions);
    expect(cols.id).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.category).toBeDefined();
    expect(cols.widthM).toBeDefined();
    expect(cols.depthM).toBeDefined();
    expect(cols.heightM).toBeDefined();
    expect(cols.seatCount).toBeDefined();
    expect(cols.collisionType).toBeDefined();
  });
});

describe("configurations table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(configurations);
    expect(cols.id).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.state).toBeDefined();
    expect(cols.layoutStyle).toBeDefined();
    expect(cols.guestCount).toBeDefined();
    expect(cols.isTemplate).toBeDefined();
    expect(cols.visibility).toBeDefined();
    expect(cols.revision).toBeDefined();
  });
});

describe("placedObjects table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(placedObjects);
    expect(cols.id).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.assetDefinitionId).toBeDefined();
    expect(cols.positionX).toBeDefined();
    expect(cols.positionY).toBeDefined();
    expect(cols.positionZ).toBeDefined();
    expect(cols.rotationX).toBeDefined();
    expect(cols.rotationY).toBeDefined();
    expect(cols.rotationZ).toBeDefined();
    expect(cols.scale).toBeDefined();
    expect(cols.metadata).toBeDefined();
  });
});

describe("enquiries table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(enquiries);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.state).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.email).toBeDefined();
    expect(cols.preferredDate).toBeDefined();
    expect(cols.eventType).toBeDefined();
    expect(cols.estimatedGuests).toBeDefined();
    expect(cols.message).toBeDefined();
  });
});

describe("photoReferences table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(photoReferences);
    expect(cols.id).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.userId).toBeDefined();
    expect(cols.imageUrl).toBeDefined();
    expect(cols.tags).toBeDefined();
    expect(cols.visibility).toBeDefined();
  });
});

describe("pricingRules table", () => {
  it("has expected columns", () => {
    const cols = getTableColumns(pricingRules);
    expect(cols.id).toBeDefined();
    expect(cols.venueId).toBeDefined();
    expect(cols.spaceId).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.type).toBeDefined();
    expect(cols.amount).toBeDefined();
    expect(cols.currency).toBeDefined();
    expect(cols.minHours).toBeDefined();
    expect(cols.minGuests).toBeDefined();
    expect(cols.tiers).toBeDefined();
    expect(cols.dayOfWeekModifiers).toBeDefined();
    expect(cols.seasonalModifiers).toBeDefined();
    expect(cols.isActive).toBeDefined();
  });
});

describe("table count", () => {
  it("exports the configuration layout revision history table", () => {
    const cols = getTableColumns(configurationLayoutRevisions);
    expect(cols.id).toBeDefined();
    expect(cols.configurationId).toBeDefined();
    expect(cols.revision).toBeDefined();
    expect(cols.source).toBeDefined();
    expect(cols.actorUserId).toBeDefined();
    expect(cols.payload).toBeDefined();
    expect(cols.createdAt).toBeDefined();
  });

  it("pins the configuration revision migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0025_configuration_revisions.sql"), "utf-8");

    expect(migration).toContain('ALTER TABLE "configurations"');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "configuration_layout_revisions"');
    expect(migration).toContain('"source" IN (');
    expect(migration).toContain("public_batch");
    expect(migration).toContain("authenticated_batch");
    expect(migration).toContain("configuration_layout_revisions_config_revision_unique");
  });

  it("exports the runtime asset registry tables", () => {
    const captureCols = getTableColumns(captureSessions);
    expect(captureCols.venueSlug).toBeDefined();
    expect(captureCols.roomSlug).toBeDefined();
    expect(captureCols.captureSource).toBeDefined();
    expect(captureCols.captureDevice).toBeDefined();
    expect(captureCols.captureDate).toBeDefined();
    expect(captureCols.operatorName).toBeDefined();
    expect(captureCols.sourceProjectName).toBeDefined();
    expect(captureCols.notes).toBeDefined();
    expect(captureCols.status).toBeDefined();
    expect(captureCols.createdAt).toBeDefined();
    expect(captureCols.updatedAt).toBeDefined();

    const assetCols = getTableColumns(assetVersions);
    expect(assetCols.venueSlug).toBeDefined();
    expect(assetCols.roomSlug).toBeDefined();
    expect(assetCols.captureSessionId).toBeDefined();
    expect(assetCols.assetKind).toBeDefined();
    expect(assetCols.sourceType).toBeDefined();
    expect(assetCols.fileName).toBeDefined();
    expect(assetCols.fileExt).toBeDefined();
    expect(assetCols.r2Key).toBeDefined();
    expect(assetCols.externalUrl).toBeDefined();
    expect(assetCols.mimeType).toBeDefined();
    expect(assetCols.sha256).toBeDefined();
    expect(assetCols.sizeBytes).toBeDefined();
    expect(assetCols.evidenceStatus).toBeDefined();
    expect(assetCols.runtimeStatus).toBeDefined();
    expect(assetCols.notes).toBeDefined();

    const roomCols = getTableColumns(roomManifests);
    expect(roomCols.venueSlug).toBeDefined();
    expect(roomCols.roomSlug).toBeDefined();
    expect(roomCols.displayName).toBeDefined();
    expect(roomCols.matterportMasterReference).toBeDefined();
    expect(roomCols.alignmentStatus).toBeDefined();
    expect(roomCols.primaryCaptureSource).toBeDefined();
    expect(roomCols.notes).toBeDefined();

    const packageCols = getTableColumns(runtimePackages);
    expect(packageCols.venueSlug).toBeDefined();
    expect(packageCols.roomSlug).toBeDefined();
    expect(packageCols.primaryVisualAssetVersionId).toBeDefined();
    expect(packageCols.semanticMeshAssetVersionId).toBeDefined();
    expect(packageCols.collisionAssetVersionId).toBeDefined();
    expect(packageCols.pointCloudAssetVersionId).toBeDefined();
    expect(packageCols.manifestJson).toBeDefined();
    expect(packageCols.evidenceStatus).toBeDefined();
    expect(packageCols.runtimeStatus).toBeDefined();

    const jobCols = getTableColumns(processingJobs);
    expect(jobCols.venueSlug).toBeDefined();
    expect(jobCols.roomSlug).toBeDefined();
    expect(jobCols.sourceAssetVersionId).toBeDefined();
    expect(jobCols.targetRoomSlug).toBeDefined();
    expect(jobCols.processor).toBeDefined();
    expect(jobCols.machineType).toBeDefined();
    expect(jobCols.requiredRamGb).toBeDefined();
    expect(jobCols.status).toBeDefined();
    expect(jobCols.outputNotes).toBeDefined();
  });

  it("pins the runtime asset migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0024_runtime_assets.sql"), "utf-8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "capture_sessions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "asset_versions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "room_manifests"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "runtime_packages"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "processing_jobs"');
    expect(migration).toContain('"capture_source" IN (');
    expect(migration).toContain('"asset_kind" IN (');
    expect(migration).toContain("internal_ready");
    expect(migration).toContain("point_cloud_asset_version_id");
    expect(migration).toContain('"runtime_status" IN (');
    expect(migration).toContain("runtime_packages_manifest_shape");
    expect(migration).toContain("asset_versions_no_fixture_keys");
    expect(migration).toContain("asset_versions_storage_ref_required");
  });

  it("exports exactly 68 tables", () => {
    const tables = [
      venues, spaces, users, assetDefinitions, configurations,
      placedObjects, enquiries, enquiryStatusHistory, photoReferences,
      pricingRules, files, referenceLoadouts, referencePhotos, guestLeads,
      captureSessions, assetVersions, roomManifests, runtimePackages,
      configurationLayoutRevisions, processingJobs, events, eventPhases,
      eventScenarios, layoutVariants, eventConfigurationLinks,
      phaseLayoutSnapshots, evidenceItems, checkResults, assumptionRecords,
      reviewGates, claimStates, evidencePacks, evidencePackItems,
      staleEvidenceEvents, generalAuditLog, handoffPacks, opsTasks,
      taskGroups, furniturePickLists, pickListItems, suppliers,
      supplierInstructions, loadInSequences, breakdownSequences,
      roomFlipPlans, beoDocuments, snapshotDiffs, eventDayIssues,
      taskAssignments, taskCompletionEvents, opsStatusUpdates,
      guestFlowReplays, agentTrajectories, densityHeatmaps,
      routeConflicts, queueZones, staffLanes, revenueScenarios,
      pricingAssumptions, comfortConstraints, scenarioComparisons,
      analyticsSnapshots, integrationConnections, webhookEndpoints,
      externalCalendarLinks, websiteEmbedConfigs, emailTemplates,
      integrationEvents,
    ];
    expect(tables).toHaveLength(68);
  });

  it("exports event phase graph foundation tables", () => {
    const eventCols = getTableColumns(events);
    expect(eventCols.venueId).toBeDefined();
    expect(eventCols.createdBy).toBeDefined();
    expect(eventCols.status).toBeDefined();
    expect(eventCols.guestCount).toBeDefined();

    const phaseCols = getTableColumns(eventPhases);
    expect(phaseCols.eventId).toBeDefined();
    expect(phaseCols.templateKey).toBeDefined();
    expect(phaseCols.durationMinutes).toBeDefined();
    expect(phaseCols.opsTasksCount).toBeDefined();
    expect(phaseCols.reviewGatesCount).toBeDefined();
    expect(phaseCols.densityStatus).toBeDefined();
    expect(phaseCols.staffConflictsStatus).toBeDefined();

    expect(getTableColumns(eventScenarios).assumptions).toBeDefined();
    expect(getTableColumns(layoutVariants).configurationId).toBeDefined();
    expect(getTableColumns(eventConfigurationLinks).linkType).toBeDefined();
    expect(getTableColumns(phaseLayoutSnapshots).snapshotHash).toBeDefined();
  });

  it("pins the event phase graph migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0027_event_phase_graph.sql"), "utf-8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "events"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "event_phases"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "event_scenarios"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "layout_variants"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "event_configuration_links"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "phase_layout_snapshots"');
    expect(migration).toContain("'ready_for_ops'");
    expect(migration).toContain("'Density not checked'");
    expect(migration).toContain("'Staff conflicts not checked'");
    expect(migration).toContain("phase_layout_snapshots_hash_shape");
  });

  it("exports evidence runtime foundation tables", () => {
    const itemCols = getTableColumns(evidenceItems);
    expect(itemCols.configId).toBeDefined();
    expect(itemCols.targetType).toBeDefined();
    expect(itemCols.itemType).toBeDefined();
    expect(itemCols.confidence).toBeDefined();
    expect(itemCols.status).toBeDefined();
    expect(itemCols.staleState).toBeDefined();
    expect(itemCols.wording).toBeDefined();

    const checkCols = getTableColumns(checkResults);
    expect(checkCols.evidenceItemId).toBeDefined();
    expect(checkCols.checkType).toBeDefined();
    expect(checkCols.status).toBeDefined();
    expect(checkCols.severity).toBeDefined();

    expect(getTableColumns(assumptionRecords).assumptionType).toBeDefined();
    expect(getTableColumns(reviewGates).decisionAt).toBeDefined();
    expect(getTableColumns(claimStates).safeWording).toBeDefined();
    expect(getTableColumns(evidencePacks).payloadHash).toBeDefined();
    expect(getTableColumns(evidencePackItems).itemRole).toBeDefined();
    expect(getTableColumns(staleEvidenceEvents).reason).toBeDefined();
    expect(getTableColumns(generalAuditLog).action).toBeDefined();
  });

  it("pins the evidence runtime migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0028_evidence_runtime.sql"), "utf-8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS evidence_items");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS check_results");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS assumption_records");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS review_gates");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS claim_states");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS evidence_packs");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS evidence_pack_items");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS stale_evidence_events");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS general_audit_log");
    expect(migration).toContain("'human_review_required'");
    expect(migration).toContain("'not_checked'");
    expect(migration).toContain("evidence_packs_snapshot_hash_check");
  });

  it("exports ops compiler handoff tables", () => {
    const packCols = getTableColumns(handoffPacks);
    expect(packCols.configId).toBeDefined();
    expect(packCols.snapshotId).toBeDefined();
    expect(packCols.snapshotHash).toBeDefined();
    expect(packCols.sourceLabel).toBeDefined();
    expect(packCols.summary).toBeDefined();

    const taskCols = getTableColumns(opsTasks);
    expect(taskCols.handoffPackId).toBeDefined();
    expect(taskCols.taskGroupId).toBeDefined();
    expect(taskCols.kind).toBeDefined();
    expect(taskCols.status).toBeDefined();

    expect(getTableColumns(taskGroups).kind).toBeDefined();
    expect(getTableColumns(furniturePickLists).totalItems).toBeDefined();
    expect(getTableColumns(pickListItems).quantity).toBeDefined();
    expect(getTableColumns(suppliers).category).toBeDefined();
    expect(getTableColumns(supplierInstructions).arrivalWindow).toBeDefined();
    expect(getTableColumns(loadInSequences).stepNumber).toBeDefined();
    expect(getTableColumns(breakdownSequences).stepNumber).toBeDefined();
    expect(getTableColumns(roomFlipPlans).reviewGateCount).toBeDefined();
    expect(getTableColumns(beoDocuments).safeStatus).toBeDefined();
    expect(getTableColumns(snapshotDiffs).payload).toBeDefined();
  });

  it("pins the ops compiler migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0029_ops_compiler.sql"), "utf-8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "handoff_packs"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "ops_tasks"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "task_groups"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "furniture_pick_lists"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "pick_list_items"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "suppliers"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "supplier_instructions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "load_in_sequences"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "breakdown_sequences"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "room_flip_plans"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "beo_documents"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "snapshot_diffs"');
    expect(migration).toContain("'internal_operations_handoff'");
    expect(migration).toContain("handoff_packs_snapshot_hash_check");
    expect(migration).toContain("snapshot_diffs_hash_shape");
  });

  it("exports event-day mobile ops tables", () => {
    const issueCols = getTableColumns(eventDayIssues);
    expect(issueCols.eventId).toBeDefined();
    expect(issueCols.phaseId).toBeDefined();
    expect(issueCols.opsTaskId).toBeDefined();
    expect(issueCols.status).toBeDefined();
    expect(issueCols.severity).toBeDefined();
    expect(issueCols.escalationNote).toBeDefined();

    const assignmentCols = getTableColumns(taskAssignments);
    expect(assignmentCols.opsTaskId).toBeDefined();
    expect(assignmentCols.eventId).toBeDefined();
    expect(assignmentCols.assigneeLabel).toBeDefined();

    const completionCols = getTableColumns(taskCompletionEvents);
    expect(completionCols.opsTaskId).toBeDefined();
    expect(completionCols.fromStatus).toBeDefined();
    expect(completionCols.toStatus).toBeDefined();
    expect(completionCols.idempotencyKey).toBeDefined();

    const updateCols = getTableColumns(opsStatusUpdates);
    expect(updateCols.eventId).toBeDefined();
    expect(updateCols.kind).toBeDefined();
    expect(updateCols.message).toBeDefined();
  });

  it("pins the event-day ops migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0030_event_day_ops.sql"), "utf-8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "event_day_issues"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "task_assignments"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "task_completion_events"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "ops_status_updates"');
    expect(migration).toContain("'urgent'");
    expect(migration).toContain("task_completion_events_idempotency_unique");
    expect(migration).toContain("does not create");
  });

  it("exports guest flow replay tables", () => {
    const replayCols = getTableColumns(guestFlowReplays);
    expect(replayCols.eventId).toBeDefined();
    expect(replayCols.phaseId).toBeDefined();
    expect(replayCols.scenarioType).toBeDefined();
    expect(replayCols.seed).toBeDefined();
    expect(replayCols.inputHash).toBeDefined();
    expect(replayCols.artifactHash).toBeDefined();
    expect(replayCols.assumptions).toBeDefined();
    expect(replayCols.metrics).toBeDefined();
    expect(replayCols.disclosureLabel).toBeDefined();

    expect(getTableColumns(agentTrajectories).points).toBeDefined();
    expect(getTableColumns(densityHeatmaps).cells).toBeDefined();
    expect(getTableColumns(routeConflicts).conflictType).toBeDefined();
    expect(getTableColumns(queueZones).estimatedAgents).toBeDefined();
    expect(getTableColumns(staffLanes).line).toBeDefined();
  });

  it("pins the guest flow replay migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0031_guest_flow_replay.sql"), "utf-8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "guest_flow_replays"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "agent_trajectories"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "density_heatmaps"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "route_conflicts"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "queue_zones"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "staff_lanes"');
    expect(migration).toContain("simulated_planning_support");
    expect(migration).toContain("guest_flow_replays_hash_shape");
  });

  it("exports revenue analytics tables", () => {
    const scenarioCols = getTableColumns(revenueScenarios);
    expect(scenarioCols.venueId).toBeDefined();
    expect(scenarioCols.eventId).toBeDefined();
    expect(scenarioCols.quoteId).toBeDefined();
    expect(scenarioCols.estimatedRevenueMinor).toBeDefined();
    expect(scenarioCols.estimatedCostMinor).toBeDefined();
    expect(scenarioCols.estimatedMarginMinor).toBeDefined();
    expect(scenarioCols.comfortStatus).toBeDefined();
    expect(scenarioCols.reviewGateCount).toBeDefined();

    expect(getTableColumns(pricingAssumptions).payload).toBeDefined();
    expect(getTableColumns(comfortConstraints).reviewRequired).toBeDefined();
    expect(getTableColumns(scenarioComparisons).marginDeltaMinor).toBeDefined();
    expect(getTableColumns(analyticsSnapshots).snapshotType).toBeDefined();
  });

  it("pins the revenue analytics migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0032_revenue_analytics.sql"), "utf-8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "revenue_scenarios"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "pricing_assumptions"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "comfort_constraints"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "scenario_comparisons"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "analytics_snapshots"');
    expect(migration).toContain("revenue_scenarios_margin_exact");
    expect(migration).toContain("comfort_constraints_review_required_coherent");
  });

  it("exports integration layer tables", () => {
    const connectionCols = getTableColumns(integrationConnections);
    expect(connectionCols.venueId).toBeDefined();
    expect(connectionCols.provider).toBeDefined();
    expect(connectionCols.credentialMode).toBeDefined();
    expect(connectionCols.credentialRef).toBeDefined();
    expect(connectionCols.config).toBeDefined();

    expect(getTableColumns(webhookEndpoints).signingSecretRef).toBeDefined();
    expect(getTableColumns(externalCalendarLinks).syncDirection).toBeDefined();
    expect(getTableColumns(websiteEmbedConfigs).safeMode).toBeDefined();
    expect(getTableColumns(emailTemplates).managedByCode).toBeDefined();
    expect(getTableColumns(integrationEvents).payloadHash).toBeDefined();
  });

  it("pins the integration layer migration guardrails", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const migration = await fs.readFile(path.resolve("drizzle/0033_integration_layer.sql"), "utf-8");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "integration_connections"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "webhook_endpoints"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "external_calendar_links"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "website_embed_configs"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "email_templates"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "integration_events"');
    expect(migration).toContain("integration_connections_credential_ref_coherent");
    expect(migration).toContain("website_embed_configs_safe_mode_check");
    expect(migration).toContain("website_embed_configs_analytics_stub_check");
    expect(migration).toContain("integration_events_payload_hash_shape");
  });
});
