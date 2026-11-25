import { createAuthClient } from "better-auth/react";

const configuredBaseURL = process.env.NEXT_PUBLIC_ADMIN_URL?.replace(/\/+$/, "");
const baseURL =
  configuredBaseURL ||
  (typeof window === "undefined" ? "http://localhost:3001" : window.location.origin);
const productionBasePath =
  process.env.NODE_ENV === "production" && !baseURL.endsWith("/admin") ? "/admin" : "";

export const authClient: ReturnType<typeof createAuthClient> = createAuthClient({
  baseURL: `${baseURL}${productionBasePath}`,
});

export const { signIn, signOut, signUp, useSession } = authClient;
