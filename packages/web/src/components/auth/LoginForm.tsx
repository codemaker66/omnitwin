import { useState } from "react";
import { useAuthStore } from "../../stores/auth-store.js";

// ---------------------------------------------------------------------------
// LoginForm — email/password login
// ---------------------------------------------------------------------------

const formStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 4, display: "block" };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 14, border: "1px solid #ddd",
  borderRadius: 6, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s",
};
const buttonStyle: React.CSSProperties = {
  width: "100%", padding: "12px 16px", fontSize: 15, fontWeight: 600,
  background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 6,
  cursor: "pointer", transition: "background 0.2s",
};
const errorStyle: React.CSSProperties = {
  background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6,
  padding: "10px 12px", fontSize: 13, color: "#dc2626",
};
const linkStyle: React.CSSProperties = {
  textAlign: "center", fontSize: 13, color: "#666", marginTop: 8,
};

interface LoginFormProps {
  readonly onNavigateRegister: () => void;
}

export function LoginForm({ onNavigateRegister }: LoginFormProps): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const { login, isLoading, error: storeError } = useAuthStore();
  const error = localError ?? storeError;

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    setLocalError(null);

    if (email.trim() === "") { setLocalError("Email is required"); return; }
    if (password === "") { setLocalError("Password is required"); return; }

    void login(email.trim(), password);
  };

  return (
    <form style={formStyle} onSubmit={handleSubmit} data-testid="login-form">
      {error !== null && <div style={errorStyle} role="alert">{error}</div>}

      <div>
        <label style={labelStyle} htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          style={inputStyle}
          value={email}
          onChange={(e) => { setEmail(e.target.value); }}
          placeholder="you@example.com"
          disabled={isLoading}
          autoComplete="email"
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          style={inputStyle}
          value={password}
          onChange={(e) => { setPassword(e.target.value); }}
          placeholder="••••••••"
          disabled={isLoading}
          autoComplete="current-password"
        />
      </div>

      <button type="submit" style={{ ...buttonStyle, opacity: isLoading ? 0.7 : 1 }} disabled={isLoading}>
        {isLoading ? "Signing in…" : "Sign In"}
      </button>

      <p style={linkStyle}>
        Don&apos;t have an account?{" "}
        <button
          type="button"
          onClick={onNavigateRegister}
          style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 13, textDecoration: "underline", padding: 0 }}
        >
          Register
        </button>
      </p>
    </form>
  );
}
