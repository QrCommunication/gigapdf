/**
 * GigaPDF Forgot Password Screen
 * Password recovery with email verification
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
} from 'react-native';
import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { forgetPassword } from '../../src/lib/auth-client';
import { useTheme } from '../../src/contexts/ThemeContext';
import { Spacing, Typography } from '../../src/constants/spacing';

type ScreenState = 'form' | 'success';

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();

  // Screen state
  const [screenState, setScreenState] = useState<ScreenState>('form');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');

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

  // Handle password reset request
  const handleResetPassword = useCallback(async () => {
    setError(null);

    const isEmailValid = validateEmail(email);
    if (!isEmailValid) {
      return;
    }

    try {
      setIsLoading(true);
      const { error: resetError } = await forgetPassword({ email: email.trim() });
      if (resetError) {
        throw new Error(resetError.message || 'Erreur lors de l\'envoi');
      }
      setScreenState('success');
    } catch (err: any) {
      setError(err.message || 'Impossible d\'envoyer l\'email de reinitialisation');
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  // Handle back to login
  const handleBackToLogin = useCallback(() => {
    router.push('/(auth)/login');
  }, []);

  // Handle try again
  const handleTryAgain = useCallback(() => {
    setScreenState('form');
    setEmail('');
    setError(null);
  }, []);

  // Success state
  if (screenState === 'success') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.successContainer}>
          {/* Success Icon */}
          <View style={[styles.successIconContainer, { backgroundColor: colors.successLight }]}>
            <Ionicons name="mail-open" size={64} color={colors.success} />
          </View>

          {/* Success Message */}
          <Text style={[styles.successTitle, { color: colors.text }]}>Email envoye !</Text>
          <Text style={[styles.successMessage, { color: colors.textSecondary }]}>
            Nous avons envoye un lien de reinitialisation a{'\n'}
            <Text style={[styles.emailHighlight, { color: colors.primary }]}>{email}</Text>
          </Text>

          <Text style={[styles.successInstructions, { color: colors.textSecondary }]}>
            Verifiez votre boite de reception et suivez les instructions pour
            reinitialiser votre mot de passe.
          </Text>

          {/* Check spam notice */}
          <View style={[styles.spamNotice, { backgroundColor: colors.infoLight, borderColor: colors.info }]}>
            <Ionicons name="information-circle" size={20} color={colors.info} />
            <Text style={[styles.spamText, { color: colors.info }]}>
              Si vous ne trouvez pas l'email, verifiez vos spams.
            </Text>
          </View>

          {/* Actions */}
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={handleBackToLogin}
          >
            <Text style={[styles.primaryButtonText, { color: colors.textInverse }]}>
              Retour a la connexion
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            onPress={handleTryAgain}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
              Renvoyer l'email
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Form state
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
              disabled={isLoading}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          </Link>

          <View style={[styles.iconContainer, { backgroundColor: colors.surface }]}>
            <Ionicons name="key-outline" size={48} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Mot de passe oublie ?</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Pas de panique ! Entrez votre adresse email et nous vous enverrons un
            lien pour reinitialiser votre mot de passe.
          </Text>
        </View>

        {/* Error Message */}
        {error && (
          <View style={[styles.errorContainer, { backgroundColor: colors.errorLight, borderColor: colors.error }]}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        )}

        {/* Form */}
        <View style={styles.form}>
          {/* Email Input */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.text }]}>Adresse email</Text>
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
                autoFocus
                editable={!isLoading}
              />
              {email.length > 0 && !emailError && (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              )}
            </View>
            {emailError && (
              <Text style={[styles.fieldError, { color: colors.error }]}>{emailError}</Text>
            )}
          </View>

          {/* Reset Button */}
          <TouchableOpacity
            style={[
              styles.resetButton,
              { backgroundColor: colors.primary },
              isLoading && styles.resetButtonDisabled,
            ]}
            onPress={handleResetPassword}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <>
                <Ionicons name="send" size={20} color={colors.textInverse} />
                <Text style={[styles.resetButtonText, { color: colors.textInverse }]}>
                  Envoyer le lien
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Back to Login Link */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Vous vous souvenez de votre mot de passe ?
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity disabled={isLoading}>
              <Text style={[styles.loginLink, { color: colors.primary }]}>Se connecter</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Help Section */}
        <View style={styles.helpSection}>
          <Ionicons name="help-circle-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.helpText, { color: colors.textSecondary }]}>
            Besoin d'aide ? Contactez notre{' '}
            <Text style={[styles.helpLink, { color: colors.primary }]}>support</Text>
          </Text>
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
    marginBottom: Spacing.xl,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Spacing.radiusFull,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: Spacing.radiusXl,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.md,
    lineHeight: 24,
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
    marginBottom: Spacing.lg,
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
  fieldError: {
    fontSize: Typography.xs,
    marginTop: Spacing.xs,
  },
  resetButton: {
    flexDirection: 'row',
    borderRadius: Spacing.radiusMd,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  resetButtonDisabled: {
    opacity: 0.7,
  },
  resetButtonText: {
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
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
  loginLink: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
  helpSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.lg,
    gap: Spacing.xs,
  },
  helpText: {
    fontSize: Typography.sm,
  },
  helpLink: {
    fontWeight: Typography.medium,
  },

  // Success State Styles
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  successIconContainer: {
    width: 120,
    height: 120,
    borderRadius: Spacing.radiusFull,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  successTitle: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: Typography.md,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    lineHeight: 24,
  },
  emailHighlight: {
    fontWeight: Typography.semibold,
  },
  successInstructions: {
    fontSize: Typography.sm,
    textAlign: 'center',
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.md,
    lineHeight: 20,
  },
  spamNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.radiusMd,
    padding: Spacing.md,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  spamText: {
    fontSize: Typography.sm,
    flex: 1,
  },
  primaryButton: {
    borderRadius: Spacing.radiusMd,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: Spacing.md,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  primaryButtonText: {
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderRadius: Spacing.radiusMd,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: Typography.md,
    fontWeight: Typography.medium,
  },
});
