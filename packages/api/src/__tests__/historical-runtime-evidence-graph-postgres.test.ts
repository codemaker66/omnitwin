import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_ENABLED = process.env["RUN_HISTORICAL_RUNTIME_EVIDENCE_POSTGRES"] === "1";
const DATABASE_URL = process.env["HISTORICAL_RUNTIME_EVIDENCE_DATABASE_URL"] ?? "";
const SAFE_DATABASE_PREFIX = "venviewer_hr_0065_";

function isSafeDisposableDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.slice(1);
    return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
      && (parsed.port === "54329" || parsed.port === "54339")
      && databaseName.startsWith(SAFE_DATABASE_PREFIX)
      && /^[a-z0-9_]+$/u.test(databaseName);
  } catch {
    return false;
  }
}

if (RUN_ENABLED && !isSafeDisposableDatabaseUrl(DATABASE_URL)) {
  throw new Error(
    "RUN_HISTORICAL_RUNTIME_EVIDENCE_POSTGRES requires a disposable local PostgreSQL database URL.",
  );
}

function errorProperty(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null || !(key in error)) return undefined;
  return (error as Readonly<Record<string, unknown>>)[key];
}

async function expectConstraint(
  client: Client,
  sql: string,
  constraint: string,
): Promise<void> {
  try {
    await client.query(sql);
    throw new Error(`Expected PostgreSQL constraint ${constraint} to reject the row.`);
  } catch (error: unknown) {
    expect(errorProperty(error, "code")).toBe("23514");
    expect(errorProperty(error, "constraint")).toBe(constraint);
  }
}

const postgresDescribe = RUN_ENABLED ? describe : describe.skip;

postgresDescribe("historical-runtime 0065 isolated PostgreSQL gate", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query(`
      BEGIN;
      INSERT INTO venues(id,name,slug,address) VALUES
        ('93000000-0000-0000-0000-000000000001','GET Fixture Venue',
         'get-fixture-venue','1 Fixture Street');
      INSERT INTO spaces(
        id,venue_id,name,slug,width_m,length_m,height_m,floor_plan_outline
      ) VALUES (
        '93000000-0000-0000-0000-000000000002',
        '93000000-0000-0000-0000-000000000001','GET Fixture Room',
        'get-fixture-room',10,10,3,'{}'::jsonb
      );
      INSERT INTO users(
        id,email,name,role,venue_id,clerk_id,platform_role
      ) VALUES
        ('93000000-0000-0000-0000-000000000010','admin@get-fixture.test',
         'Admin','admin',NULL,'clerk_admin_get_fixture','admin'),
        ('93000000-0000-0000-0000-000000000011','custodian@get-fixture.test',
         'Custodian','staff',NULL,'clerk_custodian_get_fixture','admin'),
        ('93000000-0000-0000-0000-000000000012','observer@get-fixture.test',
         'Observer','staff',NULL,'clerk_observer_get_fixture','admin'),
        ('93000000-0000-0000-0000-000000000013','prober@get-fixture.test',
         'Prober','staff',NULL,'clerk_prober_get_fixture','admin');
      COMMIT;
      SET ROLE omnitwin_historical_evidence_verifier;
      INSERT INTO hr_evidence_environments(id,mode,configured_by) VALUES (
        '93000000-0000-0000-0000-000000000003','test',
        '93000000-0000-0000-0000-000000000010'
      );
      INSERT INTO hr_scope_epochs(
        id,environment_id,venue_id,space_id,issued_by
      ) VALUES (
        '93000000-0000-0000-0000-000000000004',
        '93000000-0000-0000-0000-000000000003',
        '93000000-0000-0000-0000-000000000001',
        '93000000-0000-0000-0000-000000000002',
        '93000000-0000-0000-0000-000000000010'
      );
      INSERT INTO hr_provider_capabilities(
        id,environment_id,environment_mode,environment_digest,scope_epoch_id,
        venue_id,space_id,scope_epoch,scope_epoch_digest,scope_epoch_expires_at,
        provider_profile,provider_kind,version_kind,verification_mode,
        anonymous_head_request_digest,anonymous_head_response_digest,
        anonymous_head_status_code,anonymous_get_request_digest,
        anonymous_get_response_digest,anonymous_get_status_code,
        anonymous_denial_class,provider_account_sha256,
        endpoint_authority_sha256,private_bucket_sha256,
        test_object_storage_key_sha256,initial_write_digest,
        initial_read_digest,overwrite_digest,prior_version_reread_digest,
        verified_by
      )
      SELECT
        '93000000-0000-0000-0000-000000000005',environment_id,
        environment_mode,environment_digest,id,venue_id,space_id,epoch,
        epoch_digest,expires_at,'local_fixture','local_fixture',
        'local_fixture_version','local_fixture_exact_version',repeat('1',64),
        repeat('2',64),403,repeat('3',64),repeat('4',64),403,
        'access_forbidden',repeat('5',64),repeat('6',64),repeat('7',64),
        repeat('8',64),repeat('9',64),repeat('9',64),repeat('a',64),
        repeat('9',64),'93000000-0000-0000-0000-000000000010'
      FROM hr_scope_epochs
      WHERE id='93000000-0000-0000-0000-000000000004';
    `);
  });

  afterAll(async () => {
    if (client !== undefined) {
      await client.query("RESET ROLE");
      await client.end();
    }
  });

  it("keeps the owner, schema, and function ACL postflight closed", async () => {
    const result = await client.query<{
      bad_relation_owners: string;
      bad_function_owners: string;
      public_execute: string;
      unsafe_schema_create: boolean;
    }>(`
      SELECT
        (SELECT count(*)::text
         FROM pg_class relation
         JOIN pg_roles owner_role ON owner_role.oid=relation.relowner
         WHERE relation.relnamespace='public'::regnamespace
           AND relation.relkind IN ('r','p')
           AND relation.relname LIKE 'hr\\_%' ESCAPE '\\'
           AND owner_role.rolname <> 'omnitwin_historical_schema_owner')
          AS bad_relation_owners,
        (SELECT count(*)::text
         FROM pg_proc procedure
         JOIN pg_roles owner_role ON owner_role.oid=procedure.proowner
         WHERE procedure.pronamespace='public'::regnamespace
           AND procedure.prokind='f'
           AND procedure.proname LIKE 'hr\\_%' ESCAPE '\\'
           AND ((procedure.prosecdef AND owner_role.rolname <>
                   'omnitwin_historical_evidence_owner')
             OR (NOT procedure.prosecdef AND owner_role.rolname <>
                   'omnitwin_historical_schema_owner')))
          AS bad_function_owners,
        (SELECT count(*)::text
         FROM pg_proc procedure
         WHERE procedure.pronamespace='public'::regnamespace
           AND procedure.proname LIKE 'hr\\_%' ESCAPE '\\'
           AND has_function_privilege('public',procedure.oid,'EXECUTE'))
          AS public_execute,
        has_schema_privilege(
          'omnitwin_historical_schema_owner','public','CREATE'
        ) OR has_schema_privilege(
          'omnitwin_historical_evidence_owner','public','CREATE'
        ) OR has_schema_privilege('public','public','CREATE')
          AS unsafe_schema_create
    `);
    expect(result.rows).toEqual([{
      bad_relation_owners: "0",
      bad_function_owners: "0",
      public_execute: "0",
      unsafe_schema_create: false,
    }]);
  });

  it("persists an exact per-object HEAD and safe-Range GET denial", async () => {
    await client.query(`
      INSERT INTO hr_object_receipts(
        id,capability_id,receipt_role,storage_key_sha256,storage_version,
        storage_etag,file_name,mime_type,sha256,size_bytes,
        custodian_actor_id,observed_by_actor_id,
        authenticated_read_request_digest,authenticated_read_response_digest,
        read_at,denial_request_digest,denial_response_digest,
        denial_status_code,denial_class,denial_get_request_digest,
        denial_get_response_digest,denial_get_status_code,denial_get_class,
        denial_probed_by
      ) VALUES (
        '93000000-0000-0000-0000-000000000006',
        '93000000-0000-0000-0000-000000000005','source_root',repeat('b',64),
        'fixture-v1','fixture-etag','room.sog',
        'application/vnd.venviewer.sog',repeat('c',64),20518437888,
        '93000000-0000-0000-0000-000000000011',
        '93000000-0000-0000-0000-000000000012',repeat('d',64),
        repeat('e',64),clock_timestamp(),repeat('f',64),repeat('0',64),
        403,'access_forbidden',repeat('1',64),repeat('2',64),403,
        'access_forbidden','93000000-0000-0000-0000-000000000013'
      )
    `);
    const result = await client.query<{
      schema_version: string;
      storage_key: string;
      request_method: string;
      range_header: string;
      status_code: string;
      denial_class: string;
      head_redirect_count: string;
      get_redirect_count: string;
      distinct_requests: boolean;
      digest_matches: boolean;
    }>(`
      SELECT
        receipt_body->>'schemaVersion' AS schema_version,
        receipt_body->'anonymousAccessDenial'->>'storageKeySha256'
          AS storage_key,
        receipt_body->'anonymousAccessDenial'->'safeRangeGet'->>'requestMethod'
          AS request_method,
        receipt_body->'anonymousAccessDenial'->'safeRangeGet'->>'rangeHeader'
          AS range_header,
        receipt_body->'anonymousAccessDenial'->'safeRangeGet'->>'statusCode'
          AS status_code,
        receipt_body->'anonymousAccessDenial'->'safeRangeGet'->>'denialClass'
          AS denial_class,
        receipt_body->'anonymousAccessDenial'->>'redirectCount'
          AS head_redirect_count,
        receipt_body->'anonymousAccessDenial'->'safeRangeGet'->>'redirectCount'
          AS get_redirect_count,
        denial_request_digest <> denial_get_request_digest
          AS distinct_requests,
        receipt_digest = encode(digest(convert_to(
          E'venviewer.historical-runtime-exact-object-receipt.v2\\n'
            || hr_stable_canonical_json(receipt_body-'receiptDigest'),
          'UTF8'), 'sha256'), 'hex') AS digest_matches
      FROM hr_object_receipts
      WHERE id='93000000-0000-0000-0000-000000000006'
    `);
    expect(result.rows).toEqual([{
      schema_version: "historical-runtime-exact-object-receipt.v2",
      storage_key: "b".repeat(64),
      request_method: "GET",
      range_header: "bytes=0-0",
      status_code: "403",
      denial_class: "access_forbidden",
      head_redirect_count: "0",
      get_redirect_count: "0",
      distinct_requests: true,
      digest_matches: true,
    }]);
  });

  it("rejects provider and exact-object probe substitution", async () => {
    await expectConstraint(client, `
      INSERT INTO hr_provider_capabilities(
        id,environment_id,environment_mode,environment_digest,scope_epoch_id,
        venue_id,space_id,scope_epoch,scope_epoch_digest,scope_epoch_expires_at,
        provider_profile,provider_kind,version_kind,verification_mode,
        anonymous_head_request_digest,anonymous_head_response_digest,
        anonymous_head_status_code,anonymous_get_request_digest,
        anonymous_get_response_digest,anonymous_get_status_code,
        anonymous_denial_class,provider_account_sha256,
        endpoint_authority_sha256,private_bucket_sha256,
        test_object_storage_key_sha256,initial_write_digest,
        initial_read_digest,overwrite_digest,prior_version_reread_digest,
        verified_by
      )
      SELECT
        '93000000-0000-0000-0000-000000000007',environment_id,
        environment_mode,environment_digest,id,venue_id,space_id,epoch,
        epoch_digest,expires_at,'local_fixture','local_fixture',
        'local_fixture_version','local_fixture_exact_version',repeat('1',64),
        repeat('2',64),403,repeat('3',64),repeat('4',64),404,
        'access_forbidden',repeat('5',64),repeat('6',64),repeat('7',64),
        repeat('8',64),repeat('9',64),repeat('9',64),repeat('a',64),
        repeat('9',64),'93000000-0000-0000-0000-000000000010'
      FROM hr_scope_epochs
      WHERE id='93000000-0000-0000-0000-000000000004'
    `, "hr_provider_capability_head_get_parity");

    await expectConstraint(client, `
      INSERT INTO hr_provider_capabilities(
        id,environment_id,environment_mode,environment_digest,scope_epoch_id,
        venue_id,space_id,scope_epoch,scope_epoch_digest,scope_epoch_expires_at,
        provider_profile,provider_kind,version_kind,verification_mode,
        anonymous_head_request_digest,anonymous_head_response_digest,
        anonymous_head_status_code,anonymous_get_request_digest,
        anonymous_get_response_digest,anonymous_get_status_code,
        anonymous_denial_class,provider_account_sha256,
        endpoint_authority_sha256,private_bucket_sha256,
        test_object_storage_key_sha256,initial_write_digest,
        initial_read_digest,overwrite_digest,prior_version_reread_digest,
        verified_by
      )
      SELECT
        '93000000-0000-0000-0000-000000000014',environment_id,
        environment_mode,environment_digest,id,venue_id,space_id,epoch,
        epoch_digest,expires_at,'local_fixture_duplicate','local_fixture',
        'local_fixture_version','local_fixture_exact_version',repeat('b',64),
        repeat('c',64),403,repeat('b',64),repeat('d',64),403,
        'access_forbidden',repeat('e',64),repeat('f',64),repeat('0',64),
        repeat('1',64),repeat('2',64),repeat('2',64),repeat('3',64),
        repeat('2',64),'93000000-0000-0000-0000-000000000010'
      FROM hr_scope_epochs
      WHERE id='93000000-0000-0000-0000-000000000004'
    `, "hr_provider_capability_head_get_parity");

    await expectConstraint(client, `
      INSERT INTO hr_object_receipts(
        id,capability_id,receipt_role,storage_key_sha256,storage_version,
        storage_etag,file_name,mime_type,sha256,size_bytes,
        custodian_actor_id,observed_by_actor_id,
        authenticated_read_request_digest,authenticated_read_response_digest,
        read_at,denial_request_digest,denial_response_digest,
        denial_status_code,denial_class,denial_get_request_digest,
        denial_get_response_digest,denial_get_status_code,denial_get_class,
        denial_probed_by
      ) VALUES (
        '93000000-0000-0000-0000-000000000008',
        '93000000-0000-0000-0000-000000000005','source_root',repeat('3',64),
        'fixture-v2','fixture-etag-v2','room2.sog',
        'application/vnd.venviewer.sog',repeat('4',64),1024,
        '93000000-0000-0000-0000-000000000011',
        '93000000-0000-0000-0000-000000000012',repeat('5',64),
        repeat('6',64),clock_timestamp(),repeat('7',64),repeat('8',64),
        403,'access_forbidden',repeat('9',64),repeat('a',64),404,
        'concealed_existing_object','93000000-0000-0000-0000-000000000013'
      )
    `, "hr_object_receipt_head_get_parity");

    await expectConstraint(client, `
      INSERT INTO hr_object_receipts(
        id,capability_id,receipt_role,storage_key_sha256,storage_version,
        storage_etag,file_name,mime_type,sha256,size_bytes,
        custodian_actor_id,observed_by_actor_id,
        authenticated_read_request_digest,authenticated_read_response_digest,
        read_at,denial_request_digest,denial_response_digest,
        denial_status_code,denial_class,denial_get_request_digest,
        denial_get_response_digest,denial_get_status_code,denial_get_class,
        denial_probed_by
      ) VALUES (
        '93000000-0000-0000-0000-000000000009',
        '93000000-0000-0000-0000-000000000005','source_root',repeat('b',64),
        'fixture-v3','fixture-etag-v3','room3.sog',
        'application/vnd.venviewer.sog',repeat('c',64),1024,
        '93000000-0000-0000-0000-000000000011',
        '93000000-0000-0000-0000-000000000012',repeat('d',64),
        repeat('e',64),clock_timestamp(),repeat('f',64),repeat('0',64),
        403,'access_forbidden',repeat('f',64),repeat('2',64),403,
        'access_forbidden','93000000-0000-0000-0000-000000000013'
      )
    `, "hr_object_receipt_head_get_parity");

    const result = await client.query<{ rejected_rows: string }>(`
      SELECT count(*)::text AS rejected_rows FROM (
        SELECT id FROM hr_provider_capabilities WHERE id IN (
          '93000000-0000-0000-0000-000000000007',
          '93000000-0000-0000-0000-000000000014'
        )
        UNION ALL
        SELECT id FROM hr_object_receipts WHERE id IN (
          '93000000-0000-0000-0000-000000000008',
          '93000000-0000-0000-0000-000000000009'
        )
      ) rejected
    `);
    expect(result.rows).toEqual([{ rejected_rows: "0" }]);
  });
});
