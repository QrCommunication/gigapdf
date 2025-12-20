/**
 * Authentication Store
 * Zustand store using Better Auth client for authentication
 */

import { create } from 'zustand';
import { authClient, signIn, signOut, signUp, getSession, getAndStoreJwt, clearStoredJwt } from '../lib/auth-client';
import { tokenManager } from '../services/api';
import type { User, LoginRequest, RegisterRequest } from '../types';

interface AuthState {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isGoogleLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginRequest) => Promise<void>;
  loginWithGoogle: () => Promise<boolean>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
  setUser: (user: User | null) => void;
}

// Map Better Auth user to our User type
function mapUser(betterAuthUser: any): User | null {
  if (!betterAuthUser) return null;
  return {
    id: betterAuthUser.id,
    email: betterAuthUser.email,
    name: betterAuthUser.name || undefined,
    email_verified: betterAuthUser.emailVerified,
    avatar: betterAuthUser.image || undefined,
    created_at: betterAuthUser.createdAt,
    updated_at: betterAuthUser.updatedAt,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  user: null,
  isAuthenticated: false,
  isLoading: false,
  isGoogleLoading: false,
  error: null,

  // Login with email/password
  login: async (credentials: LoginRequest) => {
    try {
      set({ isLoading: true, error: null });
      console.log('[Auth] Attempting login for:', credentials.email);

      const { data, error } = await signIn.email({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) {
        throw new Error(error.message || 'Login failed');
      }

      if (data?.user) {
        console.log('[Auth] Login successful:', data.user.email);

        // Get and store JWT token for API calls
        // Small delay to ensure session is established
        await new Promise(resolve => setTimeout(resolve, 100));

        const jwt = await getAndStoreJwt();
        if (jwt) {
          console.log('[Auth] JWT obtained:', jwt.substring(0, 30) + '...');
          await tokenManager.setAccessToken(jwt);
        } else {
          console.warn('[Auth] No JWT obtained, trying session token');
          // Fallback to session token
          const session = await getSession();
          const sessionToken = session?.data?.session?.token || (data as any).token;
          if (sessionToken) {
            console.log('[Auth] Using session token:', sessionToken.substring(0, 20) + '...');
            await tokenManager.setAccessToken(sessionToken);
          }
        }

        // Debug: Check stored tokens
        await tokenManager.debugStoredKeys();

        set({
          user: mapUser(data.user),
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } else {
        throw new Error('No user data received');
      }
    } catch (error: any) {
      console.error('[Auth] Login error:', error);
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: error.message || 'Login failed',
      });
      throw error;
    }
  },

  // Login with Google
  loginWithGoogle: async (): Promise<boolean> => {
    try {
      set({ isGoogleLoading: true, error: null });
      console.log('[Auth] Starting Google OAuth flow');

      // Better Auth handles the OAuth flow with Expo deep links
      const { data, error } = await signIn.social({
        provider: 'google',
        callbackURL: '/(tabs)',
      });

      if (error) {
        console.error('[Auth] Google login error:', error);
        set({
          isGoogleLoading: false,
          error: error.message || 'Google login failed',
        });
        return false;
      }

      // After OAuth, fetch the session to get user data
      const session = await getSession();

      if (session?.data?.user) {
        console.log('[Auth] Google login successful:', session.data.user.email);

        // Store the session token for API calls
        if (session.data.session?.token) {
          console.log('[Auth] Storing session token for API');
          await tokenManager.setAccessToken(session.data.session.token);
        }

        set({
          user: mapUser(session.data.user),
          isAuthenticated: true,
          isGoogleLoading: false,
          error: null,
        });
        return true;
      }

      // If we get here but no session, the user cancelled
      console.log('[Auth] Google login cancelled or no session');
      set({ isGoogleLoading: false });
      return false;
    } catch (error: any) {
      console.error('[Auth] Google OAuth error:', error);
      set({
        user: null,
        isAuthenticated: false,
        isGoogleLoading: false,
        error: error.message || 'Google login failed',
      });
      throw error;
    }
  },

  // Register
  register: async (data: RegisterRequest) => {
    try {
      set({ isLoading: true, error: null });
      console.log('[Auth] Attempting registration for:', data.email);

      const { data: result, error } = await signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
      });

      if (error) {
        throw new Error(error.message || 'Registration failed');
      }

      if (result?.user) {
        console.log('[Auth] Registration successful:', result.user.email);

        // Store the session token for API calls
        if (result.session?.token) {
          console.log('[Auth] Storing session token for API');
          await tokenManager.setAccessToken(result.session.token);
        }

        set({
          user: mapUser(result.user),
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } else {
        throw new Error('No user data received');
      }
    } catch (error: any) {
      console.error('[Auth] Register error:', error);
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: error.message || 'Registration failed',
      });
      throw error;
    }
  },

  // Logout
  logout: async () => {
    try {
      set({ isLoading: true });
      console.log('[Auth] Logging out');

      await signOut();
      // Clear stored tokens (both session and JWT)
      await tokenManager.clearTokens();
      await clearStoredJwt();
    } catch (error) {
      console.error('[Auth] Logout error:', error);
    } finally {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    }
  },

  // Load user from session
  loadUser: async () => {
    try {
      set({ isLoading: true, error: null });
      console.log('[Auth] Loading user session');

      const session = await getSession();

      if (session?.data?.user) {
        console.log('[Auth] Session found:', session.data.user.email);

        // Store the session token for API calls
        if (session.data.session?.token) {
          console.log('[Auth] Storing session token for API');
          await tokenManager.setAccessToken(session.data.session.token);
        }

        set({
          user: mapUser(session.data.user),
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } else {
        console.log('[Auth] No session found');
        // Clear any stale tokens
        await tokenManager.clearTokens();
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    } catch (error: any) {
      console.error('[Auth] Load user error:', error);
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: error.message || 'Failed to load user',
      });
    }
  },

  // Clear error
  clearError: () => {
    set({ error: null });
  },

  // Set user manually
  setUser: (user: User | null) => {
    set({
      user,
      isAuthenticated: !!user,
    });
  },
}));
