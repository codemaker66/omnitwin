import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTRACT_CONSENT_STATEMENT,
  contractDocumentDigest,
  proposalVersionPayloadDigest,
  type ClientContractView,
  type StaffContractVersion,
  type StaffContractView,
} from "@omnitwin/types";
import { proposalContractRoutes, proposalShareContractRoutes } from "../routes/contracts.js";
import { openPaymentsDatabase, paymentsTestUrl, seedAcceptedProposal, type AcceptedProposalFixture } from "./helpers/payments-db.js";

// ---------------------------------------------------------------------------
// The contract's simple electronic signature through its real routes on
// migrated PostgreSQL (Plan 19 L5; Electronic Communications Act 2000 s.7):
//
//   - the venue prepares a version from the ACCEPTED proposal version and its
//     terms; the document names the client and their email and is hashed;
//   - the client signs exactly the version and document their page showed,
//     with a typed name and a ticked statement; the record keeps the name,
//     the email of record, the moment, the hash, the user agent, the words
//     agreed to and the link, and no IP address;
//   - a signature never changes; a change makes a new version, signed afresh;
//   - only the venue's own commercial team prepares or reads the record.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";

interface Reply<T> { readonly status: number; readonly body: { readonly data?: T; readonly code?: string } }

const TERMS = "1. The deposit is 25% of the hire fee.\n2. Cancellation within 90 days of the event forfeits the deposit.";
const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe.skipIf(paymentsTestUrl === undefined)("the contract's electronic signature on migrated PostgreSQL", () => {
  let pool: Pool;
  let server: FastifyInstance;

  beforeAll(async () => {
    const opened = await openPaymentsDatabase(`contracts_${randomUUID()}`);
    pool = opened.pool;
    server = Fastify();
    await server.register(proposalContractRoutes, { db: opened.db, prefix: "/proposals" });
    await server.register(proposalShareContractRoutes, { db: opened.db, prefix: "/proposal-share" });
    await server.ready();
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  });

  async function call<T>(method: "GET" | "POST", url: string, headers: Record<string, string> = {}, payload?: unknown): Promise<Reply<T>> {
    const res = await server.inject({ method, url, headers, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    return { status: res.statusCode, body: res.body === "" ? {} : res.json() };
  }

  const prepare = (f: AcceptedProposalFixture, terms = TERMS, headers = f.staff) =>
    call<StaffContractVersion>("POST", `/proposals/${f.proposalId}/contract`, headers, { terms, version: 1 });
  const read = (f: AcceptedProposalFixture) => call<ClientContractView>("GET", `/proposal-share/${f.token}/contract`);
  const sign = (f: AcceptedProposalFixture, version: StaffContractVersion, name = "Ada Client", extra: Record<string, unknown> = {}) =>
    call<{ signerName: string; signedAt: string; already: boolean }>("POST", `/proposal-share/${f.token}/contract/sign`, { "user-agent": BROWSER },
      { contractVersion: version.version, documentHash: version.documentHash, signerName: name, consent: true, ...extra });

  it("is prepared from the accepted version, naming the client and their email, and hashed", async () => {
    const f = await seedAcceptedProposal(pool);
    const made = await prepare(f);
    expect(made.status).toBe(201);
    const version = made.body.data;
    expect(version?.version).toBe(1);
    expect(version?.document).toMatchObject({
      client: { name: "Ada Client", email: f.clientEmail },
      proposal: { title: "Autumn gala, Grand Hall", version: 1, versionHash: proposalVersionPayloadDigest(f.payload) },
      event: { eventDate: "2026-12-05", guestCount: 180, roomName: "Grand Hall" },
      quote: { totalMinor: 250_000, currency: "GBP" },
      venue: { name: "TEST ONLY Trades Hall" },
      terms: TERMS,
    });
    expect(version?.documentHash).toBe(contractDocumentDigest(version?.document as StaffContractVersion["document"]));
    // The same terms again are the version already prepared.
    const again = await prepare(f);
    expect(again.status).toBe(200);
    expect(again.body.data?.id).toBe(version?.id);
  });

  it("is signed by the typed name and the ticked statement, and the record keeps what makes it evidence", async () => {
    const f = await seedAcceptedProposal(pool);
    const version = (await prepare(f)).body.data as StaffContractVersion;
    const shown = await read(f);
    expect(shown.body.data).toMatchObject({ consentStatement: CONTRACT_CONSENT_STATEMENT, contract: { version: 1, documentHash: version.documentHash, signature: null } });

    const signed = await sign(f, version, "  Ada Client  ");
    expect(signed.status).toBe(201);
    expect(signed.body.data?.signerName).toBe("Ada Client");
    const { rows } = await pool.query("SELECT * FROM proposal_contract_signatures WHERE contract_version_id = $1", [version.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      venue_id: f.venueId, signer_name: "Ada Client", signer_email: f.clientEmail, document_hash: version.documentHash,
      consent_statement: CONTRACT_CONSENT_STATEMENT, user_agent: BROWSER, share_token_id: f.shareTokenId, share_token_prefix: f.token.slice(0, 8),
    });
    expect((rows[0] as { signed_at: Date }).signed_at).toBeInstanceOf(Date);
    // No IP address is kept: the privacy page does not say one is.
    const columns = (await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proposal_contract_signatures'",
    )).rows.map((row) => row.column_name);
    expect(columns.some((name) => /ip|address|remote/u.test(name))).toBe(false);

    expect((await read(f)).body.data?.contract?.signature).toMatchObject({ signerName: "Ada Client" });
    const staff = await call<StaffContractView>("GET", `/proposals/${f.proposalId}/contract`, f.staff);
    expect(staff.body.data?.versions[0]?.signature).toMatchObject({
      signerName: "Ada Client", signerEmail: f.clientEmail, documentHash: version.documentHash, userAgent: BROWSER, shareTokenPrefix: f.token.slice(0, 8),
    });
  });

  it("refuses a signature without the ticked statement, a name, or on anything but the document shown", async () => {
    const f = await seedAcceptedProposal(pool);
    const version = (await prepare(f)).body.data as StaffContractVersion;
    expect((await sign(f, version, "Ada Client", { consent: false })).status).toBe(400);
    expect((await sign(f, version, "   ")).status).toBe(400);
    expect((await sign(f, version, "Ada Client", { documentHash: "0".repeat(64) })).body.code).toBe("CONTRACT_VERSION_CHANGED");
    expect((await sign(f, version, "Ada Client", { contractVersion: 2 })).body.code).toBe("CONTRACT_VERSION_CHANGED");
    expect((await sign(f, version, "Ada Client", { ipAddress: "203.0.113.9" })).status).toBe(400);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM proposal_contract_signatures WHERE contract_version_id = $1", [version.id]);
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("keeps the first signature when the same version is signed twice, even at once", async () => {
    const f = await seedAcceptedProposal(pool);
    const version = (await prepare(f)).body.data as StaffContractVersion;
    const [a, b] = await Promise.all([sign(f, version, "Ada Client"), sign(f, version, "Someone Else")]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 201]);
    const { rows } = await pool.query<{ signer_name: string }>("SELECT signer_name FROM proposal_contract_signatures WHERE contract_version_id = $1", [version.id]);
    expect(rows).toHaveLength(1);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expect(loser.body.data).toMatchObject({ signerName: winner.body.data?.signerName, already: true });
    await expect(pool.query("UPDATE proposal_contract_signatures SET signer_name = 'Changed' WHERE contract_version_id = $1", [version.id])).rejects.toThrow(/cannot be changed or removed/u);
  });

  it("makes a new version for changed terms, signed afresh; the earlier signature stays with the version it signed", async () => {
    const f = await seedAcceptedProposal(pool);
    const first = (await prepare(f)).body.data as StaffContractVersion;
    await sign(f, first);
    const second = await prepare(f, `${TERMS}\n3. Music ends at midnight.`);
    expect(second.status).toBe(201);
    expect(second.body.data?.version).toBe(2);
    expect((await read(f)).body.data?.contract).toMatchObject({ version: 2, signature: null });
    expect((await sign(f, first)).body.code).toBe("CONTRACT_VERSION_CHANGED");
    const staff = (await call<StaffContractView>("GET", `/proposals/${f.proposalId}/contract`, f.staff)).body.data;
    expect(staff?.versions.map((v) => [v.version, v.signature?.signerName ?? null])).toEqual([[2, null], [1, "Ada Client"]]);
  });

  it("is prepared from the accepted version even after a platform admin saves another on the accepted proposal", async () => {
    const f = await seedAcceptedProposal(pool);
    const later = { ...f.payload, title: "A version nobody accepted" };
    await pool.query("INSERT INTO proposal_versions (proposal_id, version, payload, source_hash) VALUES ($1, 2, $2, $3)", [f.proposalId, JSON.stringify(later), proposalVersionPayloadDigest(later)]);
    await pool.query("UPDATE proposals SET current_version = 2 WHERE id = $1", [f.proposalId]);
    const made = (await prepare(f, TERMS, f.platformAdmin)).body.data;
    expect(made?.document.proposal).toEqual({ title: "Autumn gala, Grand Hall", version: 1, versionHash: proposalVersionPayloadDigest(f.payload) });
    expect((await call("POST", `/proposals/${f.proposalId}/contract`, f.staff, { terms: TERMS, version: 2 })).body.code).toBe("PROPOSAL_VERSION_CHANGED");
  });

  it("is prepared and read only by the venue's own commercial team", async () => {
    const f = await seedAcceptedProposal(pool);
    await prepare(f);
    for (const headers of [f.otherStaff, f.hallkeeper]) {
      expect((await call("GET", `/proposals/${f.proposalId}/contract`, headers)).status).toBe(403);
      expect((await prepare(f, TERMS, headers)).status).toBe(403);
    }
    expect((await call("GET", `/proposals/${f.proposalId}/contract`)).status).toBe(401);
    expect((await call("GET", "/proposal-share/not-a-real-token-but-long-enough-to-pass-the-shape/contract")).status).toBe(404);
  });

  it("waits for acceptance and for the client's email", async () => {
    const sent = await seedAcceptedProposal(pool, { status: "sent" });
    expect((await prepare(sent)).body.code).toBe("NOT_ACCEPTED");
    expect((await read(sent)).status).toBe(404);
    const noEmail = await seedAcceptedProposal(pool);
    await pool.query("UPDATE proposals SET enquiry_id = NULL WHERE id = $1", [noEmail.proposalId]);
    expect((await prepare(noEmail)).body.code).toBe("CLIENT_EMAIL_MISSING");
    expect((await read(noEmail)).body.data).toEqual({ consentStatement: CONTRACT_CONSENT_STATEMENT, contract: null });
  });
});
