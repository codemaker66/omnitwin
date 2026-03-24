import { useState, useRef, useCallback, useEffect } from "react";
import * as clientsApi from "../../api/clients.js";
import type { SearchResults } from "../../api/clients.js";
import { useToastStore } from "../../stores/toast-store.js";

// ---------------------------------------------------------------------------
// ClientSearchView — search clients, guest leads, configurations
// ---------------------------------------------------------------------------

interface ClientSearchViewProps {
  readonly onViewProfile: (userId: string) => void;
  readonly onViewLeadProfile: (leadId: string) => void;
}

const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 8, padding: 12, border: "1px solid #e5e7eb",
  cursor: "pointer", transition: "box-shadow 0.15s", fontSize: 13,
};

export function ClientSearchView({ onViewProfile, onViewLeadProfile }: ClientSearchViewProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const data = await clientsApi.searchClients(q);
      setResults(data);
    } catch { addToast("Search failed", "error"); }
    setLoading(false);
  }, [addToast]);

  const handleInput = (value: string): void => {
    setQuery(value);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void doSearch(value); }, 300);
  };

  useEffect(() => () => { if (timerRef.current !== null) clearTimeout(timerRef.current); }, []);

  const hasResults = results !== null && (results.users.length > 0 || results.guestLeads.length > 0 || results.configurations.length > 0);

  return (
    <div>
      <input
        type="text"
        placeholder="Search by name, email, or organisation (min 2 characters)"
        value={query}
        onChange={(e) => { handleInput(e.target.value); }}
        style={{
          width: "100%", padding: "12px 16px", fontSize: 15, border: "1px solid #e5e7eb",
          borderRadius: 8, marginBottom: 20, boxSizing: "border-box",
          fontFamily: "'Inter', sans-serif",
        }}
        data-testid="search-input"
      />

      {loading && <p style={{ color: "#999", fontSize: 13 }}>Searching...</p>}

      {!loading && query.length < 2 && results === null && (
        <p style={{ color: "#999", fontSize: 14 }}>Search for clients by name, email, or organisation</p>
      )}

      {!loading && query.length >= 2 && !hasResults && results !== null && (
        <p style={{ color: "#999", fontSize: 14 }}>No results found for &ldquo;{query}&rdquo;</p>
      )}

      {results !== null && results.users.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Registered Users</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.users.map((u) => (
              <div key={u.id} style={cardStyle} onClick={() => { onViewProfile(u.id); }}>
                <div style={{ fontWeight: 600 }}>{u.displayName ?? u.email}</div>
                {u.organizationName !== null && <div style={{ color: "#666" }}>{u.organizationName}</div>}
                <div style={{ color: "#999", marginTop: 4 }}>
                  {u.email} · {String(u.configurationCount)} configs · {String(u.enquiryCount)} enquiries
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results !== null && results.guestLeads.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Guest Leads</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.guestLeads.map((l) => (
              <div key={l.id} style={cardStyle} onClick={() => { onViewLeadProfile(l.id); }}>
                <div style={{ fontWeight: 600 }}>{l.name ?? l.email}</div>
                <div style={{ color: "#999", marginTop: 4 }}>
                  {l.email} · {String(l.enquiryCount)} enquiries
                  {l.convertedToUserId !== null && <span style={{ marginLeft: 8, color: "#22c55e" }}>Converted</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results !== null && results.configurations.length > 0 && (
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Configurations</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.configurations.map((c) => (
              <a key={c.id} href={`/editor/${c.id}`} style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ color: "#999", marginTop: 4 }}>
                  {c.spaceName} · {c.userName ?? "Anonymous"} · {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
