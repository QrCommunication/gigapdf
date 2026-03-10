import { apiClient } from '../client';
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  User,
  RefreshTokenRequest,
  RefreshTokenResponse,
} from '@giga-pdf/types';

/**
 * Authentication service
 */
export const authService = {
  /**
   * Login with email and password
   */
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/auth/login', credentials);
    return response.data;
  },

  /**
   * Register a new user
   */
  register: async (data: RegisterRequest): Promise<RegisterResponse> => {
    const response = await apiClient.post<RegisterResponse>('/auth/register', data);
    return response.data;
  },

  /**
   * Logout the current user
   */
  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },

  /**
   * Refresh access token
   */
  refreshToken: async (data: RefreshTokenRequest): Promise<RefreshTokenResponse> => {
    const response = await apiClient.post<RefreshTokenResponse>('/auth/refresh', data);
    return response.data;
  },

  /**
   * Get current user profile
   */
  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/me');
    return response.data;
  },

  /**
   * Update current user profile
   */
  updateProfile: async (data: Partial<User>): Promise<User> => {
    const response = await apiClient.patch<User>('/auth/me', data);
    return response.data;
  },

  /**
   * Request password reset
   */
  requestPasswordReset: async (email: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      '/auth/password-reset/request',
      { email }
    );
    return response.data;
  },

  /**
   * Reset password with token
   */
  resetPassword: async (token: string, password: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      '/auth/password-reset/confirm',
      { token, password }
    );
    return response.data;
  },

  /**
   * Verify email with token
   */
  verifyEmail: async (token: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/auth/verify-email', {
      token,
    });
    return response.data;
  },

  /**
   * Resend verification email
   */
  resendVerificationEmail: async (): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      '/auth/verify-email/resend'
    );
    return response.data;
  },
};
