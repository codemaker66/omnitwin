import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LoginForm } from "../components/auth/LoginForm.js";
import { useAuthStore } from "../stores/auth-store.js";

export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) void navigate("/editor", { replace: true });
  }, [isAuthenticated, navigate]);

  return <LoginForm onNavigateRegister={() => { void navigate("/register"); }} />;
}
