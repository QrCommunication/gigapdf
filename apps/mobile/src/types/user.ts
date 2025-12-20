/**
 * User Types
 * Types pour l'authentification et les utilisateurs
 */

export interface User {
  id: string;
  email: string;
  name?: string; // Optional - Better Auth users may not have name
  avatar?: string;
  role?: 'user' | 'admin' | 'super_admin';
  email_verified?: boolean;
  email_verified_at?: string;
  created_at: string;
  updated_at: string;
  locale?: string;
  subscription?: Subscription;
  preferences?: UserPreferences;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

export interface LoginRequest {
  email: string;
  password: string;
  remember?: boolean;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  email: string;
  token: string;
  password: string;
  password_confirmation: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  password: string;
  password_confirmation: string;
}

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  avatar?: string;
}

export interface UserPreferences {
  language: string;
  theme: 'light' | 'dark' | 'auto';
  notifications_enabled: boolean;
  auto_save: boolean;
  default_quality: 'low' | 'medium' | 'high';
}

export interface Subscription {
  id: string;
  plan: SubscriptionPlan;
  status: 'active' | 'canceled' | 'expired' | 'trial';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  usage: SubscriptionUsage;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: 'month' | 'year';
  features: string[];
  limits: {
    max_documents: number;
    max_file_size: number; // in MB
    max_pages_per_document: number;
    max_operations_per_month: number;
    storage_limit: number; // in GB
  };
}

export interface SubscriptionUsage {
  documents_count: number;
  storage_used: number; // in bytes
  operations_this_month: number;
  last_operation_at?: string;
}
