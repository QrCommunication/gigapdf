"use client";

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL!,
});

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
  updateUser,
  changePassword,
} = authClient;

// Password reset functions - these require proper email configuration on the server
// For now, provide stubs that indicate the feature needs configuration
export const forgotPassword = async (_params: { email: string; redirectTo?: string }) => {
  // This feature requires email configuration in the server
  // TODO: Configure email provider in better-auth server config
  return {
    data: null,
    error: { message: "Password reset is not yet configured. Please contact support." },
  };
};

export const resetPassword = async (_params: { token: string; newPassword: string }) => {
  // This feature requires email configuration in the server
  return {
    data: null,
    error: { message: "Password reset is not yet configured. Please contact support." },
  };
};
