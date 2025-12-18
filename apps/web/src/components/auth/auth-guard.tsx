"use client";

import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect, useState, ReactNode, useMemo } from "react";
import { setAuthToken } from "@/lib/api";

interface AuthGuardProps {
  children: ReactNode;
  requireEmailVerification?: boolean;
}

export function AuthGuard({ children, requireEmailVerification = false }: AuthGuardProps) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [isTokenReady, setIsTokenReady] = useState(false);

  // Compute the token value from session - this runs synchronously on each render
  // We always use the user ID for API calls. The FastAPI backend accepts the user ID
  // directly when Better Auth session validation is not configured.
  // For production with proper JWT, this would need to be updated to use session.session.token
  const tokenValue = useMemo(() => {
    if (session?.user?.id) {
      return session.user.id;
    }
    return null;
  }, [session]);

  // Set the token synchronously when session changes
  useEffect(() => {
    if (!isPending) {
      if (tokenValue) {
        // Check if email verification is required
        if (requireEmailVerification && session?.user && !session.user.emailVerified) {
          const email = session.user.email || "";
          router.push(`/verify-email?email=${encodeURIComponent(email)}`);
          return;
        }
        setAuthToken(tokenValue);
        setIsTokenReady(true);
      } else if (!session) {
        setAuthToken(null);
        setIsTokenReady(false);
        router.push("/login");
      }
    }
  }, [isPending, session, tokenValue, router, requireEmailVerification]);

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
