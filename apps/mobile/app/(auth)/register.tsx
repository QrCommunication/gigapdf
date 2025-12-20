/**
 * GigaPDF Register Screen
 * Registration form with real-time validation
 */

import { useState, useCallback, useEffect } from 'react';
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

// Password strength indicator
type PasswordStrength = 'weak' | 'medium' | 'strong';

const getPasswordStrength = (password: string): PasswordStrength => {
  if (password.length < 6) return 'weak';

  let strength = 0;
  if (password.length >= 8) strength++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
  if (/\d/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;

  if (strength <= 1) return 'weak';
  if (strength <= 2) return 'medium';
  return 'strong';
};

const strengthLabels: Record<PasswordStrength, string> = {
  weak: 'Faible',
  medium: 'Moyen',
  strong: 'Fort',
};

export default function RegisterScreen() {
  const { register, loginWithGoogle, isLoading, isGoogleLoading, error, clearError } = useAuthStore();
  const { colors } = useTheme();

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Validation errors
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  // Password strength
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength>('weak');

  // Get strength color based on theme
  const getStrengthColor = (strength: PasswordStrength): string => {
    switch (strength) {
      case 'weak':
        return colors.error;
      case 'medium':
        return colors.warning;
      case 'strong':
        return colors.success;
    }
  };

  // Update password strength on change
  useEffect(() => {
    if (password) {
      setPasswordStrength(getPasswordStrength(password));
    }
  }, [password]);

  // Validation functions
  const validateName = (value: string): boolean => {
    if (!value.trim()) {
      setNameError('Le nom est requis');
      return false;
    }
    if (value.trim().length < 2) {
      setNameError('Le nom doit contenir au moins 2 caracteres');
      return false;
    }
    setNameError('');
    return true;
  };

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

  const validateConfirmPassword = (value: string): boolean => {
    if (!value) {
      setConfirmPasswordError('Veuillez confirmer votre mot de passe');
      return false;
    }
    if (value !== password) {
      setConfirmPasswordError('Les mots de passe ne correspondent pas');
      return false;
    }
    setConfirmPasswordError('');
    return true;
  };

  // Handle registration
  const handleRegister = useCallback(async () => {
    clearError();

    const isNameValid = validateName(name);
    const isEmailValid = validateEmail(email);
    const isPasswordValid = validatePassword(password);
    const isConfirmValid = validateConfirmPassword(confirmPassword);

    if (!isNameValid || !isEmailValid || !isPasswordValid || !isConfirmValid) {
      return;
    }

    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        password_confirmation: confirmPassword,
      });
      router.replace('/(tabs)');
    } catch (err) {
      // Error is handled by the store
    }
  }, [name, email, password, confirmPassword, register, clearError]);

  // Handle Google signup
  const handleGoogleSignup = useCallback(async () => {
    clearError();
    try {
      await loginWithGoogle();
      router.replace('/(tabs)');
    } catch (err) {
      // Error is handled by the store
    }
  }, [loginWithGoogle, clearError]);

  // Combined loading state
  const isAnyLoading = isLoading || isGoogleLoading;

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
        {/* Header */}
        <View style={styles.header}>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity
              style={[styles.backButton, { backgroundColor: colors.surface }]}
              disabled={isAnyLoading}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          </Link>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.title, { color: colors.text }]}>Creer un compte</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Rejoignez GigaPDF pour gerer vos documents PDF
          </Text>
        </View>

        {/* Error Message */}
        {error && (
          <View style={[styles.errorContainer, { backgroundColor: colors.errorLight, borderColor: colors.error }]}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}

        {/* Google Sign Up Button */}
        <TouchableOpacity
          style={[styles.googleButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={handleGoogleSignup}
          disabled={isAnyLoading}
        >
          {isGoogleLoading ? (
            <ActivityIndicator color="#EA4335" size="small" />
          ) : (
            <Ionicons name="logo-google" size={24} color="#EA4335" />
          )}
          <Text style={[styles.googleButtonText, { color: colors.text }]}>
            S'inscrire avec Google
          </Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.textSecondary }]}>
            ou avec email
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        {/* Registration Form */}
        <View style={styles.form}>
          {/* Name Input */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Nom complet</Text>
            <View
              style={[
                styles.inputContainer,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
                nameError && { borderColor: colors.error, backgroundColor: colors.errorLight },
              ]}
            >
              <Ionicons
                name="person-outline"
                size={20}
                color={nameError ? colors.error : colors.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Votre nom"
                placeholderTextColor={colors.textTertiary}
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  if (nameError) validateName(text);
                }}
                onBlur={() => validateName(name)}
                autoCapitalize="words"
                autoComplete="name"
                editable={!isAnyLoading}
              />
            </View>
            {nameError && (
              <Text style={[styles.fieldError, { color: colors.error }]}>{nameError}</Text>
            )}
          </View>

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
                editable={!isAnyLoading}
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
                placeholder="Minimum 6 caracteres"
                placeholderTextColor={colors.textTertiary}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (passwordError) validatePassword(text);
                  if (confirmPassword) validateConfirmPassword(confirmPassword);
                }}
                onBlur={() => validatePassword(password)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!isAnyLoading}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.passwordToggle}
                disabled={isAnyLoading}
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

            {/* Password Strength Indicator */}
            {password.length > 0 && !passwordError && (
              <View style={styles.strengthContainer}>
                <View style={styles.strengthBars}>
                  <View
                    style={[
                      styles.strengthBar,
                      { backgroundColor: getStrengthColor(passwordStrength) },
                    ]}
                  />
                  <View
                    style={[
                      styles.strengthBar,
                      {
                        backgroundColor:
                          passwordStrength !== 'weak'
                            ? getStrengthColor(passwordStrength)
                            : colors.border,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.strengthBar,
                      {
                        backgroundColor:
                          passwordStrength === 'strong'
                            ? getStrengthColor(passwordStrength)
                            : colors.border,
                      },
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.strengthText,
                    { color: getStrengthColor(passwordStrength) },
                  ]}
                >
                  {strengthLabels[passwordStrength]}
                </Text>
              </View>
            )}
          </View>

          {/* Confirm Password Input */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Confirmer le mot de passe</Text>
            <View
              style={[
                styles.inputContainer,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.border },
                confirmPasswordError && { borderColor: colors.error, backgroundColor: colors.errorLight },
              ]}
            >
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color={confirmPasswordError ? colors.error : colors.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Retapez votre mot de passe"
                placeholderTextColor={colors.textTertiary}
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  if (confirmPasswordError) validateConfirmPassword(text);
                }}
                onBlur={() => validateConfirmPassword(confirmPassword)}
                secureTextEntry={!showConfirmPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!isAnyLoading}
              />
              <TouchableOpacity
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                style={styles.passwordToggle}
                disabled={isAnyLoading}
              >
                <Ionicons
                  name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {confirmPasswordError && (
              <Text style={[styles.fieldError, { color: colors.error }]}>{confirmPasswordError}</Text>
            )}
            {!confirmPasswordError && confirmPassword && confirmPassword === password && (
              <View style={styles.matchIndicator}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={[styles.matchText, { color: colors.success }]}>
                  Les mots de passe correspondent
                </Text>
              </View>
            )}
          </View>

          {/* Terms Notice */}
          <Text style={[styles.termsText, { color: colors.textSecondary }]}>
            En vous inscrivant, vous acceptez nos{' '}
            <Text style={[styles.termsLink, { color: colors.primary }]}>
              Conditions d'utilisation
            </Text>{' '}
            et notre{' '}
            <Text style={[styles.termsLink, { color: colors.primary }]}>
              Politique de confidentialite
            </Text>
          </Text>

          {/* Register Button */}
          <TouchableOpacity
            style={[
              styles.registerButton,
              { backgroundColor: colors.primary },
              isAnyLoading && styles.registerButtonDisabled,
            ]}
            onPress={handleRegister}
            disabled={isAnyLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={[styles.registerButtonText, { color: colors.textInverse }]}>
                S'inscrire
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Login Link */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Vous avez deja un compte ?
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity disabled={isAnyLoading}>
              <Text style={[styles.loginLink, { color: colors.primary }]}>Se connecter</Text>
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
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Spacing.radiusFull,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 16,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: Typography.sm,
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
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
    height: 52,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  googleButtonText: {
    fontSize: Typography.md,
    fontWeight: Typography.medium,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: Spacing.md,
    fontSize: Typography.sm,
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
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  strengthBars: {
    flexDirection: 'row',
    flex: 1,
    gap: 4,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthText: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    marginLeft: Spacing.sm,
    minWidth: 50,
  },
  matchIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  matchText: {
    fontSize: Typography.xs,
    marginLeft: Spacing.xs,
  },
  termsText: {
    fontSize: Typography.xs,
    textAlign: 'center',
    marginVertical: Spacing.lg,
    lineHeight: 18,
  },
  termsLink: {
    fontWeight: Typography.medium,
  },
  registerButton: {
    borderRadius: Spacing.radiusMd,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  registerButtonDisabled: {
    opacity: 0.7,
  },
  registerButtonText: {
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.lg,
    gap: Spacing.xs,
  },
  footerText: {
    fontSize: Typography.sm,
  },
  loginLink: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
});
