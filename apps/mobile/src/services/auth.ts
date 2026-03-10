/**
 * Authentication Service for Better Auth
 * Handles user authentication, registration, and session management
 * Compatible with Better Auth endpoints used by the Next.js frontend
 */

import axios from 'axios';
import { AUTH_BASE_URL, tokenManager } from './api';
import {
  ApiResponse,
  AuthResponse,
  LoginCredentials,
  RegisterData,
  User,
} from './types';

// ============================================================================
// Types for Better Auth
// ============================================================================

// Better Auth sign-in response format
interface BetterAuthSignInResponse {
  redirect: boolean;
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    image: string | null;
    createdAt: string;
    updatedAt: string;
    locale?: string;
  };
}

// Better Auth session response format (from get-session)
interface BetterAuthSession {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    image: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

interface BetterAuthError {
  message?: string;
  error?: string;
  code?: string;
}

// ============================================================================
// Axios instance for auth requests
// ============================================================================

const authAxios = axios.create({
  baseURL: AUTH_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    // Origin header required for Better Auth CSRF protection
    // Must match a trusted origin configured in the backend
    'Origin': 'https://giga-pdf.com',
    // Custom header to identify mobile client
    'X-Client-Type': 'mobile',
  },
  withCredentials: true,
});

// Add interceptor to include auth token
authAxios.interceptors.request.use(async (config) => {
  const token = await tokenManager.getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ============================================================================
// Helper functions
// ============================================================================

type BetterAuthUser = BetterAuthSession['user'] | BetterAuthSignInResponse['user'];

function mapBetterAuthUserToUser(betterAuthUser: BetterAuthUser): User {
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

function handleAuthError(error: any): never {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as BetterAuthError;
    throw new Error(data?.message || data?.error || 'Authentication failed');
  }
  throw error;
}

// ============================================================================
// Authentication Service
// ============================================================================

export const authService = {
  /**
   * Login user with email and password
   * Better Auth endpoint: POST /sign-in/email
   * @param credentials - User login credentials
   * @returns Authentication response with user and session
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      console.log('[Auth] Attempting login for:', credentials.email);

      const response = await authAxios.post<BetterAuthSignInResponse>('/sign-in/email', {
        email: credentials.email,
        password: credentials.password,
      });

      console.log('[Auth] Login response:', JSON.stringify(response.data, null, 2));

      const data = response.data;

      // Validate response structure
      if (!data) {
        throw new Error('Empty response from server');
      }

      // Check for error response
      const errorData = data as unknown as BetterAuthError;
      if (errorData.message || errorData.error) {
        throw new Error(errorData.message || errorData.error || 'Authentication failed');
      }

      if (!data.token) {
        throw new Error('No token received from server');
      }

      if (!data.user) {
        throw new Error('No user data received from server');
      }

      // Store session token
      await tokenManager.setAccessToken(data.token);
      await tokenManager.setSession(data);

      return {
        user: mapBetterAuthUserToUser(data.user),
        tokens: {
          access_token: data.token,
          refresh_token: '', // Better Auth handles refresh internally
          expires_in: 60 * 60 * 24 * 7, // 7 days (default)
        },
      };
    } catch (error) {
      console.error('[Auth] Login error:', error);
      handleAuthError(error);
    }
  },

  /**
   * Register new user
   * Better Auth endpoint: POST /sign-up/email
   * @param data - User registration data
   * @returns Authentication response with user and session
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    try {
      console.log('[Auth] Attempting registration for:', data.email);

      const response = await authAxios.post<BetterAuthSignInResponse>('/sign-up/email', {
        email: data.email,
        password: data.password,
        name: data.name,
      });

      console.log('[Auth] Register response:', JSON.stringify(response.data, null, 2));

      const responseData = response.data;

      // Check for error response
      const errorData = responseData as unknown as BetterAuthError;
      if (errorData.message || errorData.error) {
        throw new Error(errorData.message || errorData.error || 'Registration failed');
      }

      if (!responseData.token) {
        throw new Error('No token received from server');
      }

      // Store session token
      await tokenManager.setAccessToken(responseData.token);
      await tokenManager.setSession(responseData);

      return {
        user: mapBetterAuthUserToUser(responseData.user),
        tokens: {
          access_token: responseData.token,
          refresh_token: '',
          expires_in: 60 * 60 * 24 * 7, // 7 days
        },
      };
    } catch (error) {
      console.error('[Auth] Register error:', error);
      handleAuthError(error);
    }
  },

  /**
   * Logout current user
   * Better Auth endpoint: POST /sign-out
   */
  async logout(): Promise<void> {
    try {
      await authAxios.post('/sign-out');
    } catch (error) {
      console.error('Logout error:', error);
      // Continue with local logout even if server request fails
    } finally {
      await tokenManager.clearTokens();
    }
  },

  /**
   * Get current session
   * Better Auth endpoint: GET /get-session
   * @returns Current session data
   */
  async getSession(): Promise<BetterAuthSession | null> {
    try {
      const response = await authAxios.get<BetterAuthSession>('/get-session');

      if (response.data?.session) {
        await tokenManager.setSession(response.data);
        return response.data;
      }

      return null;
    } catch (error) {
      console.error('Get session error:', error);
      return null;
    }
  },

  /**
   * Get current authenticated user
   * @returns Current user data
   */
  async getCurrentUser(): Promise<User | null> {
    const session = await this.getSession();
    if (session?.user) {
      return mapBetterAuthUserToUser(session.user);
    }
    return null;
  },

  /**
   * Update current user profile
   * Better Auth endpoint: POST /update-user
   * @param data - User profile data to update
   * @returns Updated user data
   */
  async updateProfile(data: { name?: string; image?: string }): Promise<User> {
    try {
      const response = await authAxios.post<{ user: BetterAuthSession['user'] }>(
        '/update-user',
        data
      );

      return mapBetterAuthUserToUser(response.data.user);
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Change user password
   * Better Auth endpoint: POST /change-password
   * @param currentPassword - Current password
   * @param newPassword - New password
   */
  async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    try {
      await authAxios.post('/change-password', {
        currentPassword,
        newPassword,
      });
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Request password reset email
   * Better Auth endpoint: POST /forget-password
   * @param email - User email address
   */
  async requestPasswordReset(email: string): Promise<void> {
    try {
      await authAxios.post('/forget-password', { email });
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Reset password using reset token
   * Better Auth endpoint: POST /reset-password
   * @param newPassword - New password
   * @param token - Password reset token (optional, may be in cookie)
   */
  async resetPassword(newPassword: string, token?: string): Promise<void> {
    try {
      await authAxios.post('/reset-password', {
        newPassword,
        token,
      });
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Send verification email
   * Better Auth endpoint: POST /send-verification-email
   * @param email - User email address
   */
  async sendVerificationEmail(email: string): Promise<void> {
    try {
      await authAxios.post('/send-verification-email', { email });
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Verify email address
   * Better Auth endpoint: GET /verify-email (with token in query)
   * @param token - Email verification token
   */
  async verifyEmail(token: string): Promise<void> {
    try {
      await authAxios.get(`/verify-email?token=${encodeURIComponent(token)}`);
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Check if user is authenticated
   * @returns True if user has valid session
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await tokenManager.getAccessToken();
    if (!token) return false;

    // Verify session is still valid
    const session = await this.getSession();
    return !!session?.user;
  },

  /**
   * Get current access token
   * @returns Current access token or null
   */
  async getAccessToken(): Promise<string | null> {
    return tokenManager.getAccessToken();
  },

  /**
   * Get stored session from local storage
   * @returns Cached session or null
   */
  async getCachedSession(): Promise<BetterAuthSession | null> {
    return tokenManager.getSession();
  },

  /**
   * Delete user account
   * Note: Better Auth may require custom endpoint for this
   * @param password - User password for confirmation
   */
  async deleteAccount(password: string): Promise<void> {
    try {
      // Custom endpoint - may need adjustment based on backend implementation
      await authAxios.post('/delete-user', { password });
      await tokenManager.clearTokens();
    } catch (error) {
      handleAuthError(error);
    }
  },
};

// ============================================================================
// Social Authentication
// Uses expo-auth-session for OAuth flow with PKCE support
// ============================================================================

import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri } from 'expo-auth-session';
import Constants from 'expo-constants';

// Ensure web browser sessions are completed
WebBrowser.maybeCompleteAuthSession();

// Google OAuth configuration from app.json
const googleConfig = Constants.expoConfig?.extra?.googleOAuth;
const GOOGLE_CLIENT_ID = googleConfig?.clientId || '';
const GOOGLE_WEB_CLIENT_ID = googleConfig?.webClientId || '';

// Redirect URI for OAuth
const redirectUri = makeRedirectUri({
  scheme: 'gigapdf',
  path: 'auth/callback',
});

console.log('[Auth] OAuth redirect URI:', redirectUri);
console.log('[Auth] Google Client ID:', GOOGLE_CLIENT_ID ? 'configured' : 'missing');

export const socialAuthService = {
  /**
   * Get social login URL for OAuth flow
   * @param provider - OAuth provider (google, github, etc.)
   * @param callbackUrl - URL to redirect after auth
   * @returns OAuth URL to open in browser
   */
  getSocialLoginUrl(provider: 'google' | 'github' | 'apple', callbackUrl?: string): string {
    const params = new URLSearchParams();
    if (callbackUrl) {
      params.set('callbackURL', callbackUrl);
    }
    return `${AUTH_BASE_URL}/sign-in/${provider}?${params.toString()}`;
  },

  /**
   * Get Google Auth request hook configuration
   * This returns the configuration for useAuthRequest hook
   */
  getGoogleAuthConfig() {
    return {
      androidClientId: GOOGLE_CLIENT_ID,
      iosClientId: GOOGLE_CLIENT_ID,
      webClientId: GOOGLE_WEB_CLIENT_ID,
      redirectUri,
    };
  },

  /**
   * Sign in with Google using expo-auth-session
   * Uses PKCE flow for enhanced security
   * @param idToken - Google ID token from expo-auth-session
   * @param accessToken - Google access token
   * @returns Authentication response or null if cancelled
   */
  async signInWithGoogleToken(idToken: string, accessToken?: string): Promise<AuthResponse | null> {
    try {
      console.log('[Auth] Exchanging Google token with backend');

      // Send the Google ID token to our backend for verification and session creation
      // Better Auth handles Google OAuth callback at /callback/google
      const response = await authAxios.post<BetterAuthSignInResponse>('/sign-in/social', {
        provider: 'google',
        idToken,
        accessToken,
        callbackURL: redirectUri,
      });

      console.log('[Auth] Backend response:', JSON.stringify(response.data, null, 2));

      const data = response.data;

      // Check for error response
      const errorData = data as unknown as BetterAuthError;
      if (errorData.message || errorData.error) {
        throw new Error(errorData.message || errorData.error || 'Google authentication failed');
      }

      if (!data.token) {
        throw new Error('No token received from server');
      }

      // Store session token
      await tokenManager.setAccessToken(data.token);
      await tokenManager.setSession(data);

      console.log('[Auth] Google sign-in successful:', data.user?.email);

      return {
        user: mapBetterAuthUserToUser(data.user),
        tokens: {
          access_token: data.token,
          refresh_token: '',
          expires_in: 60 * 60 * 24 * 7, // 7 days
        },
      };
    } catch (error) {
      console.error('[Auth] Google token exchange error:', error);

      // If social endpoint doesn't exist, try the direct callback approach
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        console.log('[Auth] Trying alternative Google auth flow via callback');
        return this.signInWithGoogleCallback(idToken, accessToken);
      }

      throw error;
    }
  },

  /**
   * Alternative: Sign in with Google via callback URL approach
   * Used when the /sign-in/social endpoint is not available
   */
  async signInWithGoogleCallback(idToken: string, accessToken?: string): Promise<AuthResponse | null> {
    try {
      console.log('[Auth] Starting Google OAuth callback flow');

      // Use the callback URL approach with Better Auth
      const callbackUrl = `${AUTH_BASE_URL}/callback/google?id_token=${encodeURIComponent(idToken)}`;

      const result = await WebBrowser.openAuthSessionAsync(
        callbackUrl,
        redirectUri,
        { showInRecents: false }
      );

      console.log('[Auth] OAuth callback result:', result);

      if (result.type === 'success') {
        // Parse token from URL
        const url = new URL(result.url);
        const token = url.searchParams.get('token');

        if (token) {
          await tokenManager.setAccessToken(token);
          const session = await authService.getSession();

          if (session?.user) {
            return {
              user: mapBetterAuthUserToUser(session.user),
              tokens: {
                access_token: token,
                refresh_token: '',
                expires_in: 60 * 60 * 24 * 7,
              },
            };
          }
        }

        // Try fetching session directly
        const session = await authService.getSession();
        if (session?.user) {
          return {
            user: mapBetterAuthUserToUser(session.user),
            tokens: {
              access_token: session.session.token,
              refresh_token: '',
              expires_in: Math.floor(
                (new Date(session.session.expiresAt).getTime() - Date.now()) / 1000
              ),
            },
          };
        }

        throw new Error('Failed to get user session after Google sign-in');
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        console.log('[Auth] Google OAuth cancelled by user');
        return null;
      }

      throw new Error('Google sign-in failed');
    } catch (error) {
      console.error('[Auth] Google callback error:', error);
      throw error;
    }
  },

  /**
   * Legacy: Sign in with Google using web browser OAuth flow
   * Opens the Better Auth Google OAuth endpoint in a web browser
   * @returns Authentication response or null if cancelled
   */
  async signInWithGoogle(): Promise<AuthResponse | null> {
    try {
      console.log('[Auth] Starting Google OAuth flow (web browser)');

      // Construct the OAuth URL with mobile callback
      const authUrl = `${AUTH_BASE_URL}/sign-in/google?callbackURL=${encodeURIComponent(redirectUri)}`;

      console.log('[Auth] Opening browser for Google OAuth:', authUrl);

      // Open the OAuth flow in a web browser
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

      console.log('[Auth] OAuth result:', JSON.stringify(result, null, 2));

      if (result.type === 'success') {
        // Parse token from URL - we MUST have a token for successful auth
        const url = new URL(result.url);
        const token = url.searchParams.get('token');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        // Check for error in callback URL
        if (error) {
          console.error('[Auth] OAuth error in callback:', error, errorDescription);
          throw new Error(errorDescription || error || 'Google authentication failed');
        }

        // We must have a token for successful authentication
        if (!token) {
          console.error('[Auth] No token in callback URL:', result.url);
          throw new Error('No authentication token received from Google sign-in');
        }

        // Store the new token and get the session
        await tokenManager.setAccessToken(token);
        const session = await authService.getSession();

        if (session?.user) {
          console.log('[Auth] Google OAuth successful, user:', session.user.email);
          return {
            user: mapBetterAuthUserToUser(session.user),
            tokens: {
              access_token: token,
              refresh_token: '',
              expires_in: 60 * 60 * 24 * 7,
            },
          };
        }

        // If we have a token but no session, something went wrong
        console.error('[Auth] Token received but no session available');
        throw new Error('Failed to get user session after Google sign-in');
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        console.log('[Auth] Google OAuth cancelled by user');
        return null;
      }

      console.log('[Auth] Unexpected OAuth result type:', result.type);
      throw new Error('Google sign-in failed');
    } catch (error) {
      console.error('[Auth] Google OAuth error:', error);
      throw error;
    }
  },

  /**
   * Handle OAuth callback
   * This would be called after the OAuth redirect returns to the app
   * @param callbackUrl - The full callback URL with auth params
   */
  async handleOAuthCallback(callbackUrl: string): Promise<AuthResponse | null> {
    try {
      console.log('[Auth] Handling OAuth callback:', callbackUrl);

      // Parse token from callback URL
      const url = new URL(callbackUrl);
      const token = url.searchParams.get('token');

      if (token) {
        await tokenManager.setAccessToken(token);
      }

      // The callback URL contains the session info
      // Better Auth typically sets cookies, but for mobile we need to extract tokens
      const session = await authService.getSession();

      if (session?.user) {
        return {
          user: mapBetterAuthUserToUser(session.user),
          tokens: {
            access_token: session.session.token,
            refresh_token: '',
            expires_in: Math.floor(
              (new Date(session.session.expiresAt).getTime() - Date.now()) / 1000
            ),
          },
        };
      }

      return null;
    } catch (error) {
      console.error('OAuth callback error:', error);
      return null;
    }
  },
};

// Export Google auth config for use with useAuthRequest hook
export const useGoogleAuth = Google.useAuthRequest;

// ============================================================================
// Two-Factor Authentication
// Note: Requires Better Auth 2FA plugin to be enabled
// ============================================================================

export const twoFactorAuthService = {
  /**
   * Enable two-factor authentication
   * Better Auth endpoint: POST /two-factor/enable
   * @returns TOTP secret and QR code URI
   */
  async enable(): Promise<{ totpURI: string; secret: string; backupCodes: string[] }> {
    try {
      const response = await authAxios.post<{
        totpURI: string;
        secret: string;
        backupCodes: string[];
      }>('/two-factor/enable');
      return response.data;
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Verify and activate 2FA with TOTP code
   * Better Auth endpoint: POST /two-factor/verify
   * @param code - TOTP code from authenticator app
   */
  async verify(code: string): Promise<void> {
    try {
      await authAxios.post('/two-factor/verify', { code });
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Disable two-factor authentication
   * Better Auth endpoint: POST /two-factor/disable
   * @param password - User password for confirmation
   */
  async disable(password: string): Promise<void> {
    try {
      await authAxios.post('/two-factor/disable', { password });
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Get backup codes
   * Better Auth endpoint: GET /two-factor/backup-codes
   * @returns List of backup codes
   */
  async getBackupCodes(): Promise<string[]> {
    try {
      const response = await authAxios.get<{ backupCodes: string[] }>('/two-factor/backup-codes');
      return response.data.backupCodes;
    } catch (error) {
      handleAuthError(error);
    }
  },

  /**
   * Sign in with 2FA code (when 2FA is required)
   * Better Auth endpoint: POST /two-factor/verify-totp
   * @param code - TOTP code
   * @param trustDevice - Whether to trust this device
   */
  async signInWithTOTP(code: string, trustDevice = false): Promise<AuthResponse> {
    try {
      const response = await authAxios.post<BetterAuthSession>('/two-factor/verify-totp', {
        code,
        trustDevice,
      });

      const session = response.data;

      if (session.session?.token) {
        await tokenManager.setAccessToken(session.session.token);
        await tokenManager.setSession(session);
      }

      return {
        user: mapBetterAuthUserToUser(session.user),
        tokens: {
          access_token: session.session.token,
          refresh_token: '',
          expires_in: Math.floor(
            (new Date(session.session.expiresAt).getTime() - Date.now()) / 1000
          ),
        },
      };
    } catch (error) {
      handleAuthError(error);
    }
  },
};

export default authService;
