import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  clearAccessToken,
  getAccessToken,
  getCurrentUser,
  getImpersonationView,
  login as loginRequest,
  refreshSession,
  setAccessToken,
  setImpersonateEmployeeId,
  subscribeToAuthLogout,
} from "./api";

const SESSION_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [impersonatedUser, setImpersonatedUser] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuthLogout(() => {
      setUser(null);
      setImpersonatedUser(null);
    });

    async function bootstrap() {
      const token = getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
      } catch {
        clearAccessToken();
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    bootstrap();
    return unsubscribe;
  }, []);

  // Rolling session: finché l'utente è attivo il token viene rinnovato in
  // background, così la scadenza JWT può restare corta senza sloggare nessuno.
  useEffect(() => {
    if (!user) return undefined;
    const intervalId = window.setInterval(async () => {
      try {
        const payload = await refreshSession();
        setAccessToken(payload.access_token);
      } catch {
        // un eventuale 401 è già gestito da request() (logout)
      }
    }, SESSION_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [user]);

  async function login(username, password) {
    const payload = await loginRequest({ username, password });
    setAccessToken(payload.access_token);
    setUser(payload.user);
    return payload;
  }

  function logout() {
    clearAccessToken();
    setImpersonateEmployeeId(null);
    setUser(null);
    setImpersonatedUser(null);
  }

  const startImpersonation = useCallback(async (employeeId) => {
    const view = await getImpersonationView(employeeId);
    setImpersonateEmployeeId(view.linked_employee_id);
    setImpersonatedUser(view);
  }, []);

  const stopImpersonation = useCallback(() => {
    setImpersonateEmployeeId(null);
    setImpersonatedUser(null);
  }, []);

  const effectiveUser = impersonatedUser ?? user;

  return (
    <AuthContext.Provider
      value={{
        user,
        effectiveUser,
        isLoading,
        isAuthenticated: Boolean(user),
        isImpersonating: Boolean(impersonatedUser),
        login,
        logout,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
