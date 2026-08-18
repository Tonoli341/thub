import { useState } from "react";

import { useAuth } from "../auth";
import THubLogin from "../THubLogin";

export default function LoginPage() {
  const { login } = useAuth();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e) {
    setError("");
    setIsSubmitting(true);
    const { username, password } = e.target.elements;
    try {
      await login(username.value, password.value);
    } catch (err) {
      setError(err.message || "Credenziali non valide. Riprova.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <THubLogin
      onSubmit={handleSubmit}
      errorMessage={error}
      isSubmitting={isSubmitting}
    />
  );
}
