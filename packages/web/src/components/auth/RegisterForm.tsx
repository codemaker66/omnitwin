import { useState } from "react";
import { useAuthStore } from "../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// RegisterForm — email, name, password, confirm, role selector
// ---------------------------------------------------------------------------

const formStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 4, display: "block" };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid #ddd",
  borderRadius: 6, outline: "none", boxSizing: "border-box",
};
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };
const buttonStyle: React.CSSProperties = {
  width: "100%", padding: "12px 16px", fontSize: 15, fontWeight: 600,
  background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
};
const errorStyle: React.CSSProperties = {
  background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6,
  padding: "10px 12px", fontSize: 13, color: "#dc2626",
};
const linkStyle: React.CSSProperties = { textAlign: "center", fontSize: 13, color: "#666", marginTop: 8 };

interface RegisterFormProps {
  readonly onNavigateLogin: () => void;
}

export function RegisterForm({ onNavigateLogin }: RegisterFormProps): React.ReactElement {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState("planner");
  const [localError, setLocalError] = useState<string | null>(null);
  const { register, isLoading, error: storeError } = useAuthStore();
  const error = localError ?? storeError;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setLocalError(null);

    if (name.trim() === "") { setLocalError("Name is required"); return; }
    if (email.trim() === "") { setLocalError("Email is required"); return; }
    if (password.length < 8) { setLocalError("Password must be at least 8 characters"); return; }
    if (password !== confirmPassword) { setLocalError("Passwords do not match"); return; }

    void register(email.trim(), password, name.trim(), role);
  };

  return (
    <form style={formStyle} onSubmit={handleSubmit} data-testid="register-form">
      {error !== null && <div style={errorStyle} role="alert">{error}</div>}

      <div>
        <label style={labelStyle} htmlFor="reg-name">Name</label>
        <input id="reg-name" type="text" style={inputStyle} value={name}
          onChange={(e) => { setName(e.target.value); }} placeholder="Your name" disabled={isLoading} />
      </div>

      <div>
        <label style={labelStyle} htmlFor="reg-email">Email</label>
        <input id="reg-email" type="email" style={inputStyle} value={email}
          onChange={(e) => { setEmail(e.target.value); }} placeholder="you@example.com" disabled={isLoading} autoComplete="email" />
      </div>

      <div>
        <label style={labelStyle} htmlFor="reg-password">Password</label>
        <input id="reg-password" type="password" style={inputStyle} value={password}
          onChange={(e) => { setPassword(e.target.value); }} placeholder="Min 8 characters" disabled={isLoading} autoComplete="new-password" />
      </div>

      <div>
        <label style={labelStyle} htmlFor="reg-confirm">Confirm Password</label>
        <input id="reg-confirm" type="password" style={inputStyle} value={confirmPassword}
          onChange={(e) => { setConfirmPassword(e.target.value); }} placeholder="Repeat password" disabled={isLoading} autoComplete="new-password" />
      </div>

      <div>
        <label style={labelStyle} htmlFor="reg-role">Role</label>
        <select id="reg-role" style={selectStyle} value={role} onChange={(e) => { setRole(e.target.value); }} disabled={isLoading}>
          <option value="planner">Planner</option>
          <option value="hallkeeper">Hallkeeper</option>
        </select>
      </div>

      <button type="submit" style={{ ...buttonStyle, opacity: isLoading ? 0.7 : 1 }} disabled={isLoading}>
        {isLoading ? "Creating account…" : "Create Account"}
      </button>

      <p style={linkStyle}>
        Already have an account?{" "}
        <button type="button" onClick={onNavigateLogin}
          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, textDecoration: "underline", padding: 0 }}>
          Sign In
        </button>
      </p>
    </form>
  );
}
