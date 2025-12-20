/**
 * Better Auth Client for Expo
 * Uses @better-auth/expo for native mobile authentication
 * Uses jwt plugin for FastAPI backend compatibility
 */

import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import { jwtClient } from 'better-auth/client/plugins';
import * as SecureStore from 'expo-secure-store';

// Base URL for Better Auth API
const AUTH_BASE_URL = 'https://giga-pdf.com';

// Storage key for JWT token
const JWT_TOKEN_KEY = 'gigapdf_jwt_token';

/**
 * Better Auth client configured for Expo/React Native
 */
export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  plugins: [
    expoClient({
      scheme: 'gigapdf',
      storagePrefix: 'gigapdf',
      storage: SecureStore,
    }),
    jwtClient(),
  ],
});

// Export auth methods
export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
  forgetPassword,
  changePassword,
} = authClient;

/**
 * Get and store JWT token from session
 * Call this after login to get the JWT for API calls
 */
export async function getAndStoreJwt(): Promise<string | null> {
  try {
    let jwt: string | null = null;

    await getSession({
      fetchOptions: {
        onSuccess: (ctx) => {
          jwt = ctx.response.headers.get('set-auth-jwt');
          if (jwt) {
            SecureStore.setItemAsync(JWT_TOKEN_KEY, jwt);
            console.log('[Auth] JWT stored for API calls');
          }
        },
      },
    });

    return jwt;
  } catch (error) {
    console.error('[Auth] Failed to get JWT:', error);
    return null;
  }
}

/**
 * Get stored JWT token
 */
export async function getStoredJwt(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(JWT_TOKEN_KEY);
  } catch (error) {
    console.error('[Auth] Failed to get stored JWT:', error);
    return null;
  }
}

/**
 * Clear stored JWT token
 */
export async function clearStoredJwt(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(JWT_TOKEN_KEY);
  } catch (error) {
    console.error('[Auth] Failed to clear JWT:', error);
  }
}

// Type exports
export type Session = typeof authClient.$Infer.Session;
export { AUTH_BASE_URL, JWT_TOKEN_KEY };
