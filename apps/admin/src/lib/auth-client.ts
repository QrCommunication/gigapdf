import { createAuthClient } from "better-auth/react";
import { withAdminBasePath } from "./base-path";

const configuredBaseURL = process.env.NEXT_PUBLIC_ADMIN_URL?.replace(/\/+$/, "");
const baseURL =
  configuredBaseURL ||
  (typeof window === "undefined" ? "http://localhost:3001" : window.location.origin);

export const authClient: ReturnType<typeof createAuthClient> = createAuthClient({
  baseURL: `${withAdminBasePath(baseURL)}/api/auth`,
});

export const { signIn, signOut, signUp, useSession } = authClient;
