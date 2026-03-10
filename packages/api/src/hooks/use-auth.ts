import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authService } from '../services/auth';
import { getTokenStorage } from '../client';
import type {
  LoginRequest,
  RegisterRequest,
  User,
  LoginResponse,
  RegisterResponse,
} from '@giga-pdf/types';

/**
 * Query keys for auth-related queries
 */
export const authKeys = {
  all: ['auth'] as const,
  user: () => [...authKeys.all, 'user'] as const,
};

/**
 * Hook to get current user
 */
export const useCurrentUser = () => {
  return useQuery({
    queryKey: authKeys.user(),
    queryFn: authService.getCurrentUser,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

/**
 * Hook to login
 */
export const useLogin = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (credentials: LoginRequest) => authService.login(credentials),
    onSuccess: (data: LoginResponse) => {
      // Store tokens
      getTokenStorage().setTokens(data.access_token, data.refresh_token);
      // Set user in cache
      queryClient.setQueryData(authKeys.user(), data.user);
    },
  });
};

/**
 * Hook to register
 */
export const useRegister = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: RegisterRequest) => authService.register(data),
    onSuccess: (data: RegisterResponse) => {
      // Store tokens
      getTokenStorage().setTokens(data.access_token, data.refresh_token);
      // Set user in cache
      queryClient.setQueryData(authKeys.user(), data.user);
    },
  });
};

/**
 * Hook to logout
 */
export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: authService.logout,
    onSuccess: () => {
      // Clear tokens
      getTokenStorage().clearTokens();
      // Clear all queries
      queryClient.clear();
    },
  });
};

/**
 * Hook to update profile
 */
export const useUpdateProfile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<User>) => authService.updateProfile(data),
    onSuccess: (data: User) => {
      queryClient.setQueryData(authKeys.user(), data);
    },
  });
};

/**
 * Hook to request password reset
 */
export const useRequestPasswordReset = () => {
  return useMutation({
    mutationFn: (email: string) => authService.requestPasswordReset(email),
  });
};

/**
 * Hook to reset password
 */
export const useResetPassword = () => {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      authService.resetPassword(token, password),
  });
};

/**
 * Hook to verify email
 */
export const useVerifyEmail = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => authService.verifyEmail(token),
    onSuccess: () => {
      // Refetch user to update verification status
      queryClient.invalidateQueries({ queryKey: authKeys.user() });
    },
  });
};

/**
 * Hook to resend verification email
 */
export const useResendVerificationEmail = () => {
  return useMutation({
    mutationFn: authService.resendVerificationEmail,
  });
};
