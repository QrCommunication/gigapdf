/**
 * Settings Screen
 * User preferences and app settings
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
// Animated removed for Expo Go compatibility
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAuthStore } from '../../src/stores/authStore';
import { Spacing, Typography, IconSizes } from '../../src/constants/spacing';
import { SettingsItem, SettingsSection } from '../../src/components/SettingsItem';

type ThemeOption = 'light' | 'dark' | 'system';
type LanguageOption = 'fr' | 'en' | 'es' | 'de';

interface Language {
  code: LanguageOption;
  name: string;
  flag: string;
}

const languages: Language[] = [
  { code: 'fr', name: 'Francais', flag: 'FR' },
  { code: 'en', name: 'English', flag: 'EN' },
  { code: 'es', name: 'Espanol', flag: 'ES' },
  { code: 'de', name: 'Deutsch', flag: 'DE' },
];

export default function SettingsScreen() {
  const { colors, theme, themeMode, setThemeMode } = useTheme();
  const { user, logout } = useAuthStore();
  const router = useRouter();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageOption>('fr');
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [cacheSize, setCacheSize] = useState('124 MB');

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Deconnexion',
      'Etes-vous sur de vouloir vous deconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Deconnecter',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  }, [logout, router]);

  const handleClearCache = useCallback(() => {
    Alert.alert(
      'Vider le cache',
      'Cette action supprimera tous les fichiers temporaires et les miniatures en cache.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Vider',
          style: 'destructive',
          onPress: () => {
            setCacheSize('0 B');
            Alert.alert('Cache vide', 'Le cache a ete vide avec succes');
          },
        },
      ]
    );
  }, []);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Supprimer le compte',
      'Cette action est irreversible. Toutes vos donnees seront definitivement supprimees.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirmation',
              'Veuillez contacter le support pour supprimer votre compte.'
            );
          },
        },
      ]
    );
  }, []);

  const getThemeLabel = (mode: ThemeOption): string => {
    switch (mode) {
      case 'light':
        return 'Clair';
      case 'dark':
        return 'Sombre';
      case 'system':
        return 'Systeme';
    }
  };

  const renderThemeModal = () => (
    <Modal
      visible={showThemeModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowThemeModal(false)}
    >
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
        onPress={() => setShowThemeModal(false)}
      >
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            Theme de l'application
          </Text>

          {(['light', 'dark', 'system'] as ThemeOption[]).map((option) => (
            <TouchableOpacity
              key={option}
              style={[
                styles.modalOption,
                themeMode === option && { backgroundColor: colors.backgroundSecondary },
              ]}
              onPress={() => {
                setThemeMode(option);
                setShowThemeModal(false);
              }}
            >
              <Ionicons
                name={
                  option === 'light'
                    ? 'sunny-outline'
                    : option === 'dark'
                    ? 'moon-outline'
                    : 'phone-portrait-outline'
                }
                size={22}
                color={themeMode === option ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.modalOptionText,
                  { color: themeMode === option ? colors.primary : colors.text },
                ]}
              >
                {getThemeLabel(option)}
              </Text>
              {themeMode === option && (
                <Ionicons name="checkmark" size={22} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );

  const renderLanguageModal = () => (
    <Modal
      visible={showLanguageModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowLanguageModal(false)}
    >
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
        onPress={() => setShowLanguageModal(false)}
      >
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            Langue
          </Text>

          {languages.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={[
                styles.modalOption,
                selectedLanguage === lang.code && {
                  backgroundColor: colors.backgroundSecondary,
                },
              ]}
              onPress={() => {
                setSelectedLanguage(lang.code);
                setShowLanguageModal(false);
              }}
            >
              <View style={styles.languageFlag}>
                <Text style={styles.languageFlagText}>{lang.flag}</Text>
              </View>
              <Text
                style={[
                  styles.modalOptionText,
                  {
                    color:
                      selectedLanguage === lang.code ? colors.primary : colors.text,
                  },
                ]}
              >
                {lang.name}
              </Text>
              {selectedLanguage === lang.code && (
                <Ionicons name="checkmark" size={22} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Profile Section */}
        <View>
          <TouchableOpacity
            style={[
              styles.profileCard,
              { backgroundColor: colors.card, borderColor: colors.cardBorder },
            ]}
            onPress={() => router.push('/profile' as any)}
          >
            <View
              style={[
                styles.avatar,
                { backgroundColor: colors.primary },
              ]}
            >
              <Text style={[styles.avatarText, { color: colors.textInverse }]}>
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: colors.text }]}>
                {user?.name || 'Utilisateur'}
              </Text>
              <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>
                {user?.email || 'email@example.com'}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={IconSizes.sm}
              color={colors.textTertiary}
            />
          </TouchableOpacity>
        </View>

        {/* Quota Info Banner - Open Source App */}
        <View>
          <View
            style={[styles.quotaBanner, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
          >
            <View style={styles.quotaHeader}>
              <Ionicons name="server-outline" size={20} color={colors.primary} />
              <Text style={[styles.quotaTitle, { color: colors.text }]}>
                Quota gratuit
              </Text>
              <View style={[styles.openSourceBadge, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.openSourceText, { color: colors.success }]}>
                  Open Source
                </Text>
              </View>
            </View>
            <View style={styles.quotaRow}>
              <Text style={[styles.quotaLabel, { color: colors.textSecondary }]}>
                Stockage
              </Text>
              <Text style={[styles.quotaValue, { color: colors.text }]}>
                5 Go
              </Text>
            </View>
            <View style={styles.quotaRow}>
              <Text style={[styles.quotaLabel, { color: colors.textSecondary }]}>
                Appels API / mois
              </Text>
              <Text style={[styles.quotaValue, { color: colors.text }]}>
                1 000
              </Text>
            </View>
          </View>
        </View>

        {/* Appearance Section */}
        <View>
          <SettingsSection title="Apparence">
            <SettingsItem
              icon="contrast-outline"
              title="Theme"
              value={getThemeLabel(themeMode)}
              onPress={() => setShowThemeModal(true)}
            />
            <SettingsItem
              icon="language-outline"
              title="Langue"
              value={languages.find((l) => l.code === selectedLanguage)?.name}
              onPress={() => setShowLanguageModal(true)}
            />
          </SettingsSection>
        </View>

        {/* Notifications Section */}
        <View>
          <SettingsSection title="Notifications">
            <SettingsItem
              icon="notifications-outline"
              title="Notifications push"
              subtitle="Recevoir des notifications pour les mises a jour"
              showChevron={false}
              showSwitch
              switchValue={notificationsEnabled}
              onSwitchChange={setNotificationsEnabled}
            />
            <SettingsItem
              icon="sync-outline"
              title="Synchronisation automatique"
              subtitle="Synchroniser les documents automatiquement"
              showChevron={false}
              showSwitch
              switchValue={autoSync}
              onSwitchChange={setAutoSync}
            />
          </SettingsSection>
        </View>

        {/* Storage Section */}
        <View>
          <SettingsSection title="Stockage">
            <SettingsItem
              icon="folder-outline"
              title="Documents stockes"
              value="5 fichiers"
              onPress={() => {}}
            />
            <SettingsItem
              icon="trash-outline"
              title="Vider le cache"
              value={cacheSize}
              onPress={handleClearCache}
            />
            <SettingsItem
              icon="cloud-download-outline"
              title="Telechargements hors ligne"
              onPress={() => {}}
            />
          </SettingsSection>
        </View>

        {/* Support Section */}
        <View>
          <SettingsSection title="Support">
            <SettingsItem
              icon="help-circle-outline"
              title="Centre d'aide"
              onPress={() => {}}
            />
            <SettingsItem
              icon="chatbubble-outline"
              title="Nous contacter"
              onPress={() => {}}
            />
            <SettingsItem
              icon="star-outline"
              title="Noter l'application"
              onPress={() => {}}
            />
            <SettingsItem
              icon="share-social-outline"
              title="Partager l'application"
              onPress={() => {}}
            />
          </SettingsSection>
        </View>

        {/* Legal Section */}
        <View>
          <SettingsSection title="Legal">
            <SettingsItem
              icon="document-text-outline"
              title="Conditions d'utilisation"
              onPress={() => {}}
            />
            <SettingsItem
              icon="shield-outline"
              title="Politique de confidentialite"
              onPress={() => {}}
            />
            <SettingsItem
              icon="information-circle-outline"
              title="A propos"
              value={`v${Constants.expoConfig?.version || '1.0.0'}`}
              onPress={() => {}}
            />
          </SettingsSection>
        </View>

        {/* Danger Zone */}
        <View>
          <SettingsSection title="Zone de danger">
            <SettingsItem
              icon="log-out-outline"
              title="Deconnexion"
              danger
              onPress={handleLogout}
            />
            <SettingsItem
              icon="person-remove-outline"
              title="Supprimer mon compte"
              danger
              onPress={handleDeleteAccount}
            />
          </SettingsSection>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
            GigaPDF v{Constants.expoConfig?.version || '1.0.0'}
          </Text>
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
            Made with care
          </Text>
        </View>
      </ScrollView>

      {renderThemeModal()}
      {renderLanguageModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
  },
  profileInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  profileName: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    marginBottom: 2,
  },
  profileEmail: {
    fontSize: Typography.sm,
  },
  quotaBanner: {
    marginHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Spacing.radiusMd,
    borderWidth: 1,
  },
  quotaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  quotaTitle: {
    fontSize: Typography.md,
    fontWeight: Typography.semibold,
    flex: 1,
  },
  openSourceBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Spacing.radiusFull,
  },
  openSourceText: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
  },
  quotaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  quotaLabel: {
    fontSize: Typography.sm,
  },
  quotaValue: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    maxWidth: 320,
    borderRadius: Spacing.radiusLg,
    padding: Spacing.lg,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  modalTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    marginBottom: Spacing.md,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Spacing.radiusSm,
    gap: Spacing.md,
  },
  modalOptionText: {
    flex: 1,
    fontSize: Typography.md,
  },
  languageFlag: {
    width: 32,
    height: 24,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageFlagText: {
    fontSize: 12,
    fontWeight: Typography.bold,
    color: '#374151',
  },
  footer: {
    alignItems: 'center',
    marginTop: Spacing.xl,
    gap: Spacing.xs,
  },
  footerText: {
    fontSize: Typography.xs,
  },
});
