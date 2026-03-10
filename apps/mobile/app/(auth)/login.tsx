/**
 * GigaPDF Login Screen
 * Modern login interface with email/password and social login options
 */

import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/authStore';
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography } from '../../src/constants/spacing';

export default function LoginScreen() {
  const { login, loginWithGoogle, isLoading, isGoogleLoading, error, clearError } = useAuthStore();
  const { colors } = useTheme();

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Email validation
  const validateEmail = (value: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!value.trim()) {
      setEmailError('L\'email est requis');
      return false;
    }
    if (!emailRegex.test(value)) {
      setEmailError('Email invalide');
      return false;
    }
    setEmailError('');
    return true;
  };

  // Password validation
  const validatePassword = (value: string): boolean => {
    if (!value) {
      setPasswordError('Le mot de passe est requis');
      return false;
    }
    if (value.length < 6) {
      setPasswordError('Le mot de passe doit contenir au moins 6 caracteres');
      return false;
    }
    setPasswordError('');
    return true;
  };

  // Handle login
  const handleLogin = useCallback(async () => {
    clearError();

    const isEmailValid = validateEmail(email);
    const isPasswordValid = validatePassword(password);

    if (!isEmailValid || !isPasswordValid) {
      return;
    }

    try {
      await login({ email, password });
      router.replace('/(tabs)');
    } catch (err) {
      // Error is handled by the store
    }
  }, [email, password, login, clearError]);

  // Handle Google login with web browser flow
  const handleGoogleLogin = useCallback(async () => {
    clearError();
    try {
      const success = await loginWithGoogle();
      // Only navigate if login was successful
      if (success) {
        console.log('[Login] Google login successful, navigating to tabs');
        router.replace('/(tabs)');
      } else {
        console.log('[Login] Google login cancelled or failed');
      }
    } catch (err) {
      // Error is handled by the store
      console.log('[Login] Google login error:', err);
    }
  }, [loginWithGoogle, clearError]);

  // Handle Apple login (placeholder)
  const handleAppleLogin = useCallback(() => {
    // TODO: Implement Apple login with expo-apple-authentication
    console.log('Apple login not yet implemented');
  }, []);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo and Header */}
        <View style={styles.header}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.title, { color: colors.text }]}>GigaPDF</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Connectez-vous a votre compte
          </Text>
        </View>

        {/* Error Message */}
        {error && (
          <View style={[styles.errorContainer, { backgroundColor: colors.errorLight, borderColor: colors.error }]}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}

        {/* Login Form */}
        <View style={styles.form}>
          {/* Email Input */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Email</Text>
            <View
              style={[
                styles.inputContainer,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
                emailError && { borderColor: colors.error, backgroundColor: colors.errorLight },
              ]}
            >
              <Ionicons
                name="mail-outline"
                size={20}
                color={emailError ? colors.error : colors.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="votre@email.com"
                placeholderTextColor={colors.textTertiary}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (emailError) validateEmail(text);
                }}
                onBlur={() => validateEmail(email)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!isLoading && !isGoogleLoading}
              />
            </View>
            {emailError && (
              <Text style={[styles.fieldError, { color: colors.error }]}>{emailError}</Text>
            )}
          </View>

          {/* Password Input */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Mot de passe</Text>
            <View
              style={[
                styles.inputContainer,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
                passwordError && { borderColor: colors.error, backgroundColor: colors.errorLight },
              ]}
            >
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={passwordError ? colors.error : colors.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Votre mot de passe"
                placeholderTextColor={colors.textTertiary}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (passwordError) validatePassword(text);
                }}
                onBlur={() => validatePassword(password)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="password"
                editable={!isLoading && !isGoogleLoading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.passwordToggle}
                disabled={isLoading || isGoogleLoading}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {passwordError && (
              <Text style={[styles.fieldError, { color: colors.error }]}>{passwordError}</Text>
            )}
          </View>

          {/* Forgot Password Link */}
          <Link href="/(auth)/forgot-password" asChild>
            <TouchableOpacity style={styles.forgotPassword} disabled={isLoading || isGoogleLoading}>
              <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>
                Mot de passe oublie ?
              </Text>
            </TouchableOpacity>
          </Link>

          {/* Login Button */}
          <TouchableOpacity
            style={[
              styles.loginButton,
              { backgroundColor: colors.primary },
              (isLoading || isGoogleLoading) && styles.loginButtonDisabled,
            ]}
            onPress={handleLogin}
            disabled={isLoading || isGoogleLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={[styles.loginButtonText, { color: colors.textInverse }]}>
                Se connecter
              </Text>
            )}
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.textSecondary }]}>
              ou continuer avec
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          </View>

          {/* Social Login Buttons */}
          <View style={styles.socialButtons}>
            <TouchableOpacity
              style={[styles.socialButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={handleGoogleLogin}
              disabled={isLoading || isGoogleLoading}
            >
              {isGoogleLoading ? (
                <ActivityIndicator color="#EA4335" size="small" />
              ) : (
                <Ionicons name="logo-google" size={24} color="#EA4335" />
              )}
              <Text style={[styles.socialButtonText, { color: colors.text }]}>
                Google
              </Text>
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={[styles.socialButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={handleAppleLogin}
                disabled={isLoading || isGoogleLoading}
              >
                <Ionicons name="logo-apple" size={24} color={colors.text} />
                <Text style={[styles.socialButtonText, { color: colors.text }]}>
                  Apple
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Register Link */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Vous n'avez pas de compte ?
          </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity disabled={isLoading || isGoogleLoading}>
              <Text style={[styles.registerLink, { color: colors.primary }]}>S'inscrire</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 20,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: Typography.xxxl,
    fontWeight: Typography.bold,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.md,
    textAlign: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.radiusMd,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  errorText: {
    fontSize: Typography.sm,
    marginLeft: Spacing.sm,
    flex: 1,
  },
  form: {
    flex: 1,
  },
  inputGroup: {
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    marginBottom: Spacing.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    height: 52,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: Typography.md,
    height: '100%',
  },
  passwordToggle: {
    padding: Spacing.xs,
  },
  fieldError: {
    fontSize: Typography.xs,
    marginTop: Spacing.xs,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: Spacing.lg,
  },
  forgotPasswordText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  loginButton: {
    borderRadius: Spacing.radiusMd,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: Spacing.md,
    fontSize: Typography.sm,
  },
  socialButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
    height: 52,
    gap: Spacing.sm,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  socialButtonText: {
    fontSize: Typography.md,
    fontWeight: Typography.medium,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.xl,
    gap: Spacing.xs,
  },
  footerText: {
    fontSize: Typography.sm,
  },
  registerLink: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
});
