import { useState, useEffect } from "react";
import * as clientsApi from "../../api/clients.js";
import type { ClientProfile as ClientProfileData, LeadProfile as LeadProfileData } from "../../api/clients.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { useToastStore } from "../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// ClientProfile — full client or guest lead detail view
// ---------------------------------------------------------------------------

interface ClientProfileProps {
  readonly userId?: string;
  readonly leadId?: string;
  readonly onBack: () => void;
  readonly onViewEnquiry: (id: string) => void;
}

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: 12, border: "1px solid #e5e7eb",
  fontSize: 13,
};

export function ClientProfile({ userId, leadId, onBack, onViewEnquiry }: ClientProfileProps): React.ReactElement {
  const [clientData, setClientData] = useState<ClientProfileData | null>(null);
  const [leadData, setLeadData] = useState<LeadProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    // `cancelled` prevents a stale in-flight request from overwriting state
    // after the user switches to a different profile (F23).
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      setClientData(null);
      setLeadData(null);
      try {
        if (userId !== undefined) {
          const data = await clientsApi.getClientProfile(userId);
          if (!cancelled) setClientData(data);
        } else if (leadId !== undefined) {
          const data = await clientsApi.getLeadProfile(leadId);
          if (!cancelled) setLeadData(data);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load profile");
          addToast("Failed to load profile", "error");
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, leadId, addToast]);

  if (loading) return <p style={{ color: "#999" }}>Loading profile...</p>;

  if (error !== null) {
    return (
      <div>
        <button type="button" onClick={onBack}
          style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}>
          &larr; Back
        </button>
        <p style={{ color: "#ef4444", fontSize: 14 }}>{error}</p>
      </div>
    );
  }

  const isLead = leadData !== null;
  const user = clientData?.user;
  const lead = leadData?.lead;
  const configs = clientData?.configurations ?? [];
  const enquiries = clientData?.enquiries ?? leadData?.enquiries ?? [];

  return (
    <div>
      <button type="button" onClick={onBack}
        style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 13, marginBottom: 16, padding: 0 }}>
        &larr; Back
      </button>

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {user?.displayName ?? user?.name ?? lead?.name ?? lead?.email ?? "Unknown"}
          </h2>
          {isLead && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#fef3c7", color: "#d97706" }}>Guest Lead</span>}
        </div>
        <div style={{ fontSize: 13, color: "#666", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {user !== undefined && <div>Email: {user.email}</div>}
          {lead !== undefined && <div>Email: {lead.email}</div>}
          {user?.organizationName !== undefined && user.organizationName !== null && <div>Org: {user.organizationName}</div>}
          {user?.phone !== undefined && user.phone !== null && <div>Phone: {user.phone}</div>}
          {lead?.phone !== undefined && lead.phone !== null && <div>Phone: {lead.phone}</div>}
          {user?.role !== undefined && <div>Role: {user.role}</div>}
          <div>Since: {new Date(user?.createdAt ?? lead?.createdAt ?? "").toLocaleDateString()}</div>
          {isLead && lead?.convertedToUserId === null && <div style={{ color: "#f59e0b" }}>Not yet registered</div>}
        </div>
      </div>

      {configs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Configurations</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {configs.map((c) => (
              <a key={c.id} href={`/editor/${c.id}`} style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ color: "#999", marginTop: 4 }}>
                  {c.spaceName} · {String(c.objectCount)} objects · {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {enquiries.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Enquiries</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {enquiries.map((e) => (
              <div key={e.id} style={{ ...cardStyle, cursor: "pointer" }} onClick={() => { onViewEnquiry(e.id); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusBadge status={e.state} />
                  {e.eventType !== null && <span>{e.eventType}</span>}
                  {e.preferredDate !== null && <span style={{ color: "#999" }}>{e.preferredDate}</span>}
                </div>
                <div style={{ color: "#999", marginTop: 4 }}>{e.spaceName}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
