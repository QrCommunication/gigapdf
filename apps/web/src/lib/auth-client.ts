"use client";

import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";

const baseURL = process.env.NEXT_PUBLIC_APP_URL || "";

export const authClient = createAuthClient({
  baseURL,
  plugins: [jwtClient()],
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

// Wrapper functions for email verification and password reset
// These call the Better Auth API endpoints directly

export const sendVerificationEmail = async (params: { email: string }) => {
  try {
    const response = await fetch(`${baseURL}/api/auth/send-verification-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) {
      return { data: null, error: { message: data.message || "verification_email_failed" } };
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error: { message: "verification_email_failed" } };
  }
};

export const forgetPassword = async (params: { email: string; redirectTo?: string }) => {
  try {
    const response = await fetch(`${baseURL}/api/auth/forget-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) {
      return { data: null, error: { message: data.message || "reset_email_failed" } };
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error: { message: "reset_email_failed" } };
  }
};

export const resetPassword = async (params: { newPassword: string; token?: string }) => {
  try {
    const response = await fetch(`${baseURL}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      credentials: "include",
    });
    const data = await response.json();
    if (!response.ok) {
      return { data: null, error: { message: data.message || "password_reset_failed" } };
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error: { message: "password_reset_failed" } };
  }
};
