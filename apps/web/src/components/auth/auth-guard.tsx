"use client";

import { useSession, authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { setAuthToken } from "@/lib/api";

interface AuthGuardProps {
  children: ReactNode;
  requireEmailVerification?: boolean;
}

export function AuthGuard({ children, requireEmailVerification = false }: AuthGuardProps) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [isTokenReady, setIsTokenReady] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const healthCheckDone = useRef(false);

  const fetchAndSetToken = useCallback(async () => {
    try {
      const { data, error } = await authClient.token();
      if (error) {
        console.error("[AuthGuard] Failed to get JWT token:", error);
        setAuthToken(null);
        setIsTokenReady(false);
        return false;
      }
      if (data?.token) {
        setAuthToken(data.token);
        setIsTokenReady(true);
        setTokenError(null);
        return true;
      }
      console.warn("[AuthGuard] No token received from authClient.token()", { data, error });
      setTokenError("Unable to get authentication token");
      setIsTokenReady(false);
      return false;
    } catch (err) {
      console.error("[AuthGuard] Exception while fetching token:", err);
      setAuthToken(null);
      setIsTokenReady(false);
      setTokenError("Failed to fetch authentication token");
      return false;
    }
  }, []);

  const verifyAndCleanup = useCallback(async () => {
    if (healthCheckDone.current) return;
    healthCheckDone.current = true;
    setIsVerifying(true);

    try {
      const res = await fetch("/api/health", { credentials: "include" });
      const data = await res.json();

      if (!data.authenticated) {
        setAuthToken(null);
        document.cookie = "__Secure-better-auth.session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = "__Secure-better-auth.session_data=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = "better-auth.session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        setIsRedirecting(true);
        window.location.href = "/login";
        return;
      }
    } catch {
      setAuthToken(null);
      document.cookie = "__Secure-better-auth.session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie = "__Secure-better-auth.session_data=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie = "better-auth.session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      setIsRedirecting(true);
      window.location.href = "/login";
      return;
    } finally {
      setIsVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (isPending) return;

    if (session?.user) {
      if (requireEmailVerification && !session.user.emailVerified) {
        const email = session.user.email || "";
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      fetchAndSetToken();
    } else {
      verifyAndCleanup();
    }
  }, [isPending, session, router, requireEmailVerification, fetchAndSetToken, verifyAndCleanup]);

  if (isPending || isVerifying || (session && !isTokenReady) || isRedirecting) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <div className="h-32 w-32 animate-spin rounded-full border-b-2 border-t-2 border-primary"></div>
        {(isRedirecting || isVerifying) && <p className="text-muted-foreground">Vérification...</p>}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <div className="h-32 w-32 animate-spin rounded-full border-b-2 border-t-2 border-primary"></div>
        <p className="text-muted-foreground">Redirection...</p>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <div className="text-destructive">
          <p className="text-lg font-semibold">Authentication Error</p>
          <p className="text-sm">{tokenError}</p>
        </div>
        <button
          onClick={() => {
            setTokenError(null);
            fetchAndSetToken();
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  if (requireEmailVerification && !session.user?.emailVerified) {
    return null;
  }

  return <>{children}</>;
}
