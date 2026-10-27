import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  CONTRACT_CONSENT_STATEMENT,
  MAX_SIGNATURE_USER_AGENT_LENGTH,
  PrepareContractSchema,
  SignContractSchema,
  contractDocumentDigest,
  sameContractContent,
  type ClientContractView,
  type StaffContractView,
} from "@omnitwin/types";
import { proposalContractSignatures, proposalContractVersions, proposals } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageCommercial } from "../utils/query.js";
import { proposalClient } from "../services/proposal-client.js";
import {
  contractClient,
  contractDocument,
  contractSource,
  latestContractVersion,
  staffContractVersions,
  storedDocument,
} from "../services/contracts.js";
import { notifyCommercialTeam } from "../services/commercial-notifications.js";
import { proposalDeskPath } from "../services/client-answer-notice.js";
import { resolveProposalShareToken } from "./proposals.js";

// ---------------------------------------------------------------------------
// The contract and its simple electronic signature (Plan 19 L5; goal 06 S6).
//
// Staff, on an accepted proposal (its venue's commercial roles):
//   GET  /proposals/:id/contract      every version, who signed what and when
//   POST /proposals/:id/contract      prepare a version from the accepted
//                                     proposal and the venue's terms
//
// The client, through their share link:
//   GET  /proposal-share/:token/contract        the version to read and sign
//   POST /proposal-share/:token/contract/sign   sign it: the name typed, the
//                                               statement ticked
//
// A signature binds the exact document the client's page showed: its version
// and its hash are sent back and must still be the latest. It records the
// typed name, the email of the client the proposal was addressed to (named in
// the signed document itself), the moment, the hash, the user agent, the
// words agreed to and the link it came through. No IP address is kept.
// Versions and signatures are immutable in the database; a change to the
// terms, the client or the accepted version makes a new version, signed
// afresh, and the earlier signature stays with the version it signed.
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.uuid() });
const ShareTokenParam = z.object({ token: z.string().min(32).max(96).regex(/^[A-Za-z0-9_-]+$/u) });

const VERSION_CHANGED = {
  error: "The accepted version is not the one this was prepared from. Reload the proposal to see it.",
  code: "PROPOSAL_VERSION_CHANGED",
} as const;

const CONTRACT_CHANGED = {
  error: "The venue team has changed the contract since this page was opened. The current version is shown now; please read it before signing.",
  code: "CONTRACT_VERSION_CHANGED",
} as const;

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code
    ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return code === "23505";
}

async function liveProposal(db: Pick<Database, "select">, id: string) {
  const [proposal] = await db.select().from(proposals).where(and(eq(proposals.id, id), isNull(proposals.deletedAt))).limit(1);
  return proposal;
}

export async function proposalContractRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:id/contract", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const proposal = await liveProposal(db, params.data.id);
    if (proposal === undefined) return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, proposal.venueId)) return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    const client = await proposalClient(db, proposal);
    const view: StaffContractView = {
      acceptedVersion: proposal.status === "accepted" ? proposal.sentVersion : null,
      clientEmail: client.email,
      versions: await staffContractVersions(db, proposal.id, (id) => {
        request.log.error({ event: "contract.document_hash_mismatch", contractVersionId: id }, "a stored contract version no longer matches its hash");
      }),
    };
    return { data: view };
  });

  server.post("/:id/contract", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const body = PrepareContractSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: body.error.issues });
    const proposal = await liveProposal(db, params.data.id);
    if (proposal === undefined) return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, proposal.venueId)) return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    if (proposal.status !== "accepted") {
      return reply.status(422).send({ error: "A contract is prepared once the client has accepted the proposal.", code: "NOT_ACCEPTED" });
    }
    if (body.data.version !== proposal.sentVersion) return reply.status(409).send(VERSION_CHANGED);
    const source = await contractSource(db, proposal);
    if (source === null) {
      request.log.error({ proposalId: proposal.id }, "accepted proposal version could not be read for its contract");
      return reply.status(422).send({ error: "The accepted version could not be read.", code: "ACCEPTED_VERSION_UNREADABLE" });
    }
    const client = contractClient(await proposalClient(db, proposal));
    if (client === null) {
      return reply.status(422).send({
        error: "The client has no email on the deal or the enquiry. Add one first: the signature records it.",
        code: "CLIENT_EMAIL_MISSING",
      });
    }

    const outcome = await db.transaction(async (tx) => {
      // Held, and read again: prepared versions are numbered one at a time,
      // and only while the proposal is still accepted on the same version.
      const [held] = await tx.select().from(proposals).where(eq(proposals.id, proposal.id)).limit(1).for("update");
      if (held?.status !== "accepted" || held.sentVersion !== source.proposalVersion || held.deletedAt !== null) return "changed" as const;
      const latest = await latestContractVersion(tx, proposal.id);
      const next = contractDocument(source, client, body.data.terms, (latest?.version ?? 0) + 1, new Date());
      // The same contract again is the version already prepared, not a new one.
      const latestDocument = latest === undefined ? null : storedDocument(latest);
      if (latest !== undefined && latestDocument !== null && sameContractContent(latestDocument, next)) return { row: latest, created: false };
      const [row] = await tx.insert(proposalContractVersions).values({
        venueId: proposal.venueId,
        proposalId: proposal.id,
        version: next.contractVersion,
        proposalVersion: source.proposalVersion,
        proposalVersionHash: source.proposalVersionHash,
        document: next,
        documentHash: contractDocumentDigest(next),
        createdBy: request.user.id,
        createdByLabel: request.user.email,
      }).returning();
      if (row === undefined) throw new Error("contract version insert returned no row");
      return { row, created: true };
    });
    if (outcome === "changed") return reply.status(409).send(VERSION_CHANGED);
    const document = storedDocument(outcome.row);
    if (document === null) throw new Error("a contract version just written does not match its hash");
    return reply.status(outcome.created ? 201 : 200).send({
      data: {
        id: outcome.row.id,
        version: outcome.row.version,
        proposalVersion: outcome.row.proposalVersion,
        document,
        documentHash: outcome.row.documentHash,
        createdAt: outcome.row.createdAt.toISOString(),
        createdByLabel: outcome.row.createdByLabel,
        signature: null,
      },
    });
  });
}

export async function proposalShareContractRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:token/contract", async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    const resolved = await resolveProposalShareToken(db, params.data.token);
    if (resolved?.presented !== "accepted") return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
    const latest = await latestContractVersion(db, resolved.proposal.id);
    const document = latest === undefined ? null : storedDocument(latest);
    if (latest !== undefined && document === null) {
      request.log.error({ event: "contract.document_hash_mismatch", contractVersionId: latest.id }, "a stored contract version no longer matches its hash");
    }
    let view: ClientContractView = { consentStatement: CONTRACT_CONSENT_STATEMENT, contract: null };
    if (latest !== undefined && document !== null) {
      const [signature] = await db.select({ signerName: proposalContractSignatures.signerName, signedAt: proposalContractSignatures.signedAt })
        .from(proposalContractSignatures)
        .where(eq(proposalContractSignatures.contractVersionId, latest.id))
        .limit(1);
      view = {
        consentStatement: CONTRACT_CONSENT_STATEMENT,
        contract: {
          version: latest.version,
          document,
          documentHash: latest.documentHash,
          signature: signature === undefined ? null : { signerName: signature.signerName, signedAt: signature.signedAt.toISOString() },
        },
      };
    }
    return { data: view };
  });

  server.post("/:token/contract/sign", {
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const params = ShareTokenParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid share token", code: "VALIDATION_ERROR" });
    const body = SignContractSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: body.error.issues });
    const resolved = await resolveProposalShareToken(db, params.data.token);
    if (resolved?.presented !== "accepted" || resolved.proposal.status !== "accepted") {
      return reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
    }
    const { proposal, shareToken } = resolved;

    const latest = await latestContractVersion(db, proposal.id);
    if (latest === undefined) return reply.status(404).send({ error: "There is no contract to sign yet.", code: "NOT_FOUND" });
    if (latest.version !== body.data.contractVersion || latest.documentHash !== body.data.documentHash) {
      return reply.status(409).send(CONTRACT_CHANGED);
    }
    // Signed only while it still embodies the version the client accepted,
    // and only if the stored document still is what its hash says.
    const document = storedDocument(latest);
    if (latest.proposalVersion !== proposal.sentVersion || document === null) {
      request.log.error({ event: "contract.not_signable", contractVersionId: latest.id }, "a contract no longer matches its accepted version or its hash");
      return reply.status(409).send(CONTRACT_CHANGED);
    }

    const agent = request.headers["user-agent"];
    const userAgent = typeof agent === "string" && agent.trim() !== "" ? agent.slice(0, MAX_SIGNATURE_USER_AGENT_LENGTH) : null;
    let signedAt: Date;
    try {
      const [row] = await db.insert(proposalContractSignatures).values({
        venueId: proposal.venueId,
        contractVersionId: latest.id,
        documentHash: latest.documentHash,
        signerName: body.data.signerName,
        signerEmail: document.client.email,
        consentStatement: CONTRACT_CONSENT_STATEMENT,
        userAgent,
        shareTokenId: shareToken.id,
        shareTokenPrefix: shareToken.tokenPrefix,
      }).returning({ signedAt: proposalContractSignatures.signedAt, signerName: proposalContractSignatures.signerName });
      if (row === undefined) throw new Error("signature insert returned no row");
      signedAt = row.signedAt;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Signed already (a second press, or another person on the same link):
      // the first signature stands and is what the page is told.
      const [existing] = await db.select().from(proposalContractSignatures)
        .where(eq(proposalContractSignatures.contractVersionId, latest.id)).limit(1);
      if (existing === undefined) throw error;
      return { data: { signerName: existing.signerName, signedAt: existing.signedAt.toISOString(), already: true } };
    }

    // After the signature is kept, and never a condition of it.
    try {
      await notifyCommercialTeam(db, {
        venueId: proposal.venueId,
        title: "Contract signed",
        body: `${body.data.signerName} signed version ${String(latest.version)} of the contract for ${proposal.title}.`,
        severity: "info",
        actionPath: proposalDeskPath(proposal.id),
      });
    } catch (err) {
      request.log.error({ event: "contract.notice_failed", contractVersionId: latest.id, err }, "contract signed but the team's notice could not be written");
    }
    return reply.status(201).send({ data: { signerName: body.data.signerName, signedAt: signedAt.toISOString(), already: false } });
  });
}
