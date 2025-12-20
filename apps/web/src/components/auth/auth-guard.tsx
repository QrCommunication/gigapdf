"use client";

import { useSession, authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState, ReactNode, useCallback } from "react";
import { setAuthToken } from "@/lib/api";

interface AuthGuardProps {
  children: ReactNode;
  requireEmailVerification?: boolean;
}

export function AuthGuard({ children, requireEmailVerification = false }: AuthGuardProps) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [isTokenReady, setIsTokenReady] = useState(false);

  // Fetch JWT token from Better Auth
  const fetchAndSetToken = useCallback(async () => {
    try {
      // Use the jwtClient plugin to get the JWT token
      const { data, error } = await authClient.token();
      if (error) {
        console.error("[AuthGuard] Failed to get JWT token:", error);
        setAuthToken(null);
        setIsTokenReady(false);
        return false;
      }
      if (data?.token) {
        console.log("[AuthGuard] JWT token obtained successfully");
        setAuthToken(data.token);
        setIsTokenReady(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error("[AuthGuard] Error fetching token:", error);
      setAuthToken(null);
      setIsTokenReady(false);
      return false;
    }
  }, []);

  // Handle session changes and token fetching
  useEffect(() => {
    if (isPending) return;

    if (session?.user) {
      // Check if email verification is required
      if (requireEmailVerification && !session.user.emailVerified) {
        const email = session.user.email || "";
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      // Fetch JWT token for API calls
      fetchAndSetToken();
    } else {
      // No session - clear token and redirect to login
      setAuthToken(null);
      setIsTokenReady(false);
      router.push("/login");
    }
  }, [isPending, session, router, requireEmailVerification, fetchAndSetToken]);

  // Show loading while pending or while waiting for token to be ready
  if (isPending || (session && !isTokenReady)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-32 w-32 animate-spin rounded-full border-b-2 border-t-2 border-primary"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  // If email verification required but not verified, don't render children
  if (requireEmailVerification && !session.user?.emailVerified) {
    return null;
  }

  return <>{children}</>;
}
