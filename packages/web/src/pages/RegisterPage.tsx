import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { RegisterForm } from "../components/auth/RegisterForm.js";
import { useAuthStore } from "../stores/auth-store.js";

export function RegisterPage(): React.ReactElement {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) void navigate("/editor", { replace: true });
  }, [isAuthenticated, navigate]);

  return <RegisterForm onNavigateLogin={() => { void navigate("/login"); }} />;
}
