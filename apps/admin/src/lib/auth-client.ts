import { createAuthClient } from "better-auth/react";

export const authClient: ReturnType<typeof createAuthClient> = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3001",
});

export const { signIn, signOut, signUp, useSession } = authClient;
