"use client";

import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState, ReactNode, useCallback, useRef } from "react";

interface AuthGuardProps {
  children: ReactNode;
  requireEmailVerification?: boolean;
}

export function AuthGuard({ children, requireEmailVerification = false }: AuthGuardProps) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const healthCheckDone = useRef(false);

  const verifyAndCleanup = useCallback(async () => {
    if (healthCheckDone.current) return;
    healthCheckDone.current = true;
    setIsVerifying(true);

    try {
      const res = await fetch("/api/health", { credentials: "include" });
      const data = await res.json();

      if (!data.authenticated) {
        document.cookie = "__Secure-better-auth.session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = "__Secure-better-auth.session_data=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        document.cookie = "better-auth.session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        setIsRedirecting(true);
        window.location.href = "/login";
        return;
      }
    } catch {
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
    } else {
      verifyAndCleanup();
    }
  }, [isPending, session, router, requireEmailVerification, verifyAndCleanup]);

  if (isPending || isVerifying || isRedirecting) {
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

  if (requireEmailVerification && !session.user?.emailVerified) {
    return null;
  }

  return <>{children}</>;
}
